
import express from 'express';
import pool from '../config/database.js';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';

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
              tweet_count, verified, created_at,
              oauth1_access_token, oauth1_access_token_secret
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
      created_at: account.created_at,
      has_oauth1: !!(account.oauth1_access_token && account.oauth1_access_token_secret)
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
    
    const scopes = 'tweet.read tweet.write users.read offline.access media.write';
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

// GET /api/twitter/callback - Unified callback for both OAuth 2.0 and OAuth 1.0a
router.get('/callback', async (req, res) => {
  // Check if this is OAuth 1.0a (has oauth_token and oauth_verifier)
  if (req.query.oauth_token && req.query.oauth_verifier) {
    return handleOAuth1Callback(req, res);
  }
  
  // Otherwise handle as OAuth 2.0 PKCE
  return handleOAuth2Callback(req, res);
});

// OAuth 2.0 PKCE callback handler
async function handleOAuth2Callback(req, res) {
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
}

// OAuth 1.0a callback handler
async function handleOAuth1Callback(req, res) {
  const { oauth_token, oauth_verifier } = req.query;
  
  console.log('OAuth 1.0a callback received:', { oauth_token: !!oauth_token, oauth_verifier: !!oauth_verifier });
  
  if (!oauth_token || !oauth_verifier) {
    return res.redirect(`${process.env.CLIENT_URL}/settings?error=oauth1_missing_params`);
  }

  try {
    // Get stored token secret
    if (!global.oauth1TempTokens || !global.oauth1TempTokens.has(oauth_token)) {
      throw new Error('OAuth token not found or expired');
    }

    const { secret: oauthTokenSecret, userId } = global.oauth1TempTokens.get(oauth_token);
    global.oauth1TempTokens.delete(oauth_token); // Clean up

    // Initialize OAuth 1.0a with request token
    const oauth = OAuth({
      consumer: {
        key: process.env.TWITTER_CONSUMER_KEY,
        secret: process.env.TWITTER_CONSUMER_SECRET,
      },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });

    // Step 3: Exchange for access token
    const accessTokenURL = 'https://api.twitter.com/oauth/access_token';
    const requestData = {
      url: accessTokenURL,
      method: 'POST',
      data: {
        oauth_verifier,
      },
    };

    const response = await fetch(accessTokenURL, {
      method: 'POST',
      headers: oauth.toHeader(oauth.authorize(requestData, {
        key: oauth_token,
        secret: oauthTokenSecret,
      })),
    });

    const responseText = await response.text();
    console.log('OAuth 1.0a access token response:', responseText);

    if (!response.ok) {
      throw new Error(`Access token failed: ${responseText}`);
    }

    // Parse access token response
    const params = new URLSearchParams(responseText);
    const accessToken = params.get('oauth_token');
    const accessTokenSecret = params.get('oauth_token_secret');

    if (!accessToken || !accessTokenSecret) {
      throw new Error('Missing access token or secret');
    }

    // Update database with OAuth 1.0a tokens
    await pool.query(`
      UPDATE twitter_auth 
      SET oauth1_access_token = $1, 
          oauth1_access_token_secret = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $3
    `, [accessToken, accessTokenSecret, userId]);

    console.log('OAuth 1.0a tokens stored successfully for user:', userId);
    res.redirect(`${process.env.CLIENT_URL}/settings?oauth1_connected=true`);
  } catch (error) {
    console.error('OAuth 1.0a callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/settings?error=oauth1_connection_failed`);
  }
}

// POST /api/twitter/disconnect - Disconnect Twitter account
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('Disconnecting Twitter account for user:', userId);

    // Delete the Twitter auth record for this user
    const { rowCount } = await pool.query(
      'DELETE FROM twitter_auth WHERE user_id = $1',
      [userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'No Twitter account found to disconnect' });
    }

    console.log('Twitter account disconnected successfully for user:', userId);
    res.json({ 
      success: true, 
      message: 'Twitter account disconnected successfully' 
    });
  } catch (error) {
    console.error('Twitter disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Twitter account' });
  }
});

// GET /api/twitter/connect-oauth1 - OAuth 1.0a for media uploads
router.get('/connect-oauth1', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('Initiating OAuth 1.0a connection for user:', userId);

    // Initialize OAuth 1.0a
    const oauth = OAuth({
      consumer: {
        key: process.env.TWITTER_CONSUMER_KEY,
        secret: process.env.TWITTER_CONSUMER_SECRET,
      },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });

    // Step 1: Get request token
    const requestTokenURL = 'https://api.twitter.com/oauth/request_token';
    const requestData = {
      url: requestTokenURL,
      method: 'POST',
      data: {
        oauth_callback: `${process.env.TWITTER_OAUTH1_CALLBACK_URL}`,
      },
    };

    const response = await fetch(requestTokenURL, {
      method: 'POST',
      headers: oauth.toHeader(oauth.authorize(requestData)),
    });

    const responseText = await response.text();
    console.log('OAuth 1.0a request token response:', responseText);

    if (!response.ok) {
      throw new Error(`Request token failed: ${responseText}`);
    }

    // Parse response
    const params = new URLSearchParams(responseText);
    const oauthToken = params.get('oauth_token');
    const oauthTokenSecret = params.get('oauth_token_secret');

    if (!oauthToken || !oauthTokenSecret) {
      throw new Error('Missing oauth token or secret in response');
    }

    // Store temporarily (you might want to use Redis in production)
    // For now, we'll store in memory
    if (!global.oauth1TempTokens) {
      global.oauth1TempTokens = new Map();
    }
    global.oauth1TempTokens.set(oauthToken, { 
      secret: oauthTokenSecret, 
      userId 
    });

    // Step 2: Redirect to Twitter
    const authURL = `https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`;
    
    res.json({ url: authURL });
  } catch (error) {
    console.error('OAuth 1.0a connect error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth 1.0a connection' });
  }
});

export default router;
