
import OpenAI from 'openai';
import axios from 'axios';
import { sanitizeAIPrompt, sanitizeInput } from '../utils/sanitization.js';

// Helper to fetch user preference and keys from new-platform
async function getUserPreferenceAndKeys(userToken) {
  const baseUrl = process.env.NEW_PLATFORM_API_URL || 'https://your-new-platform-domain/api';
  // Fetch preference
  const prefRes = await axios.get(`${baseUrl}/byok/preference`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  const preference = prefRes.data.api_key_preference;
  let userKeys = [];
  if (preference === 'byok') {
    const keysRes = await axios.get(`${baseUrl}/byok/keys`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    userKeys = keysRes.data.keys;
  }
  return { preference, userKeys };
}

class AIService {
  constructor() {
    // Initialize OpenAI client only if API key is present
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } else {
      console.warn('⚠️ OpenAI API key not configured - OpenAI features will be unavailable');
      this.openai = null;
    }
    
    this.perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
    
    // Platform integration (legacy)
    this.hubApiUrl = process.env.HUB_API_URL;
    this.hubApiKey = process.env.HUB_API_KEY;
  }

  async generateContent(prompt, style = 'casual', maxRetries = 3, userToken = null, userId = null) {
    // Skip all sanitization for AI prompts to prevent [FILTERED] content
    // Just do basic validation
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Invalid or too short prompt');
    }

    const sanitizedPrompt = prompt.trim();
    
    // Extract requested thread count from prompt
    const threadCountMatch = prompt.match(/generate\s+(\d+)\s+threads?/i);
    const requestedCount = threadCountMatch ? parseInt(threadCountMatch[1]) : null;

    // Fetch user preference and keys from new-platform if userToken is provided
    let preference = 'platform';
    let userKeys = [];
    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
        console.log('[BYOK DEBUG] userKeys from new-platform:', JSON.stringify(userKeys, null, 2));
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys:', err.message);
      }
    }

    // Build providers array based on available API keys (user or platform)
    const providers = [];
    // Perplexity
    let perplexityKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'perplexity')?.apiKey) : this.perplexityApiKey;
    if (perplexityKey) {
      providers.push({ name: 'perplexity', keyType: preference === 'byok' ? 'BYOK' : 'platform', method: (p, s, c) => this.generateWithPerplexity(p, s, c, perplexityKey) });
    }
    // Google
    let googleKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'gemini')?.apiKey) : this.googleApiKey;
    if (googleKey) {
      providers.push({ name: 'google', keyType: preference === 'byok' ? 'BYOK' : 'platform', method: (p, s, c) => this.generateWithGoogle(p, s, c, googleKey) });
    }
    // OpenAI
    let openaiKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'openai')?.apiKey) : process.env.OPENAI_API_KEY;
    if (openaiKey) {
      providers.push({ name: 'openai', keyType: preference === 'byok' ? 'BYOK' : 'platform', method: (p, s, c) => this.generateWithOpenAI(p, s, c, openaiKey) });
    }

    if (providers.length === 0) {
      throw new Error('No AI providers configured. Please set at least one API key (PERPLEXITY_API_KEY, GOOGLE_AI_API_KEY, or OPENAI_API_KEY)');
    }

    console.log(`Available AI providers: ${providers.map(p => p.name).join(', ')}`);

    let lastError = null;
    for (const provider of providers) {
      try {
        // Log which key and provider is being used
        if (userId) {
          console.log(`[AI Key Usage] userId=${userId} provider=${provider.name} keyType=${provider.keyType}`);
        }
        console.log(`Attempting content generation with ${provider.name}...`);
        const result = await provider.method(sanitizedPrompt, style, requestedCount);
        console.log(`✅ Content generated successfully with ${provider.name}`);
        return {
          content: result,
          provider: provider.name,
          keyType: provider.keyType,
          success: true
        };
      } catch (error) {
        console.error(`❌ ${provider.name} generation failed:`, error.message);
        lastError = error;
        continue;
      }
    }

    throw new Error(`All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithPerplexity(prompt, style, requestedCount = null, apiKey = null) {
    const keyToUse = apiKey || this.perplexityApiKey;
    if (!keyToUse) {
      throw new Error('Perplexity API key not configured');
    }

    const stylePrompts = {
      professional: 'Write in a professional, business-appropriate tone.',
      casual: 'Write in a casual, conversational tone.',
      witty: 'Write with humor and wit, be clever and engaging.',
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };

    // Build the system prompt based on whether a specific count is requested
    let systemPrompt;
    
    if (requestedCount) {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

CRITICAL COUNTING RULE: Generate EXACTLY ${requestedCount} tweets separated by "---". No more, no less. Count each one as you write.

CONTENT RULES:
- Generate ONLY tweet content, no explanations
- DO NOT include "Here's a tweet" or similar phrases
- Keep under 280 characters per tweet
- Include 1-3 relevant hashtags at the end of each tweet
- NO citations, references, or numbered brackets like [1], [2], [3]
- NO source citations or footnotes
- Be engaging and informative
- Each tweet should be complete and standalone

User request: ${prompt}

Remember: Generate EXACTLY ${requestedCount} tweets. Count them as you write. Include relevant hashtags. DO NOT add any citations or references.`;
    } else {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

CONTENT RULES:
- Generate tweet content based on the request
- If user asks for "threads" without a number, generate 3-5 tweets separated by "---"
- DO NOT include "Here's a tweet" or similar phrases
- Keep under 280 characters per tweet
- Include 1-3 relevant hashtags at the end of each tweet
- NO citations, references, or numbered brackets like [1], [2], [3]
- NO source citations or footnotes
- Be engaging and informative
- Each tweet should be complete and standalone

User request: ${prompt}

Generate appropriate tweet content with relevant hashtags. DO NOT add any citations or references.`;
    }

    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: 'sonar',
          messages: [
            { role: 'user', content: systemPrompt }
          ],
          max_tokens: 800,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${keyToUse}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No content generated by Perplexity');
      }

      return content;
    } catch (error) {
      console.error('Perplexity API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.status === 400) {
        const errorData = error.response.data;
        throw new Error(`Perplexity API Error: ${errorData.error?.message || errorData.message || 'Bad Request'}`);
      }
      
      throw error;
    }
  }

  async generateWithGoogle(prompt, style, requestedCount = null, apiKey = null) {
    const keyToUse = apiKey || this.googleApiKey;
    if (!keyToUse) {
      throw new Error('Google AI API key not configured');
    }

    const stylePrompts = {
      professional: 'professional and business-appropriate',
      casual: 'casual and conversational',
      witty: 'witty, humorous, and clever',
      inspirational: 'inspirational and motivational',
      informative: 'informative and educational'
    };

    // Build the system prompt based on whether a specific count is requested
    let systemPrompt;
    
    if (requestedCount) {
      systemPrompt = `You are a Twitter content creator. Be ${stylePrompts[style] || 'casual and conversational'}.

CRITICAL COUNTING RULE: Generate EXACTLY ${requestedCount} tweets separated by "---". No more, no less.

CONTENT RULES:
- Generate ONLY tweet content
- DO NOT include "Here's a tweet:" phrases
- Keep under 280 characters per tweet
- Include 1-3 relevant hashtags at the end of each tweet
- NO citations, references, or numbered brackets like [1], [2], [3]
- NO source citations or footnotes
- Be engaging and informative
- Each tweet should be complete

User request: ${prompt}

IMPORTANT: Generate EXACTLY ${requestedCount} tweets with relevant hashtags. DO NOT add any citations or references.`;
    } else {
      systemPrompt = `You are a Twitter content creator. Be ${stylePrompts[style] || 'casual and conversational'}.

CONTENT RULES:
- Generate tweet content based on the request
- If user asks for "threads" without a number, generate 3-5 tweets separated by "---"
- DO NOT include "Here's a tweet:" phrases
- Keep under 280 characters per tweet
- Include 1-3 relevant hashtags at the end of each tweet
- NO citations, references, or numbered brackets like [1], [2], [3]
- NO source citations or footnotes
- Be engaging and informative
- Each tweet should be complete

User request: ${prompt}

Generate appropriate tweet content with relevant hashtags. DO NOT add any citations or references.`;
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${keyToUse}`,
      {
        contents: [{
          parts: [{
            text: systemPrompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 1,
          topP: 1,
          maxOutputTokens: 800,
        },
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE'
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE'
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!content) {
      throw new Error('No content generated by Google Gemini');
    }

    return content;
  }

  async generateWithOpenAI(prompt, style, requestedCount = null, apiKey = null) {
    const keyToUse = apiKey || process.env.OPENAI_API_KEY;
    if (!keyToUse) {
      throw new Error('OpenAI API key not configured');
    }

    // Create a new OpenAI client if using BYOK key
    let openaiClient = this.openai;
    if (apiKey && apiKey !== process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      openaiClient = new OpenAI({ apiKey });
    }

    const stylePrompts = {
      professional: 'Write in a professional, business-appropriate tone.',
      casual: 'Write in a casual, conversational tone.',
      witty: 'Write with humor and wit, be clever and engaging.',
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };

    // Build the system prompt based on whether a specific count is requested
    let systemPrompt;
    
    if (requestedCount) {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

CRITICAL COUNTING RULE: Generate EXACTLY ${requestedCount} tweets separated by "---". No more, no less.

CONTENT RULES:
- Generate ONLY tweet content
- DO NOT include "Here's a tweet:" phrases  
- Keep under 280 characters per tweet
- Include 1-3 relevant hashtags at the end of each tweet
- NO citations, references, or numbered brackets like [1], [2], [3]
- NO source citations or footnotes
- Be engaging and informative
- Each tweet should be complete

User request: ${prompt}

IMPORTANT: Generate EXACTLY ${requestedCount} tweets with relevant hashtags. DO NOT add any citations or references.`;
    } else {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

CONTENT RULES:
- Generate tweet content based on the request
- If user asks for "threads" without a number, generate 3-5 tweets separated by "---"
- DO NOT include "Here's a tweet:" phrases  
- Keep under 280 characters per tweet
- Include 1-3 relevant hashtags at the end of each tweet
- NO citations, references, or numbered brackets like [1], [2], [3]
- NO source citations or footnotes
- Be engaging and informative
- Each tweet should be complete

User request: ${prompt}

Generate appropriate tweet content with relevant hashtags. DO NOT add any citations or references.`;
    }

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content generated by OpenAI');
    }

    return content;
  }

  async generateImageContent(prompt, imageUrl = null) {
    // Basic validation without aggressive sanitization
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      throw new Error('Invalid or too short prompt for image content generation');
    }

    const sanitizedPrompt = prompt.trim();

    // Build providers array for image content generation
    const providers = [];
    
    if (this.openai && process.env.OPENAI_API_KEY) {
      providers.push({ name: 'openai', method: this.generateImageContentWithOpenAI.bind(this) });
    }
    
    if (this.googleApiKey) {
      providers.push({ name: 'google', method: this.generateImageContentWithGoogle.bind(this) });
    }

    if (providers.length === 0) {
      throw new Error('No AI providers configured for image content generation');
    }

    let lastError = null;

    for (const provider of providers) {
      try {
        console.log(`Attempting image content generation with ${provider.name}...`);
        const result = await provider.method(sanitizedPrompt, imageUrl);
        console.log(`✅ Image content generated successfully with ${provider.name}`);
        return {
          content: result,
          provider: provider.name,
          success: true
        };
      } catch (error) {
        console.error(`❌ ${provider.name} image content generation failed:`, error.message);
        lastError = error;
        continue;
      }
    }

    throw new Error(`All AI providers failed for image content generation. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async generateImageContentWithOpenAI(prompt, imageUrl = null) {
    if (!this.openai || !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = `You are a Twitter content creator. Generate engaging tweet content based on the image and prompt provided.

CRITICAL INSTRUCTIONS:
- Generate ONLY the tweet text, no explanations or chat responses
- DO NOT include phrases like "Here's a tweet:", "Caption:", etc.
- DO NOT add conversational elements
- Keep under 280 characters
- For thread content: Only include hashtags in the FINAL tweet of the thread
- For single tweets: Include relevant hashtags (max 2-3)
- Be engaging and descriptive
- Focus on what makes the image interesting or noteworthy

Generate tweet content for: ${prompt}`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    if (imageUrl) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await this.openai.chat.completions.create({
      model: imageUrl ? 'gpt-4-vision-preview' : 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 400,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content generated by OpenAI for image');
    }

    return content;
  }

  async generateImageContentWithGoogle(prompt, imageUrl = null) {
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const systemPrompt = `You are a Twitter content creator. Generate ONLY tweet content based on the image and prompt.

CRITICAL RULES:
- Generate ONLY the tweet text, nothing else
- DO NOT include "Here's a tweet:" or similar phrases
- DO NOT add explanations or commentary
- Keep under 280 characters
- For thread content: Only include hashtags in the FINAL tweet of the thread
- For single tweets: Include 1-2 relevant hashtags
- Be engaging and visual
- Focus on what makes the image compelling

Generate tweet content for: ${prompt}`;

    const requestBody = {
      contents: [{
        parts: [{
          text: systemPrompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        topK: 1,
        topP: 1,
        maxOutputTokens: 400,
      }
    };

    // Add image if provided
    if (imageUrl && imageUrl.startsWith('data:image/')) {
      const base64Data = imageUrl.split(',')[1];
      const mimeType = imageUrl.split(';')[0].split(':')[1];
      
      requestBody.contents[0].parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data
        }
      });
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${this.googleApiKey}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!content) {
      throw new Error('No content generated by Google Gemini for image');
    }

    return content;
  }

  async generateMultipleOptions(prompt, style = 'casual', count = 3) {
    const results = [];
    const errors = [];

    // Try to generate multiple options, but don't fail if some don't work
    for (let i = 0; i < count; i++) {
      try {
        const result = await this.generateContent(prompt, style);
        results.push(result);
      } catch (error) {
        errors.push(error.message);
        // If we can't generate any options, throw the error
        if (results.length === 0 && i === count - 1) {
          throw error;
        }
      }
    }

    return {
      options: results,
      errors: errors.length > 0 ? errors : null
    };
  }

  // Legacy methods for platform integration
  async getHubProviders(userId) {
    try {
      const response = await axios.get(`${this.hubApiUrl}/api/ai/providers/${userId}`, {
        headers: {
          'X-API-Key': this.hubApiKey,
          'X-Service': 'tweet-genie'
        }
      });

      return response.data.providers;
    } catch (error) {
      // If Platform doesn't have providers endpoint yet, return empty object silently
      if (error.response?.status === 404) {
        console.log('Hub providers endpoint not available, using fallback');
        return {};
      }
      console.error('Error fetching hub providers:', error.message);
      return {};
    }
  }

  async generateTweets(params) {
    const { prompt, provider, style, hashtags, mentions, max_tweets, userId } = params;

    // Try new direct AI generation first, fallback to hub if needed
    try {
      const result = await this.generateContent(prompt, style);
      return [result.content];
    } catch (directError) {
      console.error('Direct AI generation failed, trying hub provider:', directError);
      
      // Fallback to platform hub providers for AI generation
      try {
        return await this.generateWithHubProvider(params);
      } catch (hubError) {
        console.error('Hub provider error:', hubError);
        throw new Error(`AI generation failed: ${hubError.message}`);
      }
    }
  }

  async generateWithHubProvider(params) {
    try {
      const response = await axios.post(`${this.hubApiUrl}/api/ai/generate`, {
        ...params,
        service: 'tweet-genie'
      }, {
        headers: {
          'X-API-Key': this.hubApiKey,
          'X-Service': 'tweet-genie'
        }
      });

      return response.data.tweets;
    } catch (error) {
      console.error('Hub AI generation error:', error);
      throw error;
    }
  }

  // Generate a tweet or thread for a prompt, returning { text, isThread, threadParts }
  async generateTweetOrThread(prompt, options = {}) {
    const style = options.style || 'casual';
    let aiPrompt = prompt;
    // If isThread is true, force thread generation in the prompt
    if (options.isThread) {
      aiPrompt = `${prompt}\nGenerate a Twitter thread (3-5 tweets, separated by ---).`;
    }
    const result = await this.generateContent(aiPrompt, style);
    if (options.isThread) {
      const threadParts = result.content.split(/---+/).map(t => t.trim()).filter(Boolean);
      return {
        text: result.content,
        isThread: true,
        threadParts,
        provider: result.provider,
        success: true
      };
    } else {
      // Always return a single tweet (first part)
      const first = typeof result.content === 'string' ? result.content.split(/---+/)[0].trim() : '';
      return {
        text: first,
        isThread: false,
        threadParts: [first],
        provider: result.provider,
        success: true
      };
    }
  }
}

export const aiService = new AIService();
