
import express from 'express';
import pool from '../config/database.js';
import crypto from 'crypto';

const router = express.Router();

// Helper function to generate PKCE challenge
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// Store PKCE verifiers temporarily (in production, use Redis)
const pkceStore = new Map();

// GET /api/twitter/status - Returns connected Twitter account info
router.get('/status', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { rows } = await pool.query(
      `SELECT twitter_user_id, twitter_username, twitter_display_name, 
              twitter_profile_image_url, followers_count, following_count, 
              tweet_count, verified, created_at 
       FROM twitter_auth WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return res.json({ accounts: [] });
    }
    
    // Map database fields to frontend expected format
    const account = rows[0];
    const formattedAccount = {
      id: account.twitter_user_id,
      username: account.twitter_username,
      display_name: account.twitter_display_name,
      profile_image_url: account.twitter_profile_image_url,
      followers_count: account.followers_count,
      following_count: account.following_count,
      tweet_count: account.tweet_count,
      verified: account.verified,
      created_at: account.created_at
    };
    
    // Return as array for frontend compatibility
    res.json({ accounts: [formattedAccount] });
  } catch (error) {
    console.error('Twitter status error:', error);
    res.status(500).json({ error: 'Failed to fetch Twitter account status' });
  }
});

// GET /api/twitter/connect - OAuth 2.0 with PKCE
router.get('/connect', async (req, res) => {
  try {
    const userId = req.user?.id || 'anonymous';
    
    console.log('Generating Twitter OAuth URL with PKCE for user:', userId);
    console.log('Client ID:', process.env.TWITTER_CLIENT_ID);
    console.log('Redirect URI:', process.env.TWITTER_REDIRECT_URI);
    
    // Generate PKCE challenge
    const { codeVerifier, codeChallenge } = generatePKCE();
    
    // Store code verifier temporarily (use user ID as key)
    pkceStore.set(userId, codeVerifier);
    
    // Set expiry for the stored verifier (5 minutes)
    setTimeout(() => {
      pkceStore.delete(userId);
    }, 5 * 60 * 1000);
    
    const scopes = 'tweet.read tweet.write users.read offline.access';
    const authUrl = `https://twitter.com/i/oauth2/authorize?` +
      `response_type=code&` +
      `client_id=${process.env.TWITTER_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(process.env.TWITTER_REDIRECT_URI)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `state=${userId}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256`;
      
    console.log('Generated OAuth URL with PKCE:', authUrl);
    res.json({ url: authUrl });
  } catch (error) {
    console.error('Failed to generate OAuth URL:', error);
    res.status(500).json({ error: 'Failed to initiate Twitter connection' });
  }
});

// GET /api/twitter/callback - OAuth 2.0 with PKCE token exchange
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const userId = state;
  
  console.log('Twitter PKCE callback received:', { code: !!code, state, error });
  
  if (error) {
    console.error('Twitter OAuth error:', error);
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=oauth_denied`);
  }
  
  if (!code) {
    console.error('No authorization code received');
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=no_code`);
  }
  
  // Retrieve the stored code verifier
  const codeVerifier = pkceStore.get(userId);
  if (!codeVerifier) {
    console.error('No code verifier found for user:', userId);
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=verifier_missing`);
  }
  
  try {
    console.log('Exchanging code for tokens with PKCE...');
    
    // Create Basic Auth header for client credentials
    const credentials = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.TWITTER_CLIENT_ID,
        redirect_uri: process.env.TWITTER_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });
    
    const tokens = await tokenResponse.json();
    
    console.log('PKCE Token response status:', tokenResponse.status);
    console.log('PKCE Token response:', tokens);
    
    if (!tokens.access_token) {
      console.error('No access token received:', tokens);
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=token_failed`);
    }
    
    // Clean up the stored code verifier
    pkceStore.delete(userId);

    // Get user profile
    const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=public_metrics,verified,profile_image_url', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    });
    const twitterUser = await userResponse.json();
    
    console.log('Twitter user response:', twitterUser);
    
    if (!twitterUser.data) {
      console.error('No user data received:', twitterUser);
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=user_data_failed`);
    }

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    // Store everything in database
    await pool.query(`
      INSERT INTO twitter_auth (
        user_id, access_token, refresh_token, token_expires_at,
        twitter_user_id, twitter_username, twitter_display_name,
        twitter_profile_image_url, followers_count, following_count,
        tweet_count, verified, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        access_token = $2,
        refresh_token = $3,
        token_expires_at = $4,
        twitter_user_id = $5,
        twitter_username = $6,
        twitter_display_name = $7,
        twitter_profile_image_url = $8,
        followers_count = $9,
        following_count = $10,
        tweet_count = $11,
        verified = $12,
        updated_at = CURRENT_TIMESTAMP
    `, [
      userId,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt,
      twitterUser.data.id,
      twitterUser.data.username,
      twitterUser.data.name,
      twitterUser.data.profile_image_url,
      twitterUser.data.public_metrics.followers_count,
      twitterUser.data.public_metrics.following_count,
      twitterUser.data.public_metrics.tweet_count,
      twitterUser.data.verified || false
    ]);

    res.redirect(`${process.env.CLIENT_URL}/settings?twitter_connected=true`);
  } catch (error) {
    console.error('Twitter auth error:', error);
    res.redirect(`${process.env.CLIENT_URL}/settings?error=connection_failed`);
  }
});

export default router;
