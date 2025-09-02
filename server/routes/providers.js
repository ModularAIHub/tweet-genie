import express from 'express';
import { aiService } from '../services/aiService.js';

const router = express.Router();

// Get available AI providers and their status
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's AI provider preferences from Platform
    const hubProviders = await aiService.getHubProviders(userId);

    // Define available providers (simplified)
    const providers = [
      {
        name: 'openai',
        display_name: 'OpenAI GPT',
        hub_available: hubProviders.openai?.available || false,
        models: ['gpt-3.5-turbo', 'gpt-4']
      },
      {
        name: 'perplexity',
        display_name: 'Perplexity AI',
        hub_available: hubProviders.perplexity?.available || false,
        models: ['llama-3.1-sonar-small-128k-online']
      },
      {
        name: 'google',
        display_name: 'Google Gemini',
        hub_available: hubProviders.google?.available || false,
        models: ['gemini-pro']
      }
    ];

    res.json({ providers });

  } catch (error) {
    console.error('Get providers error:', error);
    res.status(500).json({ error: 'Failed to fetch AI providers' });
  }
});

export default router;
