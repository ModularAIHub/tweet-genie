import axios from 'axios';
import pool from '../config/database.js';
import crypto from 'crypto';

class AIService {
  constructor() {
    this.hubApiUrl = process.env.HUB_API_URL;
    this.hubApiKey = process.env.HUB_API_KEY;
    this.encryptionKey = process.env.JWT_SECRET; // Using JWT secret as encryption key
  }

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
      console.error('Error fetching hub providers:', error);
      return {};
    }
  }

  async generateTweets(params) {
    const { prompt, provider, style, hashtags, mentions, max_tweets, userId } = params;

    // Try to use hub providers first, then fall back to user's own API keys
    let apiKey = await this.getProviderApiKey(provider, userId);
    let useHubProvider = false;

    if (!apiKey) {
      // Try to use hub provider
      try {
        return await this.generateWithHubProvider(params);
      } catch (hubError) {
        throw new Error(`No API key configured for ${provider} and hub provider unavailable`);
      }
    }

    // Generate with user's own API key
    const systemPrompt = this.buildSystemPrompt(style, hashtags, mentions);
    const userPrompt = this.buildUserPrompt(prompt, max_tweets);

    try {
      let generatedContent;

      switch (provider) {
        case 'openai':
          generatedContent = await this.generateWithOpenAI(apiKey, systemPrompt, userPrompt);
          break;
        case 'perplexity':
          generatedContent = await this.generateWithPerplexity(apiKey, systemPrompt, userPrompt);
          break;
        case 'google':
          generatedContent = await this.generateWithGoogle(apiKey, systemPrompt, userPrompt);
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      return this.parseTweets(generatedContent, max_tweets);
    } catch (error) {
      console.error(`AI generation error with ${provider}:`, error);
      throw new Error(`Failed to generate content with ${provider}: ${error.message}`);
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

  async generateWithOpenAI(apiKey, systemPrompt, userPrompt) {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  }

  async generateWithPerplexity(apiKey, systemPrompt, userPrompt) {
    const response = await axios.post('https://api.perplexity.ai/chat/completions', {
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  }

  async generateWithGoogle(apiKey, systemPrompt, userPrompt) {
    const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${userPrompt}`
        }]
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 500
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return response.data.candidates[0].content.parts[0].text;
  }

  buildSystemPrompt(style, hashtags, mentions) {
    let prompt = 'You are a professional social media content creator. Generate engaging Twitter posts that:';
    
    const styleGuides = {
      professional: 'are formal, informative, and business-oriented',
      casual: 'are friendly, conversational, and relatable',
      witty: 'are clever, humorous, and entertaining',
      inspirational: 'are motivating, uplifting, and thought-provoking'
    };

    if (style && styleGuides[style]) {
      prompt += `\n- ${styleGuides[style]}`;
    }

    prompt += '\n- Stay within 280 characters per tweet';
    prompt += '\n- Are engaging and likely to generate interaction';
    prompt += '\n- Use natural language and avoid overly promotional content';

    if (hashtags) {
      prompt += '\n- Include relevant hashtags (2-3 maximum)';
    }

    if (mentions && mentions.length > 0) {
      prompt += `\n- Consider mentioning: ${mentions.join(', ')}`;
    }

    prompt += '\n\nFormat: Return only the tweet content, one tweet per line if multiple tweets requested.';

    return prompt;
  }

  buildUserPrompt(prompt, max_tweets) {
    let userPrompt = `Create ${max_tweets === 1 ? 'a tweet' : `${max_tweets} tweets`} about: ${prompt}`;
    
    if (max_tweets > 1) {
      userPrompt += '\n\nEach tweet should be unique and approach the topic from different angles.';
    }

    return userPrompt;
  }

  parseTweets(content, maxTweets) {
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const tweets = [];

    for (let i = 0; i < Math.min(lines.length, maxTweets); i++) {
      let tweet = lines[i].trim();
      
      // Remove numbering (1., 2., etc.)
      tweet = tweet.replace(/^\d+\.\s*/, '');
      
      // Remove quotes if they wrap the entire tweet
      if (tweet.startsWith('"') && tweet.endsWith('"')) {
        tweet = tweet.slice(1, -1);
      }

      if (tweet.length > 0 && tweet.length <= 280) {
        tweets.push({
          content: tweet,
          character_count: tweet.length
        });
      }
    }

    return tweets;
  }

  async getProviderApiKey(provider, userId) {
    try {
      const { rows } = await pool.query(
        'SELECT encrypted_api_key FROM user_ai_providers WHERE user_id = $1 AND provider = $2 AND is_active = true',
        [userId, provider]
      );

      if (rows.length === 0) {
        return null;
      }

      return await this.decryptApiKey(rows[0].encrypted_api_key);
    } catch (error) {
      console.error('Error getting provider API key:', error);
      return null;
    }
  }

  async encryptApiKey(apiKey) {
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  async decryptApiKey(encryptedApiKey) {
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encryptedApiKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async validateApiKey(provider, apiKey) {
    try {
      switch (provider) {
        case 'openai':
          await axios.get('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          break;
        case 'perplexity':
          await axios.post('https://api.perplexity.ai/chat/completions', {
            model: 'llama-3.1-sonar-small-128k-online',
            messages: [{ role: 'user', content: 'Test' }],
            max_tokens: 10
          }, {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          });
          break;
        case 'google':
          await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
            contents: [{ parts: [{ text: 'Test' }] }]
          });
          break;
        default:
          return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async testProvider(provider, userId) {
    const startTime = Date.now();
    
    try {
      const testResult = await this.generateTweets({
        prompt: 'Test tweet generation',
        provider,
        max_tweets: 1,
        userId
      });

      const responseTime = Date.now() - startTime;

      return {
        success: true,
        message: `${provider} is working correctly`,
        responseTime,
        sampleOutput: testResult[0]?.content
      };
    } catch (error) {
      return {
        success: false,
        message: `${provider} test failed: ${error.message}`,
        responseTime: Date.now() - startTime
      };
    }
  }
}

export const aiService = new AIService();
