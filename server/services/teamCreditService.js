// teamCreditService.js
// Service for managing team credits with context-aware deduction for tweet-genie
import pool from '../config/database.js';
import { creditService } from './creditService.js';

export const TeamCreditService = {
  /**
   * Get credits for team or user based on context
   * @param {string} userId - User ID (UUID)
   * @param {number|null} teamId - Team ID (null for personal context)
   * @returns {Promise<{credits: number, source: 'user'|'team'}>}
   */
  async getCredits(userId, teamId = null) {
    try {
      if (teamId) {
        // Team context - get team credits
        const result = await pool.query(
          'SELECT credits_remaining FROM teams WHERE id = $1',
          [teamId]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Team not found');
        }
        
        return {
          credits: result.rows[0].credits_remaining,
          source: 'team'
        };
      } else {
        // Personal context - get user credits from existing creditService
        const userCredits = await creditService.getBalance(userId);
        
        return {
          credits: userCredits,
          source: 'user'
        };
      }
    } catch (error) {
      console.error('[TEAM CREDIT] Get credits error:', error);
      throw error;
    }
  },

  /**
   * Check if user has enough credits (team or personal)
   * @param {string} userId - User ID
   * @param {number|null} teamId - Team ID
   * @param {number} amount - Required amount
   * @returns {Promise<{success: boolean, available: number, source: string}>}
   */
  async checkCredits(userId, teamId, amount) {
    try {
      const { credits, source } = await this.getCredits(userId, teamId);
      
      return {
        success: credits >= amount,
        available: credits,
        source
      };
    } catch (error) {
      console.error('[TEAM CREDIT] Check credits error:', error);
      return { success: false, available: 0, source: teamId ? 'team' : 'user' };
    }
  },

  /**
   * Deduct credits from team or user based on context
   * @param {string} userId - User making the request
   * @param {number|null} teamId - Team ID (null for personal)
   * @param {number} amount - Credit amount to deduct
   * @param {string} operation - Operation type
   * @param {string} token - JWT token for user credit operations
   * @returns {Promise<{success: boolean, remainingCredits: number, source: string}>}
   */
  async deductCredits(userId, teamId, amount, operation, token = null) {
    try {
      const roundedAmount = Math.round(amount * 100) / 100;
      
      if (teamId) {
        // Team context - deduct from team credits
        console.log(`[TEAM CREDIT] Deducting ${roundedAmount} from team ${teamId} for user ${userId}`);
        
        // Check team balance
        const teamResult = await pool.query(
          'SELECT credits_remaining FROM teams WHERE id = $1',
          [teamId]
        );
        
        if (teamResult.rows.length === 0) {
          return { success: false, error: 'Team not found', remainingCredits: 0, source: 'team' };
        }
        
        const teamCredits = teamResult.rows[0].credits_remaining;
        
        if (teamCredits < roundedAmount) {
          return { 
            success: false, 
            error: `Insufficient team credits. Required: ${roundedAmount}, Available: ${teamCredits}`,
            remainingCredits: teamCredits,
            source: 'team'
          };
        }
        
        // Deduct from team
        await pool.query(
          'UPDATE teams SET credits_remaining = credits_remaining - $1 WHERE id = $2',
          [roundedAmount, teamId]
        );
        
        // Log transaction
        await pool.query(
          `INSERT INTO credit_transactions (user_id, type, credits_amount, description, service_name, team_id, created_at)
           VALUES ($1, 'usage', $2, $3, 'team-workspace', $4, CURRENT_TIMESTAMP)`,
          [userId, roundedAmount, `[Team] ${operation}`, teamId]
        );
        
        console.log(`[TEAM CREDIT] Successfully deducted ${roundedAmount} from team ${teamId}`);
        
        return {
          success: true,
          remainingCredits: teamCredits - roundedAmount,
          source: 'team'
        };
        
      } else {
        // Personal context - use existing creditService
        console.log(`[USER CREDIT] Deducting ${roundedAmount} from user ${userId}`);
        
        const result = await creditService.checkAndDeductCredits(
          userId,
          operation,
          roundedAmount,
          token
        );
        
        return {
          success: result.success,
          remainingCredits: result.creditsRemaining || 0,
          source: 'user',
          error: result.error
        };
      }
    } catch (error) {
      console.error('[TEAM CREDIT] Deduct error:', error);
      return { success: false, error: error.message, remainingCredits: 0, source: teamId ? 'team' : 'user' };
    }
  },

  /**
   * Refund credits to team or user
   * @param {string} userId - User ID
   * @param {number|null} teamId - Team ID
   * @param {number} amount - Amount to refund
   * @param {string} reason - Refund reason
   */
  async refundCredits(userId, teamId, amount, reason) {
    try {
      const roundedAmount = Math.round(amount * 100) / 100;
      
      if (teamId) {
        // Refund to team
        await pool.query(
          'UPDATE teams SET credits_remaining = credits_remaining + $1 WHERE id = $2',
          [roundedAmount, teamId]
        );
        
        await pool.query(
          `INSERT INTO credit_transactions (user_id, type, credits_amount, description, service_name, team_id, created_at)
           VALUES ($1, 'refund', $2, $3, 'team-workspace', $4, CURRENT_TIMESTAMP)`,
          [userId, roundedAmount, `[Team] ${reason}`, teamId]
        );
        
        console.log(`[TEAM CREDIT] Refunded ${roundedAmount} to team ${teamId}`);
      } else {
        // Refund to user using existing service
        await creditService.refundCredits(userId, reason, roundedAmount);
        console.log(`[USER CREDIT] Refunded ${roundedAmount} to user ${userId}`);
      }
    } catch (error) {
      console.error('[TEAM CREDIT] Refund error:', error);
    }
  }
};
