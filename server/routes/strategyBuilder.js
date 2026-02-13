import express from 'express';
import { strategyService } from '../services/strategyService.js';
import { authenticateToken } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';

const router = express.Router();

// Get or create current strategy
router.get('/current', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;

    const strategy = await strategyService.getOrCreateStrategy(userId, teamId);
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
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    const { niche, target_audience, posting_frequency, content_goals, topics, status = 'draft' } = req.body;

    if (!niche || !niche.trim()) {
      return res.status(400).json({ error: 'Niche/strategy name is required' });
    }

    const strategy = await strategyService.createStrategy(userId, teamId, {
      niche: niche.trim(),
      target_audience: target_audience?.trim() || '',
      posting_frequency: posting_frequency?.trim() || '',
      content_goals: Array.isArray(content_goals) ? content_goals : [],
      topics: Array.isArray(topics) ? topics : [],
      status
    });

    res.status(201).json(strategy);
  } catch (error) {
    console.error('Error creating strategy:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

// Send chat message
router.post('/chat', authenticateToken, async (req, res) => {
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
router.post('/:id/generate-prompts', authenticateToken, async (req, res) => {
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

// Get all strategies for user
router.get('/list', authenticateToken, async (req, res) => {
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
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const strategy = await strategyService.getStrategy(id);
    
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const chatHistory = await strategyService.getChatHistory(id);
    const prompts = await strategyService.getPrompts(id);

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
router.get('/:id/prompts', authenticateToken, async (req, res) => {
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

// Toggle favorite prompt
router.post('/prompts/:promptId/favorite', authenticateToken, async (req, res) => {
  try {
    const { promptId } = req.params;
    const prompt = await strategyService.toggleFavoritePrompt(promptId);
    res.json(prompt);
  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Update strategy
router.patch('/:id', authenticateToken, async (req, res) => {
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
router.delete('/:id', authenticateToken, async (req, res) => {
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

export default router;
