import express from 'express';
import pool from '../config/database.js';
import { strategyService } from '../services/strategyService.js';
import { creditService } from '../services/creditService.js';
import { aiService } from '../services/aiService.js';
import { profileAnalysisService } from '../services/profileAnalysisService.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('Strategy Builder'));

const stripMarkdownCodeFences = (value = '') =>
  String(value)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

const parseAddonAIOutput = (content) => {
  const normalizedContent = stripMarkdownCodeFences(content);
  let parsed = null;

  try {
    parsed = JSON.parse(normalizedContent);
  } catch (directParseError) {
    const jsonMatch = normalizedContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI response is not valid JSON');
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response is not a valid object');
  }

  return {
    content_goals: Array.isArray(parsed.content_goals) ? parsed.content_goals : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
  };
};

// Get or create current strategy
router.get('/current', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;

    const strategy = await strategyService.getOrCreateStrategy(userId, teamId);
    // Fetch chat history in parallel with the response assembly
    const chatHistory = await strategyService.getChatHistory(strategy.id);

    res.json({
      strategy,
      chatHistory
    });
  } catch (error) {
    console.error('Error getting strategy:', error);
    res.status(500).json({ error: 'Failed to get strategy' });
  }
});

// Create new strategy
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    const {
      niche,
      target_audience,
      posting_frequency,
      content_goals,
      topics,
      status = 'draft',
      metadata = {},
    } = req.body;

    if (!niche || !niche.trim()) {
      return res.status(400).json({ error: 'Niche/strategy name is required' });
    }

    const strategy = await strategyService.createStrategy(userId, teamId, {
      niche: niche.trim(),
      target_audience: target_audience?.trim() || '',
      posting_frequency: posting_frequency?.trim() || '',
      content_goals: Array.isArray(content_goals) ? content_goals : [],
      topics: Array.isArray(topics) ? topics : [],
      status,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    });

    res.status(201).json(strategy);
  } catch (error) {
    console.error('Error creating strategy:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

// Send chat message
router.post('/chat', async (req, res) => {
  try {
    const userId = req.user.id;
    const { message, strategyId, currentStep = 0 } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let strategy;
    if (strategyId) {
      strategy = await strategyService.getStrategy(strategyId);
    } else {
      const teamId = req.headers['x-team-id'] || null;
      strategy = await strategyService.getOrCreateStrategy(userId, teamId);
    }

    // Check and deduct credits (0.5 credits per message)
    const creditResult = await creditService.checkAndDeductCredits(
      userId,
      'strategy_chat',
      0.5
    );

    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits',
        available: creditResult.available,
        required: creditResult.required
      });
    }

    // Process message
    const response = await strategyService.processChatMessage(
      strategy.id,
      userId,
      message.trim(),
      currentStep
    );

    res.json(response);
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Generate prompts for strategy
router.post('/:id/generate-prompts', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if strategy belongs to user
    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Check and deduct credits (10 credits for generating prompts)
    const creditResult = await creditService.checkAndDeductCredits(
      userId,
      'strategy_prompts_generation',
      10
    );

    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. Need 10 credits to generate prompts.',
        available: creditResult.available,
        required: creditResult.required
      });
    }

    // Generate prompts
    const result = await strategyService.generatePrompts(id, userId);

    res.json(result);
  } catch (error) {
    console.error('Error generating prompts:', error);
    res.status(500).json({ error: 'Failed to generate prompts' });
  }
});

// Incremental add-on for goals/topics
router.post('/:id/add-on', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { source, content_goals, topics, prompt } = req.body || {};

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    if (!source || !['manual', 'ai'].includes(source)) {
      return res.status(400).json({ error: 'Invalid source. Use "manual" or "ai".' });
    }

    let additions = {
      content_goals: [],
      topics: [],
    };

    if (source === 'manual') {
      if (!Array.isArray(content_goals) && !Array.isArray(topics)) {
        return res.status(400).json({
          error: 'Invalid payload. Provide content_goals and/or topics arrays.'
        });
      }

      additions = {
        content_goals: Array.isArray(content_goals) ? content_goals : [],
        topics: Array.isArray(topics) ? topics : [],
      };
    } else {
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
        return res.status(400).json({ error: 'Prompt is required for AI add-on and must be at least 5 characters.' });
      }

      const creditResult = await creditService.checkAndDeductCredits(
        userId,
        'strategy_addon_ai',
        0.5
      );

      if (!creditResult.success) {
        return res.status(402).json({
          error: 'Insufficient credits',
          available: creditResult.available,
          required: creditResult.required
        });
      }

      const authHeader = req.headers['authorization'];
      const token = req.cookies?.accessToken || (authHeader && authHeader.split(' ')[1]) || null;

      try {
        const aiPrompt = [
          'Return ONLY valid JSON. No markdown, no extra keys.',
          'Schema: {"content_goals": string[], "topics": string[]}',
          'Rules: max 20 items each, concise phrases, no numbering.',
          `User request: ${prompt.trim()}`
        ].join('\n');

        const aiResult = await aiService.generateStrategyContent(
          aiPrompt,
          'professional',
          token,
          userId
        );

        additions = parseAddonAIOutput(aiResult?.content || '');
      } catch (aiError) {
        await creditService.refundCredits(userId, 'strategy_addon_ai_failed', 0.5);
        throw aiError;
      }
    }

    if (
      (!Array.isArray(additions.content_goals) || additions.content_goals.length === 0) &&
      (!Array.isArray(additions.topics) || additions.topics.length === 0)
    ) {
      if (source === 'ai') {
        await creditService.refundCredits(userId, 'strategy_addon_ai_empty', 0.5);
      }
      return res.status(400).json({
        error: 'No valid goals/topics to add.'
      });
    }

    const result = await strategyService.appendStrategyFields(
      id,
      additions,
      { source: source === 'ai' ? 'ai_add_on' : 'manual_add_on' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error processing strategy add-on:', error);
    res.status(500).json({ error: 'Failed to process strategy add-on' });
  }
});

// Get all strategies for user
router.get('/list', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;

    const strategies = await strategyService.getUserStrategies(userId, teamId);
    res.json(strategies);
  } catch (error) {
    console.error('Error getting strategies:', error);
    res.status(500).json({ error: 'Failed to get strategies' });
  }
});

// Get strategy by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const strategy = await strategyService.getStrategy(id);

    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Fetch chat history and prompts in parallel
    const [chatHistory, prompts] = await Promise.all([
      strategyService.getChatHistory(id),
      strategyService.getPrompts(id),
    ]);

    res.json({
      strategy,
      chatHistory,
      prompts
    });
  } catch (error) {
    console.error('Error getting strategy:', error);
    res.status(500).json({ error: 'Failed to get strategy' });
  }
});

// Get prompts for strategy
router.get('/:id/prompts', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { category, favorite, limit } = req.query;

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const filters = {
      category,
      isFavorite: favorite === 'true',
      limit: limit ? parseInt(limit) : undefined
    };

    const prompts = await strategyService.getPrompts(id, filters);
    res.json(prompts);
  } catch (error) {
    console.error('Error getting prompts:', error);
    res.status(500).json({ error: 'Failed to get prompts' });
  }
});

// Refresh prompt performance metrics from already-synced analytics data
router.post('/:id/prompts/refresh-metrics', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const lookbackDays = req.body?.lookbackDays;

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const refresh = await strategyService.refreshPromptMetrics(id, { lookbackDays });
    const prompts = await strategyService.getPrompts(id);

    res.json({
      success: true,
      refresh,
      prompts,
    });
  } catch (error) {
    console.error('Error refreshing prompt metrics:', error);
    res.status(500).json({ error: 'Failed to refresh prompt metrics' });
  }
});

// Toggle favorite prompt
router.post('/prompts/:promptId/favorite', async (req, res) => {
  try {
    const { promptId } = req.params;
    const prompt = await strategyService.toggleFavoritePrompt(promptId);
    res.json(prompt);
  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Create a custom prompt (user's own idea)
router.post('/:id/prompts', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { prompt_text, category } = req.body;

    if (!prompt_text || typeof prompt_text !== 'string' || prompt_text.trim().length < 5) {
      return res.status(400).json({ error: 'prompt_text is required (min 5 characters)' });
    }

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Auto-assign category if not provided
    const VALID_CATEGORIES = ['educational', 'engagement', 'storytelling', 'tips & tricks', 'promotional', 'inspirational'];
    let assignedCategory = 'general';
    if (category && VALID_CATEGORIES.includes(category.toLowerCase())) {
      assignedCategory = category.toLowerCase();
    } else {
      const text = prompt_text.toLowerCase();
      if (/teach|explain|break down|how to|guide|lesson|learn|tutorial/i.test(text)) {
        assignedCategory = 'educational';
      } else if (/poll|question|ask|reply|retweet|share your|what do you/i.test(text)) {
        assignedCategory = 'engagement';
      } else if (/story|journey|experience|behind.the.scene|day in|personal|struggled|failed/i.test(text)) {
        assignedCategory = 'storytelling';
      } else if (/tip|trick|hack|shortcut|mistake|avoid|checklist|framework/i.test(text)) {
        assignedCategory = 'tips & tricks';
      } else if (/launch|product|feature|update|announcement|offer|discount|sale/i.test(text)) {
        assignedCategory = 'promotional';
      } else if (/motivat|inspir|mindset|lesson|growth|believe|persever|success/i.test(text)) {
        assignedCategory = 'inspirational';
      } else {
        assignedCategory = 'educational'; // sensible default
      }
    }

    const { rows: [newPrompt] } = await pool.query(
      `INSERT INTO strategy_prompts (strategy_id, category, prompt_text, variables)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        id,
        assignedCategory,
        prompt_text.trim(),
        JSON.stringify({ source: 'user_custom', instruction: '', recommended_format: 'single_tweet', goal: '', hashtags_hint: '' }),
      ]
    );

    res.status(201).json(newPrompt);
  } catch (error) {
    console.error('Error creating custom prompt:', error);
    res.status(500).json({ error: 'Failed to create prompt' });
  }
});

// Delete a prompt
router.delete('/prompts/:promptId', async (req, res) => {
  try {
    const { promptId } = req.params;
    const userId = req.user.id;

    // Verify ownership: prompt → strategy → user
    const { rows: [prompt] } = await pool.query(
      `SELECT sp.id, sp.strategy_id
       FROM strategy_prompts sp
       JOIN user_strategies us ON us.id = sp.strategy_id
       WHERE sp.id = $1 AND us.user_id = $2`,
      [promptId, userId]
    );

    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    await pool.query(`DELETE FROM strategy_prompts WHERE id = $1`, [promptId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});

// Update strategy
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const updated = await strategyService.updateStrategy(id, updates);
    res.json(updated);
  } catch (error) {
    console.error('Error updating strategy:', error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});

// Delete strategy
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await strategyService.deleteStrategy(id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting strategy:', error);
    res.status(500).json({ error: 'Failed to delete strategy' });
  }
});

// ─── Profile Analysis Routes ────────────────────────────────────────────

// POST /api/strategy/init-analysis — kicks off full analysis pipeline
router.post('/init-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategyId, portfolioUrl, userContext } = req.body;

    if (!strategyId) {
      return res.status(400).json({ error: 'strategyId is required' });
    }

    // Verify strategy belongs to user
    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Check credits (5 credits for full analysis)
    const creditResult = await creditService.checkAndDeductCredits(userId, 'profile_analysis', 5);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. 5 credits required for profile analysis.',
        available: creditResult.available,
        required: creditResult.required,
      });
    }

    // Run analysis pipeline
    const result = await profileAnalysisService.runFullAnalysis(userId, strategyId, {
      portfolioUrl,
      userContext: userContext?.slice(0, 300)
    });

    res.json({
      success: true,
      analysisId: result.analysisId,
      analysis: result.analysisData,
      trending: result.trendingTopics,
      tweetsAnalysed: result.tweetsAnalysed,
      tweetSource: result.tweetSource,
      confidence: result.confidence,
      confidenceReason: result.confidenceReason,
    });
  } catch (error) {
    console.error('[Strategy] init-analysis error:', error);
    // Refund credits on failure
    try {
      await creditService.refundCredits(req.user.id, 'profile_analysis_failed', 5);
    } catch { }

    // Return user-friendly messages for known error types
    const msg = error.message || 'Analysis failed';
    if (msg.includes('429')) {
      return res.status(429).json({ error: 'AI rate limit reached. Please wait 1-2 minutes and try again.' });
    }
    if (msg.includes('Twitter account not connected')) {
      return res.status(400).json({ error: 'Twitter account not connected. Please connect your X account in Settings first.' });
    }
    res.status(500).json({ error: msg });
  }
});

// POST /api/strategy/apply-analysis — confirm/edit a step during analysis
router.post('/apply-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const { analysisId, step, value } = req.body;

    if (!analysisId || !step || value === undefined) {
      return res.status(400).json({ error: 'analysisId, step, and value are required' });
    }

    const allowedSteps = ['niche', 'audience', 'tone', 'goals', 'topics', 'posting_frequency', 'extra_context'];
    if (!allowedSteps.includes(step)) {
      return res.status(400).json({ error: `Invalid step. Allowed: ${allowedSteps.join(', ')}` });
    }

    // Verify ownership
    const analysis = await profileAnalysisService.getAnalysis(analysisId);
    if (!analysis || analysis.user_id !== userId) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Handle extra_context step specially - it updates strategy metadata
    if (step === 'extra_context') {
      const { deeper_url, deeper_context } = value;
      await profileAnalysisService.updateExtraContext(analysis.strategy_id, deeper_url, deeper_context);
      return res.json({ success: true });
    }

    const updatedData = await profileAnalysisService.confirmAnalysisStep(analysisId, step, value);
    res.json({ success: true, analysisData: updatedData });
  } catch (error) {
    console.error('[Strategy] apply-analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm step' });
  }
});

// POST /api/strategy/reference-analysis — analyse competitor/reference accounts
router.post('/reference-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const { analysisId, handles } = req.body;

    if (!analysisId || !Array.isArray(handles) || handles.length === 0) {
      return res.status(400).json({ error: 'analysisId and handles array are required' });
    }

    // Verify ownership
    const analysis = await profileAnalysisService.getAnalysis(analysisId);
    if (!analysis || analysis.user_id !== userId) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // 5 credits per reference account (max 2 accounts = 10 credits)
    const creditCost = Math.min(handles.filter(Boolean).length, 2) * 5;
    const creditResult = await creditService.checkAndDeductCredits(userId, 'reference_analysis', creditCost);
    if (!creditResult.success) {
      return res.status(402).json({
        error: `Insufficient credits. ${creditCost} credits required.`,
        available: creditResult.available,
        required: creditResult.required,
      });
    }

    const results = await profileAnalysisService.analyseReferenceAccounts(analysisId, handles);
    res.json({ success: true, referenceAccounts: results });
  } catch (error) {
    console.error('[Strategy] reference-analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyse reference accounts' });
  }
});

// POST /api/strategy/generate-analysis-prompts — generate prompt library from analysis
router.post('/generate-analysis-prompts', async (req, res) => {
  try {
    const userId = req.user.id;
    const { analysisId, strategyId } = req.body;

    if (!analysisId || !strategyId) {
      return res.status(400).json({ error: 'analysisId and strategyId are required' });
    }

    // Verify ownership
    const analysis = await profileAnalysisService.getAnalysis(analysisId);
    if (!analysis || analysis.user_id !== userId) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // 10 credits for prompt generation
    const creditResult = await creditService.checkAndDeductCredits(userId, 'analysis_prompt_generation', 10);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. 10 credits required for prompt generation.',
        available: creditResult.available,
        required: creditResult.required,
      });
    }

    const result = await profileAnalysisService.generateAnalysisPrompts(analysisId, strategyId, userId);

    res.json({
      success: true,
      promptCount: result.count,
      prompts: result.prompts,
    });
  } catch (error) {
    console.error('[Strategy] generate-analysis-prompts error:', error);
    try {
      await creditService.refundCredits(req.user.id, 'analysis_prompt_generation_failed', 10);
    } catch { }
    res.status(500).json({ error: error.message || 'Failed to generate prompts' });
  }
});

// GET /api/strategy/analysis-status/:analysisId — poll analysis status
router.get('/analysis-status/:analysisId', async (req, res) => {
  try {
    const analysis = await profileAnalysisService.getAnalysis(req.params.analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json({
      id: analysis.id,
      status: analysis.status,
      confidence: analysis.confidence,
      confidenceReason: analysis.confidence_reason,
      tweetsAnalysed: analysis.tweets_analysed,
      analysisData: analysis.analysis_data,
      trendingTopics: analysis.trending_topics,
      referenceAccounts: analysis.reference_accounts,
      error: analysis.error_message,
      createdAt: analysis.created_at,
    });
  } catch (error) {
    console.error('[Strategy] analysis-status error:', error);
    res.status(500).json({ error: 'Failed to get analysis status' });
  }
});

// GET /api/strategy/latest-analysis — get latest analysis for user
router.get('/latest-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const strategyId = req.query.strategyId || null;

    const analysis = await profileAnalysisService.getLatestAnalysis(userId, strategyId);
    if (!analysis) {
      return res.status(404).json({ error: 'No analysis found' });
    }

    res.json({
      id: analysis.id,
      status: analysis.status,
      confidence: analysis.confidence,
      confidenceReason: analysis.confidence_reason,
      tweetsAnalysed: analysis.tweets_analysed,
      analysisData: analysis.analysis_data,
      trendingTopics: analysis.trending_topics,
      referenceAccounts: analysis.reference_accounts,
      error: analysis.error_message,
      createdAt: analysis.created_at,
    });
  } catch (error) {
    console.error('[Strategy] latest-analysis error:', error);
    res.status(500).json({ error: 'Failed to get latest analysis' });
  }
});

export default router;
