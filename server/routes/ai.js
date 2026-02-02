import express from 'express';
import { aiService } from '../services/aiService.js';
import { authenticateToken } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';
import { TeamCreditService } from '../services/teamCreditService.js';
import { sanitizeInput, sanitizeAIPrompt, checkRateLimit } from '../utils/sanitization.js';
// import { bulkGenerate } from '../controllers/aiController.js';

const router = express.Router();

// Synchronous bulk generation endpoint (no queue, no Redis)
// Scheduling service import (assume exists, adjust import if needed)
import { scheduledTweetService } from '../services/scheduledTweetService.js';

router.post('/bulk-generate', authenticateToken, async (req, res) => {
  try {
    const { prompts, options, schedule = false, scheduleOptions = {} } = req.body;
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: 'No prompts provided' });
    }
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Synchronously generate content for each prompt
    const results = [];
    const scheduled = [];
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const opt = options && options[i] ? options[i] : {};
      try {
        const result = await aiService.generateContent(prompt, opt.style || 'casual');
        results.push({ success: true, result });
        // If scheduling is requested, schedule the tweet/thread
        if (schedule) {
          // If thread, split by '---', else single tweet
          const tweets = result.content.includes('---')
            ? result.content.split('---').map(t => t.trim()).filter(Boolean)
            : [result.content.trim()];
          // Schedule the tweets for future posting
          const scheduledResult = await scheduledTweetService.scheduleTweets({
            userId,
            tweets,
            options: { ...scheduleOptions, ...opt }
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
    const { prompt, style = 'casual', isThread = false, schedule = false, scheduleOptions = {} } = req.body;

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

    // Validate style parameter
    const allowedStyles = ['casual', 'professional', 'humorous', 'inspirational', 'informative'];
    if (!allowedStyles.includes(style)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid style parameter'
      });
    }

    // Only estimate thread count if isThread is true
    let estimatedThreadCount = 1;
    if (isThread) {
      const threadCountMatch = prompt.match(/generate\s+(\d+)\s+threads?/i);
      estimatedThreadCount = threadCountMatch ? parseInt(threadCountMatch[1]) : 1;
    }
    // Calculate estimated credits needed (1.2 credits per thread)
    const estimatedCreditsNeeded = estimatedThreadCount * 1.2;

    // Get team context from header
    const teamId = req.headers['x-team-id'] || null;

    // Check and deduct credits before AI generation based on estimated count
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    
    // Use TeamCreditService for context-aware credit deduction
    const creditCheck = await TeamCreditService.checkCredits(req.user.id, teamId, estimatedCreditsNeeded);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired: estimatedCreditsNeeded,
        creditsAvailable: creditCheck.available || 0,
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
        creditsAvailable: creditCheck.available || 0,
        creditSource: creditCheck.source
      });
    }

    console.log(`AI generation request: "${sanitizedPrompt}" with style: ${style}`);

    // First generate the content to analyze thread count
  const result = await aiService.generateContent(sanitizedPrompt, style, 3, req.cookies?.accessToken || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]) || null, req.user.id);

    // Use the AI-generated content directly (no post-sanitization to prevent [FILTERED])
    const sanitizedContent = result.content;

    // Only treat as thread if isThread is true
    let threadCount = 1;
    let tweets = [sanitizedContent];
    if (isThread) {
      // Count threads by splitting on "---" separator (the actual format used by AI service)
      const threadSeparators = sanitizedContent.split('---').filter(section => section.trim().length > 0);
      if (threadSeparators.length > 1) {
        threadCount = threadSeparators.length;
        tweets = threadSeparators.map(t => t.trim());
        console.log(`Multiple threads detected: ${threadCount} threads (separated by ---)`);
      } else {
        // Fallback: if no --- separators, check if it's a single long thread
        const lines = sanitizedContent.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 3) {
          threadCount = Math.min(Math.ceil(lines.length / 3), 5); // Estimate 3 lines per tweet, cap at 5
          // Split into tweets of 3 lines each
          tweets = [];
          for (let i = 0; i < lines.length; i += 3) {
            tweets.push(lines.slice(i, i + 3).join('\n'));
          }
          tweets = tweets.slice(0, 5);
          console.log(`Long content detected: estimated ${threadCount} tweets based on ${lines.length} lines`);
        }
      }
    }

    // Calculate actual credits needed (1.2 credits per thread)
    const actualCreditsNeeded = Math.round((threadCount * 1.2) * 100) / 100; // Round to 2 decimal places

    // Adjust credits if there's a difference between estimated and actual
    const creditDifference = Math.round((actualCreditsNeeded - estimatedCreditsNeeded) * 100) / 100;

    if (creditDifference > 0.01) { // Only adjust if difference is significant (> 1 cent)
      // Need to deduct more credits
      console.log(`Deducting additional ${creditDifference} credits (actual: ${threadCount}, estimated: ${estimatedThreadCount})`);
      const additionalDeductResult = await TeamCreditService.deductCredits(
        req.user.id,
        teamId,
        creditDifference,
        'ai_thread_adjustment',
        token
      );
      
      if (!additionalDeductResult.success) {
        // Refund the initial credits since we can't complete the request
        await TeamCreditService.refundCredits(req.user.id, teamId, estimatedCreditsNeeded, 'ai_generation_failed');
        
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits for actual thread count',
          creditsRequired: actualCreditsNeeded,
          creditsAvailable: additionalDeductResult.remainingCredits || 0,
          threadCount: threadCount,
          estimatedThreads: estimatedThreadCount,
          creditSource: creditCheck.source
        });
      }
    } else if (creditDifference < -0.01) { // Only refund if difference is significant
      // Refund excess credits
      const refundAmount = Math.abs(creditDifference);
      console.log(`Refunding ${refundAmount} excess credits (actual: ${threadCount}, estimated: ${estimatedThreadCount})`);
      await TeamCreditService.refundCredits(req.user.id, teamId, refundAmount, 'ai_thread_adjustment');
    }

    console.log(`Final credits used: ${actualCreditsNeeded} for ${threadCount} threads (estimated: ${estimatedThreadCount})`);

    // If scheduling is requested, schedule the tweet/thread

    let scheduledResult = null;
    if (schedule) {
      scheduledResult = await scheduledTweetService.scheduleTweets({
        userId: req.user.id,
        tweets,
        options: scheduleOptions
      });
      // Optionally, immediately post if scheduled time is now or in the past
      if (scheduledResult && scheduledResult.scheduledTime && new Date(scheduledResult.scheduledTime) <= new Date()) {
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
      scheduledResult
    });

  } catch (error) {
    console.error('AI generation error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate content',
      details: error.message
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
    const allowedStyles = ['casual', 'professional', 'humorous', 'inspirational', 'informative'];
    if (!allowedStyles.includes(style)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid style parameter'
      });
    }

    // Calculate credits based on number of options (1.2 credits per option)
    const creditsRequired = count * 1.2;

    // Check and deduct credits before AI generation
    // Get the JWT token from cookies or Authorization header
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    
    const creditCheck = await creditService.checkAndDeductCredits(req.user.id, 'ai_text_generation_multiple', creditsRequired, token);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired,
        creditsAvailable: creditCheck.creditsAvailable || 0
      });
    }

    console.log(`AI multiple options request: "${sanitizedPrompt}" with style: ${style}, count: ${count}`);

    const result = await aiService.generateMultipleOptions(sanitizedPrompt, style, count);

    // Use AI-generated options directly (no post-sanitization to prevent [FILTERED])
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

    // Basic validation only (AI service handles proper validation)  
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be at least 3 characters'
      });
    }

    const sanitizedPrompt = prompt.trim();

    // Check if imageUrl is provided and validate it
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

    // Check and deduct credits for image analysis
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
        creditsAvailable: creditCheck.creditsAvailable || 0
      });
    }

    console.log(`AI image generation request: "${sanitizedPrompt}"`);

    const result = await aiService.generateImageContent(sanitizedPrompt, imageUrl);

    // Use AI-generated content directly (no post-sanitization to prevent [FILTERED])
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

// Bulk AI generation (multiple prompts)

// New: Enqueue bulk generation jobs, return job IDs

// router.post('/bulk-generate', authenticateToken, bulkGenerate);

export default router;
