import express from 'express';
import { aiService } from '../services/aiService.js';
import { authenticateToken } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';

const router = express.Router();

// Generate AI content
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { prompt, style = 'casual' } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    if (prompt.trim().length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Prompt too long (max 500 characters)'
      });
    }

    // Check and deduct credits before AI generation
    // Get the JWT token from cookies or Authorization header
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    
    const creditCheck = await creditService.checkAndDeductCredits(req.user.id, 'ai_text_generation', 1.2, token);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired: 1.2,
        creditsAvailable: creditCheck.creditsAvailable || 0
      });
    }

    console.log(`AI generation request: "${prompt}" with style: ${style}`);

    const result = await aiService.generateContent(prompt.trim(), style);

    res.json({
      success: true,
      content: result.content,
      provider: result.provider,
      generatedAt: new Date().toISOString()
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

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    if (count > 5) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 5 options allowed'
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

    console.log(`AI multiple options request: "${prompt}" with style: ${style}, count: ${count}`);

    const result = await aiService.generateMultipleOptions(prompt.trim(), style, count);

    res.json({
      success: true,
      options: result.options,
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

export default router;
