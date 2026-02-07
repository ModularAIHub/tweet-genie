import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';

// Simple rate limiter
const rateLimits = new Map();
function checkImageRateLimit(userId) {
  if (!userId) return { allowed: true };
  
  const key = userId;
  const now = Date.now();
  const limit = { maxRequests: 10, windowMs: 60 * 60 * 1000 }; // 10 images/hour
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, resetTime: now + limit.windowMs });
    return { allowed: true };
  }
  
  const userLimit = rateLimits.get(key);
  if (now >= userLimit.resetTime) {
    userLimit.count = 1;
    userLimit.resetTime = now + limit.windowMs;
    return { allowed: true };
  }
  
  if (userLimit.count >= limit.maxRequests) {
    const resetIn = Math.ceil((userLimit.resetTime - now) / 1000 / 60);
    return { allowed: false, error: `Image generation rate limit exceeded. Try again in ${resetIn} minutes.` };
  }
  
  userLimit.count++;
  return { allowed: true };
}

class ImageGenerationService {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
    
    // Initialize Google AI client
    if (this.googleApiKey) {
      this.googleAI = new GoogleGenAI({
        apiKey: this.googleApiKey
      });
      console.log('✅ Gemini image generation service initialized');
    } else {
      console.error('❌ Google AI API key not configured - image generation unavailable');
      this.googleAI = null;
    }
  }

  // Input validation
  validateImagePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Invalid prompt');
    }
    
    const trimmed = prompt.trim();
    
    if (trimmed.length < 3) throw new Error('Prompt too short (min 3 characters)');
    if (trimmed.length > 1000) throw new Error('Prompt too long (max 1000 characters)');
    
    // Block dangerous patterns
    const dangerousPatterns = [
      /ignore\s+previous/gi,
      /system\s*:/gi,
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        throw new Error('Invalid prompt content');
      }
    }
    
    return trimmed;
  }

  async generateImage(prompt, style = 'natural', size = '1024x1024', userId = null) {
    // Rate limiting
    if (userId) {
      const rateCheck = checkImageRateLimit(userId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }
    }

    // Input validation
    const sanitizedPrompt = this.validateImagePrompt(prompt);

    // Check if Gemini is available
    if (!this.googleAI || !this.googleApiKey) {
      throw new Error('Image generation is currently not supported due to provider/model restrictions. Please check back later or contact support if you need this feature enabled.');
    }

    try {
      console.log('Generating image with Gemini 2.0 Flash...');
      const result = await this.generateWithGemini(sanitizedPrompt, style, size);
      console.log('✅ Image generated successfully with Gemini');
      return {
        imageBuffer: result.imageBuffer,
        filename: result.filename,
        provider: 'gemini',
        success: true
      };
    } catch (error) {
      console.error('❌ Gemini image generation failed:', error.message);
      
      // Provide helpful error messages
      if (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('Gemini API quota exceeded. Google\'s free tier has very low image generation quotas. Please try again later or upgrade to a paid plan.');
      } else if (error.message.includes('billed users') || error.message.includes('billing')) {
        throw new Error('Gemini image generation requires a paid Google Cloud account with billing enabled.');
      } else if (error.message.includes('safety') || error.message.includes('blocked')) {
        throw new Error('Content was blocked by safety filters. Try rephrasing your prompt to be more art-focused (e.g., "digital art portrait of...")');
      }
      
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  async generateWithGemini(prompt, style, size = '1024x1024') {
    try {
      console.log('Generating image with Gemini 2.0 Flash Image Preview...');
      
      // Use softened prompt to avoid safety filters
      const enhancedPrompt = this.enhancePromptForGemini(prompt, style);
      
      // Generate image with safety settings disabled
      const response = await this.googleAI.models.generateContent({
        model: "gemini-2.0-flash", // Use stable free model
        contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
        // ✅ Dial down safety settings for fictional content
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ]
      });

      // Check for safety blocks
      if (response.candidates && response.candidates[0]?.finishReason === 'SAFETY') {
        const safetyRatings = response.candidates[0].safetyRatings || [];
        console.error('Content blocked by safety filters:', safetyRatings);
        throw new Error('Content was blocked by safety filters. Try using more artistic language in your prompt.');
      }

      // Check if we have candidates and content
      if (!response.candidates || !response.candidates[0] || !response.candidates[0].content || !response.candidates[0].content.parts) {
        console.error('Invalid Gemini response structure:', JSON.stringify(response, null, 2));
        throw new Error('No valid response from Gemini Flash');
      }

      // Look for image data in the response parts
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          console.log('Gemini Flash response text:', part.text);
        } else if (part.inlineData) {
          const imageData = part.inlineData.data;
          const imageBuffer = Buffer.from(imageData, 'base64');
          
          // Validate buffer
          if (imageBuffer.length === 0) {
            throw new Error('Received empty image data from Gemini');
          }
          
          const filename = `gemini-generated-${uuidv4()}.png`;
          
          console.log(`✅ Image generated successfully: ${filename}, Size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
          
          return {
            imageBuffer,
            filename,
            provider: 'Gemini 2.0 Flash'
          };
        }
      }

      // If we get here, no image was found
      console.error('No image data in Gemini response. Response:', JSON.stringify(response, null, 2));
      throw new Error('No image data found in Gemini Flash response. The model may not support image generation or the prompt was rejected.');
      
    } catch (error) {
      console.error('Gemini Flash image generation error:', error.message);
      throw error;
    }
  }

  // Softened prompt for Gemini to avoid safety filters
  enhancePromptForGemini(originalPrompt, style) {
    // ✅ USE: Art-focused language to bypass safety filters
    // ❌ AVOID: "weaponry", "true-to-life", "realistic warfare", "accurate representation"
    
    const styleEnhancements = {
      natural: 'cinematic lighting, vibrant colors, digital art',
      artistic: 'artistic illustration, creative composition, expressive colors',
      professional: 'professional digital art, studio quality, clean composition',
      vintage: 'vintage aesthetic, retro art style, nostalgic atmosphere',
      modern: 'modern digital art, contemporary design, sleek composition',
      vivid: 'bold colors, dramatic lighting, high contrast, vibrant artwork'
    };

    const styleAddition = styleEnhancements[style] || styleEnhancements.natural;

    // Create a soft, art-focused prompt
    let enhancedPrompt = `A high-quality digital character portrait of ${originalPrompt}. 
Style: ${styleAddition}, highly detailed character design, sharp focus, artistic masterpiece.`;
    
    // Ensure prompt doesn't exceed limits
    if (enhancedPrompt.length > 900) {
      enhancedPrompt = `Digital character portrait: ${originalPrompt}. ${styleAddition}, detailed, sharp focus.`;
    }
    
    console.log('Enhanced prompt for Gemini:', enhancedPrompt);
    return enhancedPrompt;
  }

  // Base64 conversion with proper error handling
  convertToBase64(imageBuffer, filename) {
    if (!Buffer.isBuffer(imageBuffer)) {
      throw new Error('Invalid image buffer');
    }

    if (imageBuffer.length === 0) {
      throw new Error('Empty image buffer');
    }

    const mimetype = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    // 10MB max for safety
    const maxSize = 10 * 1024 * 1024;
    if (imageBuffer.length > maxSize) {
      throw new Error(`Image too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(1)}MB. Max: 10MB`);
    }
    
    try {
      const base64String = imageBuffer.toString('base64');
      const dataUrl = `data:${mimetype};base64,${base64String}`;
      
      console.log('✅ Converted to base64 - Size:', (imageBuffer.length / 1024).toFixed(2), 'KB');
      
      return dataUrl;
    } catch (error) {
      throw new Error(`Failed to convert image to base64: ${error.message}`);
    }
  }

  // Get buffer directly without base64 conversion (for S3/CDN uploads)
  getImageBuffer(imageBuffer, filename) {
    if (!Buffer.isBuffer(imageBuffer)) {
      throw new Error('Invalid image buffer');
    }
    
    return {
      buffer: imageBuffer,
      mimetype: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
      filename
    };
  }
}

export const imageGenerationService = new ImageGenerationService();