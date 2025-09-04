import express from 'express';
import { aiService } from '../services/aiService.js';
import { authenticateToken } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';
import { sanitizeInput, sanitizeAIPrompt, checkRateLimit } from '../utils/sanitization.js';

const router = express.Router();

// Generate AI content
router.post('/generate', authenticateToken, async (req, res) => {
  try {
  const { prompt, style = 'casual', isThread = false } = req.body;

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

    // Check and deduct credits before AI generation based on estimated count
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    
    const creditCheck = await creditService.checkAndDeductCredits(req.user.id, 'ai_text_generation', estimatedCreditsNeeded, token);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired: estimatedCreditsNeeded,
        creditsAvailable: creditCheck.creditsAvailable || 0,
        estimatedThreads: estimatedThreadCount
      });
    }

    console.log(`AI generation request: "${sanitizedPrompt}" with style: ${style}`);

    // First generate the content to analyze thread count
    const result = await aiService.generateContent(sanitizedPrompt, style);

    // Use the AI-generated content directly (no post-sanitization to prevent [FILTERED])
    const sanitizedContent = result.content;

    // Only treat as thread if isThread is true
    let threadCount = 1;
    if (isThread) {
      // Count threads by splitting on "---" separator (the actual format used by AI service)
      const threadSeparators = sanitizedContent.split('---').filter(section => section.trim().length > 0);
      if (threadSeparators.length > 1) {
        threadCount = threadSeparators.length;
        console.log(`Multiple threads detected: ${threadCount} threads (separated by ---)`);
      } else {
        // Fallback: if no --- separators, check if it's a single long thread
        const lines = sanitizedContent.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 3) {
          threadCount = Math.min(Math.ceil(lines.length / 3), 5); // Estimate 3 lines per tweet, cap at 5
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
      const additionalCreditCheck = await creditService.checkAndDeductCredits(
        req.user.id, 
        'ai_thread_adjustment', 
        creditDifference, 
        token
      );
      
      if (!additionalCreditCheck.success) {
        // Refund the initial credits since we can't complete the request
        await creditService.refundCredits(req.user.id, 'ai_text_generation', estimatedCreditsNeeded);
        
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits for actual thread count',
          creditsRequired: actualCreditsNeeded,
          creditsAvailable: additionalCreditCheck.creditsAvailable || 0,
          threadCount: threadCount,
          estimatedThreads: estimatedThreadCount
        });
      }
    } else if (creditDifference < -0.01) { // Only refund if difference is significant
      // Refund excess credits
      const refundAmount = Math.abs(creditDifference);
      console.log(`Refunding ${refundAmount} excess credits (actual: ${threadCount}, estimated: ${estimatedThreadCount})`);
      await creditService.refundCredits(req.user.id, 'ai_thread_adjustment', refundAmount);
    }

    console.log(`Final credits used: ${actualCreditsNeeded} for ${threadCount} threads (estimated: ${estimatedThreadCount})`);

    res.json({
      success: true,
      content: sanitizedContent,
      provider: result.provider,
      threadCount: threadCount,
      estimatedThreads: estimatedThreadCount,
      creditsUsed: actualCreditsNeeded,
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

export default router;
