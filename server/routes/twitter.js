import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import pool from '../config/database.js';
import { validateRequest } from '../middleware/validation.js';
import Joi from 'joi';

const router = express.Router();

// Twitter OAuth schema
const twitterAuthSchema = Joi.object({
  oauth_token: Joi.string().required(),
  oauth_token_secret: Joi.string().required(),
  oauth_verifier: Joi.string().required()
});

// Connect Twitter account
router.post('/connect', validateRequest(twitterAuthSchema), async (req, res) => {
  try {
    const { oauth_token, oauth_token_secret, oauth_verifier } = req.body;

    // Create Twitter client with user tokens
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: oauth_token,
      accessSecret: oauth_token_secret,
    });

    // Verify credentials and get user info
    const userInfo = await twitterClient.v2.me({
      'user.fields': ['id', 'username', 'name', 'profile_image_url', 'public_metrics']
    });

    // Store Twitter account in database
    const { rows } = await pool.query(
      `INSERT INTO twitter_accounts (
        user_id, twitter_user_id, username, display_name, 
        profile_image_url, followers_count, following_count, 
        access_token, access_token_secret, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        twitter_user_id = EXCLUDED.twitter_user_id,
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        profile_image_url = EXCLUDED.profile_image_url,
        followers_count = EXCLUDED.followers_count,
        following_count = EXCLUDED.following_count,
        access_token = EXCLUDED.access_token,
        access_token_secret = EXCLUDED.access_token_secret,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        req.user.id,
        userInfo.data.id,
        userInfo.data.username,
        userInfo.data.name,
        userInfo.data.profile_image_url,
        userInfo.data.public_metrics?.followers_count || 0,
        userInfo.data.public_metrics?.following_count || 0,
        oauth_token,
        oauth_token_secret,
        true
      ]
    );

    res.json({
      success: true,
      message: 'Twitter account connected successfully',
      account: {
        id: rows[0].id,
        username: rows[0].username,
        display_name: rows[0].display_name,
        profile_image_url: rows[0].profile_image_url,
        followers_count: rows[0].followers_count,
        following_count: rows[0].following_count
      }
    });
  } catch (error) {
    console.error('Twitter connection error:', error);
    res.status(500).json({ error: 'Failed to connect Twitter account' });
  }
});

// Get connected Twitter accounts
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, display_name, profile_image_url, 
              followers_count, following_count, is_active, created_at
       FROM twitter_accounts 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ accounts: rows });
  } catch (error) {
    console.error('Get accounts error:', error);
    res.status(500).json({ error: 'Failed to fetch Twitter accounts' });
  }
});

// Disconnect Twitter account
router.delete('/disconnect/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    await pool.query(
      'UPDATE twitter_accounts SET is_active = false WHERE id = $1 AND user_id = $2',
      [accountId, req.user.id]
    );

    res.json({ success: true, message: 'Twitter account disconnected' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Twitter account' });
  }
});

// Get Twitter OAuth URL (for initial connection)
router.get('/auth-url', async (req, res) => {
  try {
    console.log('Twitter API Key:', process.env.TWITTER_API_KEY ? 'Present' : 'Missing');
    console.log('Twitter API Secret:', process.env.TWITTER_API_SECRET ? 'Present' : 'Missing');
    
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
    });

    console.log('Generating auth link...');
    
    // Use the server callback URL instead of client URL
    const authLink = await client.generateAuthLink(
      `http://localhost:3002/callback`,
      { linkMode: 'authorize' }
    );

    console.log('Auth link generated successfully');

    res.json({
      auth_url: authLink.url,
      oauth_token: authLink.oauth_token,
      oauth_token_secret: authLink.oauth_token_secret
    });
  } catch (error) {
    console.error('Auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate Twitter auth URL' });
  }
});

// Handle Twitter OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;
    
    if (!oauth_token || !oauth_verifier) {
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`);
    }

    // Redirect to client with tokens
    res.redirect(`${process.env.CLIENT_URL}/twitter-callback?oauth_token=${oauth_token}&oauth_verifier=${oauth_verifier}`);
  } catch (error) {
    console.error('Twitter callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`);
  }
});

export default router;

// Handle Twitter OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;
    
    if (!oauth_token || !oauth_verifier) {
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`);
    }

    // Redirect to client with tokens
    res.redirect(`${process.env.CLIENT_URL}/twitter-callback?oauth_token=${oauth_token}&oauth_verifier=${oauth_verifier}`);
  } catch (error) {
    console.error('Twitter callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`);
  }
});
