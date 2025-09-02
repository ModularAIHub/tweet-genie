import { pool } from '../config/database.js';

class Twitter {
  // Get Twitter auth for a user
  static async getAuthByUserId(userId) {
    try {
      const result = await pool.query(
        'SELECT * FROM twitter_auth WHERE user_id = $1',
        [userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Failed to get Twitter auth: ${error.message}`);
    }
  }

  // Save Twitter auth tokens
  static async saveAuth(data) {
    const { userId, accessToken, refreshToken, tokenExpiresAt, twitterUserId, twitterUsername } = data;
    
    try {
      const result = await pool.query(
        `INSERT INTO twitter_auth (user_id, access_token, refresh_token, token_expires_at, twitter_user_id, twitter_username)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET 
         access_token = $2, refresh_token = $3, 
         token_expires_at = $4, twitter_user_id = $5, 
         twitter_username = $6, updated_at = NOW()
         RETURNING *`,
        [userId, accessToken, refreshToken, tokenExpiresAt, twitterUserId, twitterUsername]
      );
      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to save Twitter auth: ${error.message}`);
    }
  }

  // Update Twitter tokens
  static async updateTokens(userId, accessToken, refreshToken, tokenExpiresAt) {
    try {
      const result = await pool.query(
        `UPDATE twitter_auth 
         SET access_token = $2, refresh_token = $3, token_expires_at = $4, updated_at = NOW()
         WHERE user_id = $1
         RETURNING *`,
        [userId, accessToken, refreshToken, tokenExpiresAt]
      );
      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to update Twitter tokens: ${error.message}`);
    }
  }

  // Delete Twitter auth (disconnect)
  static async deleteAuth(userId) {
    try {
      const result = await pool.query(
        'DELETE FROM twitter_auth WHERE user_id = $1 RETURNING *',
        [userId]
      );
      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to delete Twitter auth: ${error.message}`);
    }
  }

  // OAuth state management
  static async saveOAuthState(state, userId, codeVerifier) {
    try {
      await pool.query(
        'INSERT INTO twitter_oauth_state (state, user_id, code_verifier) VALUES ($1, $2, $3)',
        [state, userId, codeVerifier]
      );
    } catch (error) {
      throw new Error(`Failed to save OAuth state: ${error.message}`);
    }
  }

  // Get OAuth state
  static async getOAuthState(state) {
    try {
      const result = await pool.query(
        'SELECT state, user_id, code_verifier FROM twitter_oauth_state WHERE state = $1',
        [state]
      );
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Failed to get OAuth state: ${error.message}`);
    }
  }

  // Get OAuth state by token (for OAuth 1.0a)
  static async getOAuthStateByToken(oauth_token) {
    try {
      const result = await pool.query(
        'SELECT state, user_id, code_verifier FROM twitter_oauth_state WHERE code_verifier LIKE $1',
        [`%"oauth_token":"${oauth_token}"%`]
      );
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Failed to get OAuth state by token: ${error.message}`);
    }
  }

  // Delete OAuth state
  static async deleteOAuthState(state) {
    try {
      await pool.query('DELETE FROM twitter_oauth_state WHERE state = $1', [state]);
    } catch (error) {
      throw new Error(`Failed to delete OAuth state: ${error.message}`);
    }
  }

  // Check if token is expired
  static isTokenExpired(tokenExpiresAt) {
    if (!tokenExpiresAt) return true;
    return new Date() >= new Date(tokenExpiresAt);
  }

  // Get all connected Twitter accounts (admin)
  static async getAllConnectedAccounts() {
    try {
      const result = await pool.query(
        `SELECT ta.*, u.email as user_email 
         FROM twitter_auth ta 
         LEFT JOIN users u ON ta.user_id = u.id 
         ORDER BY ta.created_at DESC`
      );
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get connected accounts: ${error.message}`);
    }
  }

  // Get Twitter account stats
  static async getAccountStats(userId) {
    try {
      const result = await pool.query(
        `SELECT 
           COUNT(t.id) as total_tweets,
           COUNT(CASE WHEN t.status = 'published' THEN 1 END) as published_tweets,
           COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_tweets,
           COUNT(st.id) as scheduled_tweets
         FROM twitter_auth ta
         LEFT JOIN tweets t ON ta.user_id = t.user_id
         LEFT JOIN scheduled_tweets st ON ta.user_id = st.user_id AND st.status = 'pending'
         WHERE ta.user_id = $1
         GROUP BY ta.user_id`,
        [userId]
      );
      return result.rows[0] || { total_tweets: 0, published_tweets: 0, failed_tweets: 0, scheduled_tweets: 0 };
    } catch (error) {
      throw new Error(`Failed to get account stats: ${error.message}`);
    }
  }
}

export default Twitter;
