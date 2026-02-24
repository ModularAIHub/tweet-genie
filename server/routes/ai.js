import express from 'express';
import { aiService } from '../services/aiService.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireProPlan, resolveRequestPlanType } from '../middleware/planAccess.js';
import { creditService } from '../services/creditService.js';
import { TeamCreditService } from '../services/teamCreditService.js';
import { sanitizeInput, sanitizeAIPrompt, checkRateLimit } from '../utils/sanitization.js';
import { getTwitterPostingPreferences } from '../utils/twitterPostingPreferences.js';
import {
  normalizeStrategyPromptPayload,
  buildStrategyGenerationPrompt,
  evaluateStrategyGeneratedContent,
} from '../utils/strategyPromptBuilder.js';
// import { bulkGenerate } from '../controllers/aiController.js';

const router = express.Router();
const MAX_BULK_PROMPTS = 30;

// Synchronous bulk generation endpoint (no queue, no Redis)
// Scheduling service import (assume exists, adjust import if needed)
import { scheduledTweetService } from '../services/scheduledTweetService.js';

router.post('/bulk-generate', authenticateToken, requireProPlan('Bulk generation'), async (req, res) => {
  try {
    const { prompts, options, schedule = false, scheduleOptions = {} } = req.body;
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: 'No prompts provided' });
    }
    if (prompts.length > MAX_BULK_PROMPTS) {
      return res.status(400).json({
        error: `Bulk generation is limited to ${MAX_BULK_PROMPTS} prompts per run.`,
      });
    }
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const authHeader = req.headers['authorization'];
    const token = req.cookies?.accessToken || (authHeader && authHeader.split(' ')[1]) || null;
    const resolvedPlanType = await resolveRequestPlanType(req);

    // Synchronously generate content for each prompt
    const results = [];
    const scheduled = [];
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const opt = options && options[i] ? options[i] : {};
      try {
        const result = await aiService.generateContent(
          prompt,
          opt.style || 'casual',
          3,
          token,
          userId,
          resolvedPlanType
        );
        results.push({ success: true, result });
        // If scheduling is requested, schedule the tweet/thread
        if (schedule) {
          // If thread, split by '---', else single tweet
          const tweets = result.content.includes('---')
            ? result.content.split('---').map(t => t.trim()).filter(Boolean)
            : [result.content.trim()];
          // Schedule the tweets for future posting
          // Merge options: individual opt (with media) should override global scheduleOptions
          const scheduledResult = await scheduledTweetService.scheduleTweets({
            userId,
            tweets,
            options: {
              ...scheduleOptions,
              ...opt,
              mediaUrls: opt.mediaUrls || opt.media_urls || scheduleOptions.mediaUrls || scheduleOptions.media_urls || [],
              teamId: scheduleOptions.teamId || scheduleOptions.team_id || req.headers['x-team-id'] || null,
              accountId: scheduleOptions.accountId || scheduleOptions.account_id || null
            }
          });
          // Optionally, immediately post if scheduled time is now or in the past
          if (scheduledResult && scheduledResult.scheduledTime && new Date(scheduledResult.scheduledTime) <= new Date()) {
            await scheduledTweetService.processSingleScheduledTweetById(scheduledResult.scheduledId);
            scheduledResult.posted = true;
          } else {
            scheduledResult.posted = false;
          }
          scheduled.push({ promptIndex: i, scheduled: true, scheduledResult });
        }
      } catch (err) {
        results.push({ success: false, error: err.message });
        if (schedule) scheduled.push({ promptIndex: i, scheduled: false, error: err.message });
      }
    }
    res.json(schedule ? { results, scheduled } : { results });
  } catch (error) {
    console.error('Bulk generation error:', error);
    res.status(500).json({ error: 'Failed to generate content', message: error.message });
  }
});

// Generate AI content
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const {
      prompt,
      style = 'casual',
      isThread = false,
      schedule = false,
      scheduleOptions = {},
      generationMode = 'default',
      strategyPrompt: rawStrategyPrompt = null,
      clientSource = '',
    } = req.body || {};

    const normalizedGenerationMode =
      typeof generationMode === 'string' && generationMode.trim().toLowerCase() === 'strategy_prompt'
        ? 'strategy_prompt'
        : 'default';
    const strategyPrompt =
      normalizedGenerationMode === 'strategy_prompt'
        ? normalizeStrategyPromptPayload(rawStrategyPrompt)
        : null;
    const effectiveClientSource =
      typeof clientSource === 'string' ? clientSource.trim().toLowerCase().slice(0, 32) : '';

    // Rate limiting
    if (!checkRateLimit(req.user.id, 'ai_generation', 10, 60000)) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait before making more requests.'
      });
    }

    // Validate style parameter — includes 'witty' for backward compatibility
    const allowedStyles = ['casual', 'professional', 'humorous', 'inspirational', 'informative', 'witty'];
    if (!allowedStyles.includes(style)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid style parameter'
      });
    }

    if (normalizedGenerationMode === 'strategy_prompt' && !strategyPrompt) {
      return res.status(400).json({
        success: false,
        error: 'Valid strategyPrompt with idea is required for strategy generation mode'
      });
    }

    // Basic validation only (AI service handles proper validation)
    if (normalizedGenerationMode !== 'strategy_prompt' && (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5)) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be at least 5 characters'
      });
    }

    const sanitizedPrompt =
      normalizedGenerationMode === 'strategy_prompt'
        ? buildStrategyGenerationPrompt({ strategyPrompt, isThread, style })
        : String(prompt || '').trim();

    if (!sanitizedPrompt || sanitizedPrompt.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'Failed to build a valid prompt for generation'
      });
    }

    // Only estimate thread count if isThread is true
    let estimatedThreadCount = 1;
    if (isThread) {
      const threadCountMatch =
        normalizedGenerationMode === 'strategy_prompt'
          ? null
          : String(prompt || '').match(/generate\s+(\d+)\s+threads?/i);
      estimatedThreadCount = threadCountMatch ? parseInt(threadCountMatch[1]) : 1;
    }
    // Calculate estimated credits needed.
    // Default: 1.2 credits per thread. If the selected account/user has X Premium enabled
    // and this is a single (non-thread) generation, charge a flat 5 credits.
    let estimatedCreditsNeeded = estimatedThreadCount * 1.2;
    try {
      const accountId = req.headers['x-selected-account-id'] || null;
      const isTeamAccount = Boolean(req.headers['x-team-id']);
      const prefs = await getTwitterPostingPreferences({ userId: req.user.id, accountId, isTeamAccount });
      const premiumEnabled = Boolean(prefs?.x_long_post_enabled);
      if (!isThread && premiumEnabled) {
        estimatedCreditsNeeded = 5;
      }
    } catch (prefErr) {
      // If preference check fails, fall back to default estimated credits
      console.warn('Failed to resolve posting preferences for credit estimation', prefErr?.message || prefErr);
    }

    // Get team context from header
    const teamId = req.headers['x-team-id'] || null;

    // Check and deduct credits before AI generation based on estimated count
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const resolvedPlanType = await resolveRequestPlanType(req);
    
    // Use TeamCreditService for context-aware credit deduction
    const creditCheck = await TeamCreditService.checkCredits(req.user.id, teamId, estimatedCreditsNeeded);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired: estimatedCreditsNeeded,
        creditsAvailable: creditCheck.available ?? creditCheck.creditsAvailable ?? 0,
        creditSource: creditCheck.source,
        estimatedThreads: estimatedThreadCount
      });
    }
    
    // Deduct estimated credits
    const deductResult = await TeamCreditService.deductCredits(
      req.user.id,
      teamId,
      estimatedCreditsNeeded,
      'ai_text_generation',
      token
    );
    
    if (!deductResult.success) {
      return res.status(402).json({
        success: false,
        error: deductResult.error || 'Failed to deduct credits',
        creditsRequired: estimatedCreditsNeeded,
        creditsAvailable: creditCheck.available ?? creditCheck.creditsAvailable ?? 0,
        creditSource: creditCheck.source
      });
    }

    if (normalizedGenerationMode === 'strategy_prompt') {
      console.log(
        `[AI generation][strategy] source=${effectiveClientSource || 'unknown'} style=${style} thread=${Boolean(isThread)} ideaLen=${strategyPrompt?.idea?.length || 0} instrLen=${strategyPrompt?.instruction?.length || 0} extraContextLen=${strategyPrompt?.extraContext?.length || 0}`
      );
    } else {
      console.log(`AI generation request: "${sanitizedPrompt}" with style: ${style}`);
    }

    // Generate the content, then run quality evaluation for strategy mode
    let result;
    let qualityGuard = null;
    let normalizedThreadParts = null;

    // Extract instruction for quality evaluation (strategy mode only)
    const instructionForEval =
      normalizedGenerationMode === 'strategy_prompt'
        ? String(strategyPrompt?.instruction || '').trim()
        : '';

    try {
      const authTokenForGeneration =
        req.cookies?.accessToken ||
        (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]) ||
        null;

      const firstAttempt = await aiService.generateContent(
        sanitizedPrompt,
        style,
        3,
        authTokenForGeneration,
        req.user.id,
        resolvedPlanType
      );

      if (normalizedGenerationMode !== 'strategy_prompt' || !strategyPrompt) {
        result = firstAttempt;
      } else {
        qualityGuard = {
          mode: 'strategy_prompt',
          checked: true,
          passed: true,
          retried: false,
          issues: [],
        };

        // --- Primary quality evaluation (now includes instruction compliance) ---
        let primaryEval = evaluateStrategyGeneratedContent({
          content: firstAttempt?.content || '',
          isThread: Boolean(isThread),
          instruction: instructionForEval,
        });

        let chosenAttempt = firstAttempt;
        let chosenEval = primaryEval;

        if (!primaryEval.passed) {
          qualityGuard.retried = true;

          console.log(
            `[AI generation][strategy] First attempt failed quality check. Issues: ${primaryEval.issues.join(' | ')}. Retrying...`
          );

          const retryPrompt = buildStrategyGenerationPrompt({
            strategyPrompt,
            isThread,
            style,
            retryContext: { issues: primaryEval.issues },
          });

          if (retryPrompt && retryPrompt.length >= 5) {
            try {
              const retryAttempt = await aiService.generateContent(
                retryPrompt,
                style,
                3,
                authTokenForGeneration,
                req.user.id,
                resolvedPlanType
              );

              // --- Retry quality evaluation ---
              const retryEval = evaluateStrategyGeneratedContent({
                content: retryAttempt?.content || '',
                isThread: Boolean(isThread),
                instruction: instructionForEval,
              });

              // Pick the better result
              if (
                retryEval.passed ||
                (!retryEval.critical &&
                  (chosenEval.critical || retryEval.issues.length <= chosenEval.issues.length))
              ) {
                chosenAttempt = retryAttempt;
                chosenEval = retryEval;
                console.log(
                  `[AI generation][strategy] Retry improved result. Issues remaining: ${retryEval.issues.length}`
                );
              } else {
                console.log(
                  `[AI generation][strategy] Retry did not improve result, keeping first attempt.`
                );
              }
            } catch (retryError) {
              console.error(
                '[AI generation][strategy] retry attempt failed:',
                retryError?.message || retryError
              );
              chosenEval.issues = Array.from(
                new Set([...chosenEval.issues, 'Retry attempt failed'])
              );
            }
          }
        }

        if (chosenEval.critical) {
          const qualityFailureError = new Error(
            `Strategy generation quality check failed: ${
              (chosenEval.issues || []).join('; ') || 'Critical validation failure'
            }`
          );
          qualityFailureError.code = 'STRATEGY_QUALITY_FAILED';
          throw qualityFailureError;
        }

        qualityGuard.passed = Boolean(chosenEval.passed);
        qualityGuard.issues = Array.isArray(chosenEval.issues) ? chosenEval.issues : [];
        normalizedThreadParts =
          Array.isArray(chosenEval.threadParts) ? chosenEval.threadParts : null;

        result = {
          ...chosenAttempt,
          content: chosenEval.normalizedContent || chosenAttempt?.content || '',
        };
      }
    } catch (aiError) {
      // Refund credits if AI generation fails
      console.error('AI generation failed, refunding credits:', estimatedCreditsNeeded);
      await TeamCreditService.refundCredits(
        req.user.id,
        teamId,
        estimatedCreditsNeeded,
        'ai_generation_failed',
        token
      );
      throw aiError;
    }

    // Use the AI-generated content directly (no post-sanitization to prevent [FILTERED])
    const sanitizedContent = result.content;

    // Only treat as thread if isThread is true
    let threadCount = 1;
    let tweets = [sanitizedContent];
    if (isThread) {
      if (Array.isArray(normalizedThreadParts) && normalizedThreadParts.length > 0) {
        threadCount = normalizedThreadParts.length;
        tweets = normalizedThreadParts.map((t) => t.trim()).filter(Boolean);
        console.log(`[AI generation][strategy] Using normalized thread parts: ${threadCount}`);
      } else {
        // Count threads by splitting on "---" separator
        const threadSeparators = sanitizedContent
          .split('---')
          .filter((section) => section.trim().length > 0);
        if (threadSeparators.length > 1) {
          threadCount = threadSeparators.length;
          tweets = threadSeparators.map((t) => t.trim());
          console.log(`Multiple threads detected: ${threadCount} threads (separated by ---)`);
        } else {
          // Fallback: estimate from line count
          const lines = sanitizedContent.split('\n').filter((line) => line.trim().length > 0);
          if (lines.length > 3) {
            threadCount = Math.min(Math.ceil(lines.length / 3), 5);
            tweets = [];
            for (let i = 0; i < lines.length; i += 3) {
              tweets.push(lines.slice(i, i + 3).join('\n'));
            }
            tweets = tweets.slice(0, 5);
            console.log(
              `Long content detected: estimated ${threadCount} tweets based on ${lines.length} lines`
            );
          }
        }
      }
    }

    // Calculate actual credits needed (1.2 credits per thread)
    const actualCreditsNeeded = Math.round(threadCount * 1.2 * 100) / 100;

    // Adjust credits if there's a meaningful difference between estimated and actual
    const creditDifference = Math.round((actualCreditsNeeded - estimatedCreditsNeeded) * 100) / 100;

    if (creditDifference > 0.01) {
      console.log(
        `Deducting additional ${creditDifference} credits (actual: ${threadCount}, estimated: ${estimatedThreadCount})`
      );
      const additionalDeductResult = await TeamCreditService.deductCredits(
        req.user.id,
        teamId,
        creditDifference,
        'ai_thread_adjustment',
        token
      );

      if (!additionalDeductResult.success) {
        await TeamCreditService.refundCredits(
          req.user.id,
          teamId,
          estimatedCreditsNeeded,
          'ai_generation_failed'
        );
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits for actual thread count',
          creditsRequired: actualCreditsNeeded,
          creditsAvailable:
            additionalDeductResult.remainingCredits ??
            additionalDeductResult.creditsAvailable ??
            0,
          threadCount: threadCount,
          estimatedThreads: estimatedThreadCount,
          creditSource: creditCheck.source,
        });
      }
    } else if (creditDifference < -0.01) {
      const refundAmount = Math.abs(creditDifference);
      console.log(
        `Refunding ${refundAmount} excess credits (actual: ${threadCount}, estimated: ${estimatedThreadCount})`
      );
      await TeamCreditService.refundCredits(
        req.user.id,
        teamId,
        refundAmount,
        'ai_thread_adjustment'
      );
    }

    console.log(
      `Final credits used: ${actualCreditsNeeded} for ${threadCount} threads (estimated: ${estimatedThreadCount})`
    );

    // If scheduling is requested, schedule the tweet/thread
    let scheduledResult = null;
    if (schedule) {
      scheduledResult = await scheduledTweetService.scheduleTweets({
        userId: req.user.id,
        tweets,
        options: {
          ...scheduleOptions,
          teamId:
            scheduleOptions.teamId ||
            scheduleOptions.team_id ||
            req.headers['x-team-id'] ||
            null,
          accountId: scheduleOptions.accountId || scheduleOptions.account_id || null,
        },
      });
      if (
        scheduledResult &&
        scheduledResult.scheduledTime &&
        new Date(scheduledResult.scheduledTime) <= new Date()
      ) {
        await scheduledTweetService.processSingleScheduledTweetById(scheduledResult.scheduledId);
        scheduledResult.posted = true;
      } else {
        scheduledResult.posted = false;
      }
    }

    res.json({
      success: true,
      content: sanitizedContent,
      provider: result.provider,
      keyType: result.keyType,
      threadCount: threadCount,
      estimatedThreads: estimatedThreadCount,
      creditsUsed: actualCreditsNeeded,
      creditSource: creditCheck.source,
      generatedAt: new Date().toISOString(),
      scheduled: schedule ? true : false,
      scheduledResult,
      ...(Array.isArray(normalizedThreadParts) && normalizedThreadParts.length > 0
        ? { threadParts: normalizedThreadParts }
        : {}),
      ...(qualityGuard ? { qualityGuard } : {}),
    });
  } catch (error) {
    console.error('AI generation error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to generate content',
      details: error.message,
    });
  }
});

// Generate multiple content options
router.post('/generate-options', authenticateToken, async (req, res) => {
  try {
    const { prompt, style = 'casual', count = 3 } = req.body;

    // Rate limiting
    if (!checkRateLimit(req.user.id, 'ai_generation', 10, 60000)) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait before making more requests.'
      });
    }

    // Basic validation only (AI service handles proper validation)
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be at least 5 characters'
      });
    }

    const sanitizedPrompt = prompt.trim();

    if (count > 5) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 5 options allowed'
      });
    }

    // Validate style parameter
    const allowedStyles = ['casual', 'professional', 'humorous', 'inspirational', 'informative', 'witty'];
    if (!allowedStyles.includes(style)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid style parameter'
      });
    }

    // Calculate credits based on number of options (1.2 credits per option)
    const creditsRequired = count * 1.2;

    // Check and deduct credits before AI generation
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const resolvedPlanType = await resolveRequestPlanType(req);
    
    const creditCheck = await creditService.checkAndDeductCredits(req.user.id, 'ai_text_generation_multiple', creditsRequired, token);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired,
        creditsAvailable: creditCheck.creditsAvailable ?? creditCheck.available ?? 0
      });
    }

    console.log(`AI multiple options request: "${sanitizedPrompt}" with style: ${style}, count: ${count}`);

    const result = await aiService.generateMultipleOptions(sanitizedPrompt, style, count, {
      userToken: token,
      userId: req.user.id,
      planType: resolvedPlanType,
    });

    const sanitizedOptions = result.options;

    res.json({
      success: true,
      options: sanitizedOptions,
      errors: result.errors,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI generation error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate content options',
      details: error.message
    });
  }
});

// Generate image content with AI
router.post('/generate-image', authenticateToken, async (req, res) => {
  try {
    const { prompt, imageUrl } = req.body;

    // Rate limiting
    if (!checkRateLimit(req.user.id, 'ai_image', 5, 60000)) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait before making more requests.'
      });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be at least 3 characters'
      });
    }

    const sanitizedPrompt = prompt.trim();

    if (imageUrl) {
      try {
        new URL(imageUrl);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid image URL'
        });
      }
    }

    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    const creditCheck = await creditService.checkAndDeductCredits(req.user.id, 'ai_image_analysis', 2.5, token);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired: 2.5,
        creditsAvailable: creditCheck.creditsAvailable ?? creditCheck.available ?? 0
      });
    }

    console.log(`AI image generation request: "${sanitizedPrompt}"`);

    const result = await aiService.generateImageContent(sanitizedPrompt, imageUrl);

    const sanitizedContent = result.content;

    res.json({
      success: true,
      content: sanitizedContent,
      provider: result.provider,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI image generation error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate image content',
      details: error.message
    });
  }
});

export default router;