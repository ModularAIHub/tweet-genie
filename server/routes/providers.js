import express from 'express';
import pool from '../config/database.js';
import { aiService } from '../services/aiService.js';

const router = express.Router();

// Get AI providers and their status
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's AI provider preferences from central hub
    const hubProviders = await aiService.getHubProviders(userId);

    // Get user's personal API keys
    const { rows: userProviders } = await pool.query(
      `SELECT provider, is_active, created_at 
       FROM user_ai_providers 
       WHERE user_id = $1 
       ORDER BY provider`,
      [userId]
    );

    const providers = [
      {
        name: 'openai',
        display_name: 'OpenAI GPT',
        hub_available: hubProviders.openai?.available || false,
        user_configured: userProviders.some(p => p.provider === 'openai' && p.is_active),
        models: ['gpt-3.5-turbo', 'gpt-4']
      },
      {
        name: 'perplexity',
        display_name: 'Perplexity AI',
        hub_available: hubProviders.anthropic?.available || false,
        user_configured: userProviders.some(p => p.provider === 'anthropic' && p.is_active),
        models: ['claude-3-haiku', 'claude-3-sonnet']
      },
      {
        name: 'google',
        display_name: 'Google Gemini',
        hub_available: hubProviders.google?.available || false,
        user_configured: userProviders.some(p => p.provider === 'google' && p.is_active),
        models: ['gemini-pro']
      }
    ];

    res.json({ providers });

  } catch (error) {
    console.error('Get providers error:', error);
    res.status(500).json({ error: 'Failed to fetch AI providers' });
  }
});

// Configure user's AI provider
router.post('/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const { api_key } = req.body;
    const userId = req.user.id;

    if (!['openai', 'anthropic', 'google'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    if (!api_key || api_key.trim().length === 0) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Test the API key
    const isValid = await aiService.validateApiKey(provider, api_key);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid API key' });
    }

    // Store encrypted API key
    await pool.query(
      `INSERT INTO user_ai_providers (user_id, provider, encrypted_api_key, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET 
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         is_active = EXCLUDED.is_active,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, provider, await aiService.encryptApiKey(api_key)]
    );

    res.json({ 
      success: true, 
      message: `${provider} API key configured successfully` 
    });

  } catch (error) {
    console.error('Configure provider error:', error);
    res.status(500).json({ error: 'Failed to configure AI provider' });
  }
});

// Remove user's AI provider
router.delete('/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user.id;

    await pool.query(
      'UPDATE user_ai_providers SET is_active = false WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );

    res.json({ 
      success: true, 
      message: `${provider} provider removed successfully` 
    });

  } catch (error) {
    console.error('Remove provider error:', error);
    res.status(500).json({ error: 'Failed to remove AI provider' });
  }
});

// Test AI provider
router.post('/:provider/test', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user.id;

    const testResult = await aiService.testProvider(provider, userId);

    res.json({
      success: testResult.success,
      message: testResult.message,
      response_time: testResult.responseTime
    });

  } catch (error) {
    console.error('Test provider error:', error);
    res.status(500).json({ error: 'Failed to test AI provider' });
  }
});

export default router;
