import axios from 'axios';
import { getRequestContext } from '../utils/requestContext.js';

class CreditService {
  constructor() {
    this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
    this.platformApiUrl = process.env.NEW_PLATFORM_API_URL || `${this.platformUrl}/api`;
    this.debug = process.env.CREDIT_DEBUG === 'true';
  }

  debugLog(...args) {
    if (this.debug) {
      console.log(...args);
    }
  }

  getAgencyCreditContext() {
    const context = getRequestContext();
    const agencyToken = String(context?.agencyToken || '').trim();
    const agencyWorkspaceId = String(context?.agencyWorkspaceId || '').trim();
    const authorization = String(context?.authorization || '').trim();

    if (!agencyToken || !agencyWorkspaceId || !authorization) {
      return null;
    }

    return {
      agencyToken,
      agencyWorkspaceId,
      authorization,
    };
  }

  getContextScope() {
    return this.getAgencyCreditContext() ? 'agency' : 'personal';
  }

  buildPlatformHeaders() {
    const context = this.getAgencyCreditContext();
    if (!context) return null;

    return {
      Authorization: context.authorization,
      'x-agency-token': context.agencyToken,
      'x-agency-workspace-id': context.agencyWorkspaceId,
    };
  }

  async getBalance(userId) {
    try {
      this.debugLog(`Getting credit balance for user: ${userId}`);

      const platformHeaders = this.buildPlatformHeaders();
      if (platformHeaders) {
        const response = await axios.get(`${this.platformApiUrl}/credits/balance`, {
          headers: platformHeaders,
          timeout: 10000,
        });
        const balance = parseFloat(
          response.data?.balance ??
          response.data?.creditsRemaining ??
          response.data?.credits_remaining ??
          0
        );
        return Number.isFinite(balance) ? balance : 0;
      }

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

      const platformHeaders = this.buildPlatformHeaders();
      if (platformHeaders) {
        try {
          const response = await axios.post(
            `${this.platformApiUrl}/credits/deduct`,
            {
              operation,
              cost: amount,
              description: `${operation} - ${amount} credits deducted`,
            },
            {
              headers: platformHeaders,
              timeout: 12000,
            }
          );

          return {
            success: true,
            transaction_id: response.data?.transactionId || null,
            remaining_balance: response.data?.creditsRemaining ?? 0,
            remainingCredits: response.data?.creditsRemaining ?? 0,
            creditsRemaining: response.data?.creditsRemaining ?? 0,
            creditsDeducted: response.data?.creditsDeducted ?? amount,
            source: response.data?.source || 'agency',
          };
        } catch (error) {
          const status = error?.response?.status;
          if (status === 400) {
            return {
              success: false,
              error: 'insufficient_credits',
              available: error.response?.data?.creditsAvailable ?? 0,
              creditsAvailable: error.response?.data?.creditsAvailable ?? 0,
              required: error.response?.data?.creditsRequired ?? amount,
              creditsRequired: error.response?.data?.creditsRequired ?? amount,
              source: 'agency',
            };
          }
          throw error;
        }
      }

      const { pool } = await import('../config/database.js');
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const balanceResult = await client.query(
          'SELECT credits_remaining FROM users WHERE id = $1::uuid FOR UPDATE',
          [userId]
        );

        if (balanceResult.rows.length === 0) {
          await client.query('ROLLBACK');
          this.debugLog(`User not found for credit deduction: ${userId}`);
          return {
            success: false,
            error: 'user_not_found',
            available: 0,
            creditsAvailable: 0,
            required: amount,
            creditsRequired: amount,
          };
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
          'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid',
          [newBalance, userId]
        );

        const transactionResult = await client.query(
          `INSERT INTO credit_transactions (id, user_id, type, credits_amount, description, created_at, service_name)
           VALUES (gen_random_uuid(), $1::uuid, 'usage', $2, $3, CURRENT_TIMESTAMP, 'tweet-genie')
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

      const platformHeaders = this.buildPlatformHeaders();
      if (platformHeaders) {
        const response = await axios.post(
          `${this.platformApiUrl}/credits/add`,
          {
            amount,
            description: `${operation} - ${amount} credits refunded`,
          },
          {
            headers: platformHeaders,
            timeout: 12000,
          }
        );

        return {
          success: true,
          transaction_id: response.data?.transactionId || null,
          refunded_amount: response.data?.creditsAdded ?? amount,
          new_balance: response.data?.creditsRemaining ?? 0,
          source: response.data?.source || 'agency',
        };
      }

      const { pool } = await import('../config/database.js');
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const balanceResult = await client.query(
          'SELECT credits_remaining FROM users WHERE id = $1::uuid FOR UPDATE',
          [userId]
        );

        if (balanceResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const currentBalance = parseFloat(balanceResult.rows[0].credits_remaining || 0);
        const newBalance = currentBalance + amount;

        await client.query(
          'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid',
          [newBalance, userId]
        );

        const transactionResult = await client.query(
          `INSERT INTO credit_transactions (id, user_id, type, credits_amount, description, created_at, service_name)
           VALUES (gen_random_uuid(), $1::uuid, 'purchase', $2, $3, CURRENT_TIMESTAMP, 'tweet-genie')
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
      const platformHeaders = this.buildPlatformHeaders();
      if (platformHeaders) {
        const { page = 1, limit = 20, type } = options;
        const response = await axios.get(`${this.platformApiUrl}/credits/history`, {
          headers: platformHeaders,
          params: { page, limit, ...(type ? { type } : {}) },
          timeout: 10000,
        });
        return response.data;
      }

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
