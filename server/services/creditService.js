class CreditService {
  constructor() {
    this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
    this.debug = process.env.CREDIT_DEBUG === 'true';
  }

  debugLog(...args) {
    if (this.debug) {
      console.log(...args);
    }
  }

  async getBalance(userId) {
    try {
      this.debugLog(`Getting credit balance for user: ${userId}`);

      const { pool } = await import('../config/database.js');
      const result = await pool.query('SELECT credits_remaining FROM users WHERE id = $1', [userId]);

      if (result.rows.length === 0) {
        this.debugLog(`User not found for credit lookup: ${userId}`);
        return 0;
      }

      const balance = parseFloat(result.rows[0].credits_remaining || 0);
      this.debugLog(`User ${userId} has ${balance} credits`);
      return balance;
    } catch (error) {
      console.error('Error fetching credit balance:', error);
      throw new Error('Failed to fetch credit balance');
    }
  }

  async checkAndDeductCredits(userId, operation, amount, userToken = null) {
    try {
      this.debugLog(`Credit deduction request: ${operation} - ${amount} credits for user ${userId}`);

      const { pool } = await import('../config/database.js');
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const balanceResult = await client.query(
          'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );

        if (balanceResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const currentBalance = parseFloat(balanceResult.rows[0].credits_remaining || 0);
        this.debugLog(`Current balance: ${currentBalance}, Required: ${amount}`);

        if (currentBalance < amount) {
          await client.query('ROLLBACK');
          this.debugLog(`Insufficient credits: has ${currentBalance}, needs ${amount}`);
          return {
            success: false,
            error: 'insufficient_credits',
            available: currentBalance,
            creditsAvailable: currentBalance,
            required: amount,
            creditsRequired: amount,
          };
        }

        const newBalance = currentBalance - amount;
        await client.query(
          'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newBalance, userId]
        );

        const transactionResult = await client.query(
          `INSERT INTO credit_transactions (id, user_id, type, credits_amount, description, created_at, service_name)
           VALUES (gen_random_uuid(), $1, 'usage', $2, $3, CURRENT_TIMESTAMP, 'tweet-genie')
           RETURNING id`,
          [userId, -amount, `${operation} - ${amount} credits deducted`]
        );

        await client.query('COMMIT');
        this.debugLog(`Credits deducted successfully: ${amount} credits, new balance: ${newBalance}`);

        return {
          success: true,
          transaction_id: transactionResult.rows[0].id,
          remaining_balance: newBalance,
          remainingCredits: newBalance,
          creditsRemaining: newBalance,
          creditsDeducted: amount,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error deducting credits:', error.message);
      throw new Error('Failed to process credit transaction');
    }
  }

  async refundCredits(userId, operation, amount, userToken = null) {
    try {
      this.debugLog(`Credit refund request: ${operation} - ${amount} credits for user ${userId}`);

      const { pool } = await import('../config/database.js');
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const balanceResult = await client.query(
          'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );

        if (balanceResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const currentBalance = parseFloat(balanceResult.rows[0].credits_remaining || 0);
        const newBalance = currentBalance + amount;

        await client.query(
          'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newBalance, userId]
        );

        const transactionResult = await client.query(
          `INSERT INTO credit_transactions (id, user_id, type, credits_amount, description, created_at, service_name)
           VALUES (gen_random_uuid(), $1, 'purchase', $2, $3, CURRENT_TIMESTAMP, 'tweet-genie')
           RETURNING id`,
          [userId, amount, `${operation} - ${amount} credits refunded`]
        );

        await client.query('COMMIT');
        this.debugLog(`Credits refunded successfully: ${amount} credits, new balance: ${newBalance}`);

        return {
          success: true,
          transaction_id: transactionResult.rows[0].id,
          refunded_amount: amount,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error refunding credits:', error.message);
      return {
        success: false,
        error: error.message,
        note: 'Refund failed but this is non-critical',
      };
    }
  }

  async getUsageHistory(userId, options = {}) {
    try {
      const { pool } = await import('../config/database.js');
      const { page = 1, limit = 20, type } = options;

      const offset = (page - 1) * limit;

      let query = `
        SELECT id, type, credits_amount, description, created_at
        FROM credit_transactions
        WHERE user_id = $1
      `;

      const params = [userId];

      if (type) {
        query += ` AND type = $${params.length + 1}`;
        params.push(type);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      return {
        transactions: result.rows,
        page,
        limit,
        total: result.rows.length,
      };
    } catch (error) {
      console.error('Error fetching credit history:', error);
      throw new Error('Failed to fetch credit usage history');
    }
  }

  async calculateCost(operation, metadata = {}) {
    const costs = {
      ai_text_generation: 1.2,
      ai_text_generation_multiple: 1.2,
      ai_image_generation: 2.0,
      tweet_post: 0.0,
      tweet_with_media: 0.0,
      thread_post: 0.0,
      scheduling: 0.0,
      analytics_sync: 0.0,
    };

    let baseCost = costs[operation] || 1.0;

    if (operation === 'ai_text_generation_multiple' && metadata.count) {
      baseCost = baseCost * metadata.count;
    }

    return Math.round(baseCost * 100) / 100;
  }
}

export const creditService = new CreditService();
