import express from 'express';
import { aiService } from '../services/aiService.js';

const router = express.Router();

// Get available AI providers and their status
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // Define available providers (now using platform directly, no hub needed)
    const providers = [
      {
        name: 'openai',
        display_name: 'OpenAI GPT',
        available: true, // Platform handles provider availability
        models: ['gpt-3.5-turbo', 'gpt-4']
      },
      {
        name: 'perplexity',
        display_name: 'Perplexity AI',
        available: true,
        models: ['llama-3.1-sonar-small-128k-online']
      },
      {
        name: 'google',
        display_name: 'Google Gemini',
        available: true,
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
