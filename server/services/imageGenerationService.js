import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

class ImageGenerationService {
  constructor() {
    // Initialize OpenAI client only if API key is present
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } else {
      console.warn('⚠️ OpenAI API key not configured - OpenAI image generation will be unavailable');
      this.openai = null;
    }
    
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
    
    // Initialize Google AI client only if API key is present
    if (this.googleApiKey) {
      this.googleAI = new GoogleGenAI({
        apiKey: this.googleApiKey
      });
    } else {
      console.warn('⚠️ Google AI API key not configured - Gemini image generation will be unavailable');
      this.googleAI = null;
    }
    
    this.uploadPath = process.env.UPLOAD_PATH || './uploads';
    
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  async generateImage(prompt, style = 'natural', size = '1024x1024') {
    // Build providers array based on available API keys, Gemini first then OpenAI
    const providers = [];
    
    // Try Gemini first (preferred provider)
    if (this.googleAI && this.googleApiKey) {
      providers.push({ name: 'gemini', method: this.generateWithGemini.bind(this) });
    }
    
    // OpenAI as fallback
    if (this.openai && process.env.OPENAI_API_KEY) {
      providers.push({ name: 'openai', method: this.generateWithOpenAI.bind(this) });
    }

    if (providers.length === 0) {
      throw new Error('No image generation providers configured. Please set at least one API key (GOOGLE_AI_API_KEY or OPENAI_API_KEY)');
    }

    console.log(`Available image generation providers: ${providers.map(p => p.name).join(', ')}`);

    let lastError = null;

    for (const provider of providers) {
      try {
        console.log(`Attempting image generation with ${provider.name}...`);
        const result = await provider.method(prompt, style, size);
        console.log(`✅ Image generated successfully with ${provider.name}`);
        return {
          imageBuffer: result.imageBuffer,
          filename: result.filename,
          provider: provider.name,
          success: true
        };
      } catch (error) {
        console.error(`❌ ${provider.name} image generation failed:`, error.message);
        lastError = error;
        // Continue to next provider instead of failing
        continue;
      }
    }

    throw new Error(`All image generation providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithGemini(prompt, style, size = '1024x1024') {
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    if (!this.googleAI) {
      throw new Error('Google AI client not initialized');
    }

    // Try multiple Gemini models in order
    const geminiMethods = [
      {
        name: 'Imagen 4.0',
        method: this.generateWithImagen4.bind(this)
      },
      {
        name: 'Gemini 2.5 Flash Image Preview',
        method: this.generateWithFlashImage.bind(this)
      }
    ];

    let lastError = null;

    for (const geminiMethod of geminiMethods) {
      try {
        console.log(`Trying ${geminiMethod.name}...`);
        const result = await geminiMethod.method(prompt, style, size);
        console.log(`✅ Image generated successfully with ${geminiMethod.name}`);
        return result;
      } catch (error) {
        console.error(`❌ ${geminiMethod.name} failed:`, error.message);
        
        // Check for specific quota/billing errors
        if (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')) {
          console.log(`${geminiMethod.name} hit quota limits, trying next provider...`);
        } else if (error.message.includes('billed users')) {
          console.log(`${geminiMethod.name} requires paid billing, trying next provider...`);
        }
        
        lastError = error;
        continue;
      }
    }

    // Instead of throwing a complex error message, throw a simple one that allows fallback
    throw new Error(`Gemini image generation failed: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithImagen4(prompt, style, size = '1024x1024') {
    try {
      console.log('Generating image with Imagen 4.0...');
      
      // Enhance the prompt for better quality
      const enhancedPrompt = this.enhancePrompt(prompt, style);
      
      // Map size to aspect ratio for Imagen
      const aspectRatio = size === '1792x1024' ? '16:9' : size === '1024x1792' ? '9:16' : '1:1';
      
      const response = await this.googleAI.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: enhancedPrompt,
        config: {
          numberOfImages: 1,
          aspectRatio: aspectRatio,
          outputFormat: "PNG",
          safetyFilterLevel: "block_low_and_above"
        },
      });

      // Check if we have generated images
      if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new Error('No images generated by Imagen 4.0');
      }

      const generatedImage = response.generatedImages[0];
      
      if (!generatedImage.image || !generatedImage.image.imageBytes) {
        throw new Error('No image data in Imagen 4.0 response');
      }

      const imageBytes = generatedImage.image.imageBytes;
      const imageBuffer = Buffer.from(imageBytes, 'base64');
      
      // Generate unique filename
      const filename = `ai-generated-${uuidv4()}.png`;
      const filepath = path.join(this.uploadPath, filename);
      
      // Save image to disk
      fs.writeFileSync(filepath, imageBuffer);
      
      return {
        imageBuffer,
        filename,
        filepath,
        provider: 'Imagen 4.0'
      };
      
    } catch (error) {
      console.error('Imagen 4.0 generation error:', error.message);
      throw error;
    }
  }

  async generateWithFlashImage(prompt, style, size = '1024x1024') {
    try {
      console.log('Generating image with Gemini 2.5 Flash Image Preview...');
      
      // Enhance the prompt for better quality
      const enhancedPrompt = this.enhancePrompt(prompt, style);
      
      const response = await this.googleAI.models.generateContent({
        model: "gemini-2.5-flash-image-preview",
        contents: enhancedPrompt,
      });

      // Check if we have candidates and content
      if (!response.candidates || !response.candidates[0] || !response.candidates[0].content || !response.candidates[0].content.parts) {
        throw new Error('No valid response from Gemini Flash');
      }

      // Look for image data in the response parts
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const imageData = part.inlineData.data;
          const imageBuffer = Buffer.from(imageData, 'base64');
          
          // Generate unique filename
          const filename = `ai-generated-${uuidv4()}.png`;
          const filepath = path.join(this.uploadPath, filename);
          
          // Save image to disk
          fs.writeFileSync(filepath, imageBuffer);
          
          return {
            imageBuffer,
            filename,
            filepath,
            provider: 'Gemini 2.5 Flash'
          };
        } else if (part.text) {
          console.log('Gemini Flash response text:', part.text);
        }
      }

      throw new Error('No image data found in Gemini Flash response');
      
    } catch (error) {
      console.error('Gemini Flash image generation error:', error.message);
      throw error;
    }
  }

  async generateWithOpenAI(prompt, style, size = '1024x1024') {
    if (!this.openai || !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      // Enhance the prompt for better quality
      const enhancedPrompt = this.enhancePrompt(prompt, style);
      
      // Map size to valid DALL-E sizes
      const validSizes = ['1024x1024', '1792x1024', '1024x1792'];
      const finalSize = validSizes.includes(size) ? size : '1024x1024';
      
      const response = await this.openai.images.generate({
        model: "dall-e-3",
        prompt: enhancedPrompt,
        n: 1,
        size: finalSize,
        quality: "hd", // Use HD quality for better detail accuracy
        style: style === 'artistic' ? 'vivid' : 'natural', // Natural style tends to be more accurate to prompts
        // Note: DALL-E 3 automatically revises prompts for safety, but our enhanced prompt helps guide it
      });

      // Log what DALL-E 3 actually used (if available in response)
      if (response.data[0].revised_prompt) {
        console.log('Original prompt:', enhancedPrompt);
        console.log('DALL-E 3 revised prompt:', response.data[0].revised_prompt);
      }

      const imageUrl = response.data[0].url;
      
      // Download the image
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer'
      });
      
      const imageBuffer = Buffer.from(imageResponse.data);
      
      // Generate unique filename
      const filename = `ai-generated-${uuidv4()}.png`;
      const filepath = path.join(this.uploadPath, filename);
      
      // Save image to disk
      fs.writeFileSync(filepath, imageBuffer);
      
      return {
        imageBuffer,
        filename,
        filepath,
        provider: 'OpenAI DALL-E 3'
      };
    } catch (error) {
      console.error('OpenAI image generation error:', error);
      throw error;
    }
  }

  // Enhance prompt for better image quality
  enhancePrompt(originalPrompt, style) {
    // Pre-process the prompt to improve structure and clarity
    const structuredPrompt = this.structurePrompt(originalPrompt);
    
    // Focus on content accuracy and contextual understanding
    const contentAccuracyKeywords = [
      'accurate representation',
      'contextually appropriate',
      'detailed and precise',
      'true to description'
    ];

    // Style enhancements that also emphasize correctness
    const styleEnhancements = {
      natural: 'realistic, accurate proportions, natural environment, true-to-life details',
      artistic: 'artistic interpretation, creative but accurate, maintain subject integrity, expressive yet faithful',
      professional: 'professional quality, accurate business context, appropriate setting, correct proportions',
      vintage: 'vintage aesthetic with period-accurate details, historically correct elements, authentic retro style',
      modern: 'modern, contemporary design, accurate current trends, precise contemporary elements'
    };

    // Add content accuracy instructions for better OpenAI results
    const accuracyInstructions = [
      'pay attention to all details mentioned',
      'ensure all elements are correctly represented',
      'maintain logical composition',
      'include all specified subjects'
    ];

    const styleAddition = styleEnhancements[style] || styleEnhancements.natural;
    const contentAccuracy = contentAccuracyKeywords.join(', ');
    const instructions = accuracyInstructions.join(', ');

    // Build enhanced prompt with focus on accuracy first, then quality
    let enhancedPrompt = `${structuredPrompt}. Important: ${instructions}. Style: ${styleAddition}. Quality: ${contentAccuracy}, high quality, detailed, sharp focus.`;
    
    // Ensure prompt doesn't exceed DALL-E's 4000 character limit
    if (enhancedPrompt.length > 3900) {
      // Fallback to shorter version if too long
      enhancedPrompt = `${structuredPrompt}. ${instructions}. ${styleAddition}, detailed, accurate.`;
      
      // If still too long, use original prompt
      if (enhancedPrompt.length > 3900) {
        enhancedPrompt = originalPrompt;
      }
    }
    
    console.log('Enhanced prompt for OpenAI:', enhancedPrompt);
    return enhancedPrompt;
  }

  // Structure the prompt for better comprehension
  structurePrompt(prompt) {
    // Remove redundant words and clarify structure
    let structured = prompt.trim();
    
    // Add subject clarity if prompt seems vague
    if (structured.length < 20) {
      // For very short prompts, add clarifying context
      return `A detailed image of ${structured}`;
    }
    
    // For medium length prompts, ensure they start clearly
    if (!structured.match(/^(A |An |The |Create |Show |Generate )/i)) {
      structured = `Create ${structured}`;
    }
    
    return structured;
  }

  // Convert buffer to base64 for frontend
  convertToBase64(imageBuffer, filename) {
    const mimetype = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    // Check image buffer size (5MB = 5 * 1024 * 1024 bytes)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (imageBuffer.length > maxSize) {
      throw new Error(`Image too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(1)}MB. Maximum allowed: 5MB`);
    }
    
    const base64String = imageBuffer.toString('base64');
    const dataUrl = `data:${mimetype};base64,${base64String}`;
    
    console.log('Converting image to base64:');
    console.log('- Filename:', filename);
    console.log('- Mimetype:', mimetype);
    console.log('- Buffer size:', imageBuffer.length, 'bytes');
    console.log('- Buffer size MB:', (imageBuffer.length / (1024 * 1024)).toFixed(2), 'MB');
    console.log('- Base64 length:', base64String.length);
    console.log('- Data URL preview:', dataUrl.substring(0, 100) + '...');
    
    return dataUrl;
  }

  // Clean up generated files (optional cleanup)
  async cleanupFile(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Cleaned up file: ${filepath}`);
      }
    } catch (error) {
      console.error('Error cleaning up file:', error);
    }
  }
}

export const imageGenerationService = new ImageGenerationService();
