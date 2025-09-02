import axios from 'axios';

class CreditService {
  constructor() {
    this.hubApiUrl = process.env.HUB_API_URL;
    this.hubApiKey = process.env.HUB_API_KEY;
  }

  async getBalance(userId) {
    try {
      const response = await axios.get(`${this.hubApiUrl}/api/credits/balance/${userId}`, {
        headers: {
          'X-API-Key': this.hubApiKey,
          'X-Service': 'tweet-genie'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching credit balance:', error);
      throw new Error('Failed to fetch credit balance');
    }
  }

  async checkAndDeductCredits(userId, operation, amount, userToken = null) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      // Use JWT token if provided, otherwise fall back to API key
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      } else {
        headers['X-API-Key'] = this.hubApiKey;
        headers['X-Service'] = 'tweet-genie';
      }

      const response = await axios.post(`${this.hubApiUrl}/api/credits/deduct`, {
        user_id: userId,
        operation,
        amount,
        service: 'tweet-genie',
        metadata: {
          timestamp: new Date().toISOString()
        }
      }, {
        headers
      });

      return {
        success: true,
        transaction_id: response.data.transaction_id,
        remaining_balance: response.data.remaining_balance
      };
    } catch (error) {
      if (error.response && error.response.status === 402) {
        return {
          success: false,
          error: 'insufficient_credits',
          available: error.response.data.available,
          required: amount
        };
      }

      console.error('Error deducting credits:', error);
      throw new Error('Failed to process credit transaction');
    }
  }

  async refundCredits(userId, operation, amount, userToken = null) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      // Use JWT token if provided, otherwise fall back to API key
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      } else {
        headers['X-API-Key'] = this.hubApiKey;
        headers['X-Service'] = 'tweet-genie';
      }

      const response = await axios.post(`${this.hubApiUrl}/api/credits/refund`, {
        user_id: userId,
        operation,
        amount,
        service: 'tweet-genie',
        reason: 'Operation failed',
        metadata: {
          timestamp: new Date().toISOString()
        }
      }, {
        headers
      });

      return {
        success: true,
        transaction_id: response.data.transaction_id,
        refunded_amount: amount
      };
    } catch (error) {
      console.error('Error refunding credits:', error.response?.status, error.response?.data?.error || error.message);
      // Don't throw error for refund failures, just log them
      return { 
        success: false, 
        error: error.response?.data?.error || error.message,
        note: 'Refund failed but this is non-critical'
      };
    }
  }

  async getUsageHistory(userId, options = {}) {
    try {
      const { page = 1, limit = 20, type } = options;
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        service: 'tweet-genie'
      });

      if (type) {
        params.append('operation_type', type);
      }

      const response = await axios.get(
        `${this.hubApiUrl}/api/credits/history/${userId}?${params}`,
        {
          headers: {
            'X-API-Key': this.hubApiKey,
            'X-Service': 'tweet-genie'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error fetching credit history:', error);
      throw new Error('Failed to fetch credit usage history');
    }
  }

  async calculateCost(operation, metadata = {}) {
    const costs = {
      'tweet_post': 1.0,
      'tweet_with_media': 1.5,
      'ai_generation': 2.0,
      'thread_post': 0.5, // per tweet in thread
      'scheduling': 0.0, // free
      'analytics_sync': 0.0 // free
    };

    let baseCost = costs[operation] || 1.0;

    // Adjust cost based on metadata
    if (operation === 'tweet_post' && metadata.media_count > 0) {
      baseCost = costs['tweet_with_media'];
    }

    if (operation === 'thread_post' && metadata.thread_length) {
      baseCost = baseCost * metadata.thread_length;
    }

    if (operation === 'ai_generation' && metadata.tweet_count) {
      baseCost = baseCost * metadata.tweet_count;
    }

    // Round to 2 decimal places for consistency
    return Math.round(baseCost * 100) / 100;
  }
}

export const creditService = new CreditService();
