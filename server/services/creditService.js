class CreditService {
  constructor() {
    this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
  }

  async getBalance(userId) {
    try {
      console.log(`📊 Getting credit balance for user: ${userId}`);
      
      // Direct database query since both services use same database
      const { pool } = await import('../config/database.js');
      
      const result = await pool.query(
        'SELECT credits_remaining FROM users WHERE id = $1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        console.log(`❌ User not found: ${userId}`);
        return 0;
      }
      
      const balance = parseFloat(result.rows[0].credits_remaining || 0);
      console.log(`✅ User ${userId} has ${balance} credits`);
      return balance;
    } catch (error) {
      console.error('Error fetching credit balance:', error);
      throw new Error('Failed to fetch credit balance');
    }
  }

  async checkAndDeductCredits(userId, operation, amount, userToken = null) {
    try {
      console.log(`💳 Credit deduction request: ${operation} - ${amount} credits for user ${userId}`);
      
      // Direct database transaction for reliability
      const { pool } = await import('../config/database.js');
      
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Get current balance with row lock
        const balanceResult = await client.query(
          'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );
        
        if (balanceResult.rows.length === 0) {
          throw new Error('User not found');
        }
        
        const currentBalance = parseFloat(balanceResult.rows[0].credits_remaining || 0);
        console.log(`💰 Current balance: ${currentBalance}, Required: ${amount}`);
        
        if (currentBalance < amount) {
          await client.query('ROLLBACK');
          console.log(`❌ Insufficient credits: has ${currentBalance}, needs ${amount}`);
          return {
            success: false,
            error: 'insufficient_credits',
            available: currentBalance,
            required: amount
          };
        }
        
        // Deduct credits
        const newBalance = currentBalance - amount;
        await client.query(
          'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newBalance, userId]
        );
        
        // Record transaction (negative amount for usage)
        const transactionResult = await client.query(
          `INSERT INTO credit_transactions (id, user_id, type, credits_amount, description, created_at, service_name) 
           VALUES (gen_random_uuid(), $1, 'usage', $2, $3, CURRENT_TIMESTAMP, 'tweet-genie') 
           RETURNING id`,
          [userId, -amount, `${operation} - ${amount} credits deducted`]
        );
        
        await client.query('COMMIT');
        
        console.log(`✅ Credits deducted successfully: ${amount} credits, new balance: ${newBalance}`);
        
        return {
          success: true,
          transaction_id: transactionResult.rows[0].id,
          remaining_balance: newBalance,
          creditsDeducted: amount
        };
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Error deducting credits:', error.message);
      throw new Error('Failed to process credit transaction');
    }
  }

  async refundCredits(userId, operation, amount, userToken = null) {
    try {
      console.log(`💰 Credit refund request: ${operation} - ${amount} credits for user ${userId}`);
      
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
        
        // Record refund as purchase (positive amount)
        const transactionResult = await client.query(
          `INSERT INTO credit_transactions (id, user_id, type, credits_amount, description, created_at, service_name) 
           VALUES (gen_random_uuid(), $1, 'purchase', $2, $3, CURRENT_TIMESTAMP, 'tweet-genie') 
           RETURNING id`,
          [userId, amount, `${operation} - ${amount} credits refunded`]
        );
        
        await client.query('COMMIT');
        
        console.log(`✅ Credits refunded successfully: ${amount} credits, new balance: ${newBalance}`);
        
        return {
          success: true,
          transaction_id: transactionResult.rows[0].id,
          refunded_amount: amount
        };
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Error refunding credits:', error.message);
      return { 
        success: false, 
        error: error.message,
        note: 'Refund failed but this is non-critical'
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
        total: result.rows.length
      };
    } catch (error) {
      console.error('Error fetching credit history:', error);
      throw new Error('Failed to fetch credit usage history');
    }
  }

  async calculateCost(operation, metadata = {}) {
    const costs = {
      'ai_text_generation': 1.2,
      'ai_text_generation_multiple': 1.2, // per option
      'ai_image_generation': 2.0,
      'tweet_post': 0.0, // free
      'tweet_with_media': 0.0, // free
      'thread_post': 0.0, // free
      'scheduling': 0.0, // free
      'analytics_sync': 0.0 // free
    };

    let baseCost = costs[operation] || 1.0;

    // Adjust cost based on metadata
    if (operation === 'ai_text_generation_multiple' && metadata.count) {
      baseCost = baseCost * metadata.count;
    }

    // Round to 2 decimal places for consistency
    return Math.round(baseCost * 100) / 100;
  }
}

export const creditService = new CreditService();
