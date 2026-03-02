import express from 'express';
import { profileAnalysisService } from '../services/profileAnalysisService.js';
import { creditService } from '../services/creditService.js';
import { strategyService } from '../services/strategyService.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('Profile Analysis'));

// POST /api/profile-analysis/analyse — kicks off full analysis pipeline
router.post('/analyse', async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategyId } = req.body;

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

    // Run analysis
    const result = await profileAnalysisService.runFullAnalysis(userId, strategyId);

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
    console.error('[ProfileAnalysis Route] Analysis error:', error);
    // Refund credits on failure
    try {
      await creditService.refundCredits(req.user.id, 'profile_analysis_failed', 5);
    } catch {}
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

// GET /api/profile-analysis/status/:analysisId — poll analysis status
router.get('/status/:analysisId', async (req, res) => {
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
    console.error('[ProfileAnalysis Route] Status error:', error);
    res.status(500).json({ error: 'Failed to get analysis status' });
  }
});

// GET /api/profile-analysis/latest — get latest analysis for user
router.get('/latest', async (req, res) => {
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
    console.error('[ProfileAnalysis Route] Latest error:', error);
    res.status(500).json({ error: 'Failed to get latest analysis' });
  }
});

// POST /api/profile-analysis/:analysisId/confirm — confirm/edit a step
router.post('/:analysisId/confirm', async (req, res) => {
  try {
    const { analysisId } = req.params;
    const { step, value } = req.body;

    if (!step || value === undefined) {
      return res.status(400).json({ error: 'step and value are required' });
    }

    const allowedSteps = ['niche', 'audience', 'tone', 'goals', 'topics', 'posting_frequency'];
    if (!allowedSteps.includes(step)) {
      return res.status(400).json({ error: `Invalid step. Allowed: ${allowedSteps.join(', ')}` });
    }

    // Verify ownership
    const analysis = await profileAnalysisService.getAnalysis(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const updatedData = await profileAnalysisService.confirmAnalysisStep(analysisId, step, value);
    res.json({ success: true, analysisData: updatedData });
  } catch (error) {
    console.error('[ProfileAnalysis Route] Confirm error:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm step' });
  }
});

// POST /api/profile-analysis/:analysisId/reference-accounts — analyse competitors
router.post('/:analysisId/reference-accounts', async (req, res) => {
  try {
    const { analysisId } = req.params;
    const { handles } = req.body;

    if (!Array.isArray(handles) || handles.length === 0) {
      return res.status(400).json({ error: 'handles array is required' });
    }

    // Verify ownership
    const analysis = await profileAnalysisService.getAnalysis(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // 2 credits per reference account
    const creditCost = Math.min(handles.length, 2) * 2;
    const creditResult = await creditService.checkAndDeductCredits(req.user.id, 'reference_analysis', creditCost);
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
    console.error('[ProfileAnalysis Route] Reference error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyse reference accounts' });
  }
});

// POST /api/profile-analysis/:analysisId/generate-prompts — generate prompt library
router.post('/:analysisId/generate-prompts', async (req, res) => {
  try {
    const { analysisId } = req.params;
    const { strategyId } = req.body;

    if (!strategyId) {
      return res.status(400).json({ error: 'strategyId is required' });
    }

    // Verify ownership
    const analysis = await profileAnalysisService.getAnalysis(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // 10 credits for prompt generation  
    const creditResult = await creditService.checkAndDeductCredits(req.user.id, 'analysis_prompt_generation', 10);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. 10 credits required for prompt generation.',
        available: creditResult.available,
        required: creditResult.required,
      });
    }

    const result = await profileAnalysisService.generateAnalysisPrompts(analysisId, strategyId, req.user.id);

    res.json({
      success: true,
      promptCount: result.count,
      prompts: result.prompts,
    });
  } catch (error) {
    console.error('[ProfileAnalysis Route] Generate prompts error:', error);
    try {
      await creditService.refundCredits(req.user.id, 'analysis_prompt_generation_failed', 10);
    } catch {}
    res.status(500).json({ error: error.message || 'Failed to generate prompts' });
  }
});

export default router;
