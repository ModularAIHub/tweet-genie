import express from 'express';
import { imageGenerationService } from '../services/imageGenerationService.js';
import { authenticateToken } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';

const router = express.Router();

// Handler function for image generation
const handleImageGeneration = async (req, res) => {
  try {
    const { prompt, style = 'natural' } = req.body;
    const userId = req.user.id;

    console.log('Image generation request received:');
    console.log('- Raw body:', JSON.stringify(req.body));
    console.log('- Prompt value:', JSON.stringify(prompt));
    console.log('- Prompt length:', prompt ? prompt.length : 0);
    console.log('- Prompt contains spaces:', prompt ? prompt.includes(' ') : false);
    console.log('- Request headers:', req.headers['content-type']);

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    if (prompt.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Prompt too long (max 1000 characters)'
      });
    }

    // Calculate credit cost for AI image generation
    const creditCost = 2; // 2 credits per AI image generation

    // Get user token for credit service
    let userToken = req.cookies?.accessToken;
    if (!userToken) {
      const authHeader = req.headers['authorization'];
      userToken = authHeader && authHeader.split(' ')[1];
    }

    // Check and deduct credits (with fallback for development)
    let creditCheck;
    try {
      creditCheck = await creditService.checkAndDeductCredits(userId, 'ai_image_generation', creditCost, userToken);
    } catch (creditError) {
      console.warn('Credit service unavailable:', creditError.message);
      // In development mode, continue without credits
      if (process.env.NODE_ENV === 'development') {
        console.log('Development mode: bypassing credit check for image generation');
        creditCheck = { success: true };
      } else {
        throw creditError;
      }
    }
    
    if (!creditCheck.success) {
      return res.status(402).json({ 
        error: 'Insufficient credits for AI image generation',
        required: creditCost,
        available: creditCheck.available
      });
    }

    console.log(`AI image generation request: "${prompt}" with style: ${style} (${creditCost} credits deducted)`);

    const result = await imageGenerationService.generateImage(prompt.trim(), style);
    
    // Convert to base64 for frontend
    const base64Image = imageGenerationService.convertToBase64(result.imageBuffer, result.filename);

    const responseData = {
      success: true,
      imageUrl: base64Image, // Changed from 'image' to 'imageUrl' to match frontend expectation
      filename: result.filename,
      provider: result.provider,
      generatedAt: new Date().toISOString(),
      creditsUsed: creditCost
    };

    console.log('Sending image response:');
    console.log('- Success:', responseData.success);
    console.log('- Filename:', responseData.filename);
    console.log('- Provider:', responseData.provider);
    console.log('- Image data length:', base64Image.length);
    console.log('- Image preview:', base64Image.substring(0, 50) + '...');

    res.json(responseData);

  } catch (error) {
    console.error('AI image generation error:', error);
    
    // Handle specific size validation errors
    if (error.message && error.message.includes('Image too large')) {
      return res.status(413).json({
        success: false,
        error: 'Generated image exceeds size limit',
        details: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate image',
      details: error.message
    });
  }
};

// Generate AI image (original endpoint)
router.post('/generate-image', authenticateToken, handleImageGeneration);

// Generate AI image (direct endpoint for frontend compatibility)
router.post('/', authenticateToken, handleImageGeneration);

export default router;
