import axios from 'axios';

class AIService {
  constructor() {
    this.hubApiUrl = process.env.HUB_API_URL;
    this.hubApiKey = process.env.HUB_API_KEY;
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

    // Use Platform hub providers for AI generation
    try {
      return await this.generateWithHubProvider(params);
    } catch (hubError) {
      console.error('Hub provider error:', hubError);
      throw new Error(`AI generation failed: ${hubError.message}`);
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
}

export const aiService = new AIService();
