

import express from 'express';
import pool from '../config/database.js';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import { mediaService } from '../services/mediaService.js';
import { validateTwitterConnection, authenticateToken } from '../middleware/auth.js';

// Import new-platform database pool for user_social_accounts access
import pg from 'pg';
const { Pool } = pg;
const newPlatformPool = new Pool({
  connectionString: process.env.NEW_PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const router = express.Router();


// POST /api/twitter/upload-media - Upload images to Twitter and return media IDs
router.post('/upload-media', validateTwitterConnection, async (req, res) => {
  try {
    const { media } = req.body;
    const twitterAccount = req.twitterAccount;
    if (!media || !Array.isArray(media) || media.length === 0) {
      return res.status(400).json({ error: 'No media provided' });
    }
    if (!twitterAccount.oauth1_access_token || !twitterAccount.oauth1_access_token_secret) {
      return res.status(400).json({ error: 'OAuth 1.0a required for media upload. Please reconnect your Twitter account.' });
    }
    const oauth1Tokens = {
      accessToken: twitterAccount.oauth1_access_token,
      accessTokenSecret: twitterAccount.oauth1_access_token_secret
    };
    // Use TwitterApi client with OAuth2 token for user context
    const { TwitterApi } = await import('twitter-api-v2');
    const twitterClient = new TwitterApi(twitterAccount.access_token);
    const mediaIds = await mediaService.uploadMedia(media, twitterClient, oauth1Tokens);
    res.json({ success: true, mediaIds });
  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload media' });
  }
});


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
router.get('/connect', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
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

// GET /api/twitter/team-connect - Team-based OAuth 2.0 with PKCE for team social accounts
router.get('/team-connect', async (req, res) => {
  try {
    const { teamId, userId, returnUrl } = req.query;
    
    if (!teamId || !userId || !returnUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameters: teamId, userId, and returnUrl' 
      });
    }
    
    console.log('Generating Twitter OAuth URL for team connection:', { teamId, userId, returnUrl });
    console.log('Client ID:', process.env.TWITTER_CLIENT_ID);
    console.log('Redirect URI:', process.env.TWITTER_REDIRECT_URI);
    
    // Generate PKCE challenge
    const { codeVerifier, codeChallenge } = generatePKCE();
    
    // Store team context with code verifier (use combination of teamId and userId as key)
    const sessionKey = `team_${teamId}_${userId}`;
    pkceStore.set(sessionKey, {
      codeVerifier,
      teamId,
      userId,
      returnUrl
    });
    
    // Set expiry for the stored verifier (5 minutes)
    setTimeout(() => {
      pkceStore.delete(sessionKey);
    }, 5 * 60 * 1000);
    
    const scopes = 'tweet.read tweet.write users.read offline.access media.write';
    const authUrl = `https://twitter.com/i/oauth2/authorize?` +
      `response_type=code&` +
      `client_id=${process.env.TWITTER_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(process.env.TWITTER_REDIRECT_URI)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `state=${sessionKey}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256`;
      
    console.log('Generated team OAuth URL:', authUrl);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Failed to generate team OAuth URL:', error);
    const { returnUrl } = req.query;
    if (returnUrl) {
      return res.redirect(`${returnUrl}?error=oauth_init_failed`);
    }
    res.status(500).json({ error: 'Failed to initiate Twitter team connection' });
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
  console.log('[OAuth2 Callback] Step 1: Received callback', { code, state, error });
  const sessionKey = state;

  if (error) {
    console.error('[OAuth2 Callback] Step 2: Error in callback', error);
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=oauth_denied`);
  }

  if (!code) {
    console.error('[OAuth2 Callback] Step 3: No authorization code received');
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=no_code`);
  }

  const sessionData = pkceStore.get(sessionKey);
  console.log('[OAuth2 Callback] Step 4: Retrieved session data', sessionData);
  if (!sessionData) {
    console.error('[OAuth2 Callback] Step 5: No session data found for', sessionKey);
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=session_expired`);
  }

  const isTeamConnection = typeof sessionData === 'object' && sessionData.teamId;
  const codeVerifier = isTeamConnection ? sessionData.codeVerifier : sessionData;
  const userId = isTeamConnection ? sessionData.userId : sessionKey;
  const teamId = isTeamConnection ? sessionData.teamId : null;
  const returnUrl = isTeamConnection ? sessionData.returnUrl : null;

  try {
    console.log('[OAuth2 Callback] Step 6: Exchanging code for tokens', { code, codeVerifier });
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
    console.log('[OAuth2 Callback] Step 7: Token response', { status: tokenResponse.status, tokens });
    if (!tokens.access_token) {
      console.error('[OAuth2 Callback] Step 8: No access token received', tokens);
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=token_failed`);
    }

    pkceStore.delete(userId);
    console.log('[OAuth2 Callback] Step 9: Code verifier cleaned up');

    const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=public_metrics,verified,profile_image_url', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    });
    const twitterUser = await userResponse.json();
    console.log('[OAuth2 Callback] Step 10: Twitter user response', twitterUser);
    if (!twitterUser.data) {
      console.error('[OAuth2 Callback] Step 11: No user data received', twitterUser);
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=user_data_failed`);
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
    console.log('[OAuth2 Callback] Step 12: Calculated token expiry', expiresAt);

    if (isTeamConnection) {
      console.log('[OAuth2 Callback] Step 13: Team connection detected', { teamId, userId, twitterUserId: twitterUser.data.id });
      try {
        await pool.query(`
          INSERT INTO team_accounts (
            team_id, user_id, twitter_user_id, twitter_username, twitter_display_name,
            access_token, refresh_token, token_expires_at, twitter_profile_image_url,
            followers_count, following_count, tweet_count, verified, active, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, CURRENT_TIMESTAMP)
          ON CONFLICT (team_id, twitter_user_id) DO UPDATE SET
            twitter_username = $4,
            twitter_display_name = $5,
            access_token = $6,
            refresh_token = $7,
            token_expires_at = $8,
            twitter_profile_image_url = $9,
            followers_count = $10,
            following_count = $11,
            tweet_count = $12,
            verified = $13,
            active = true,
            updated_at = CURRENT_TIMESTAMP;
        `, [
          teamId,
          userId,
          twitterUser.data.id,
          twitterUser.data.username,
          twitterUser.data.name,
          tokens.access_token,
          tokens.refresh_token,
          expiresAt,
          twitterUser.data.profile_image_url,
          twitterUser.data.public_metrics.followers_count,
          twitterUser.data.public_metrics.following_count,
          twitterUser.data.public_metrics.tweet_count,
          twitterUser.data.verified || false
        ]);
        pkceStore.delete(sessionKey);
        console.log('[OAuth2 Callback] Step 14: Team account stored and session cleaned up');
        return res.redirect(`${returnUrl}?success=team&username=${encodeURIComponent(twitterUser.data.username)}`);
      } catch (err) {
        console.error('[OAuth2 Callback] Step 14 ERROR: Failed to upsert team account', err);
        pkceStore.delete(sessionKey);
        return res.redirect(`${returnUrl}?error=team_db_error`);
      }
    } else {
      console.log('[OAuth2 Callback] Step 13: Individual connection detected', { userId });
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
      pkceStore.delete(sessionKey);
      console.log('[OAuth2 Callback] Step 14: Individual account stored and session cleaned up');
      res.redirect(`${process.env.CLIENT_URL}/settings?twitter_connected=true`);
    }
  } catch (error) {
    console.error('[OAuth2 Callback] Step 15: Error in callback handler', error);
    pkceStore.delete(sessionKey);
    if (isTeamConnection && returnUrl) {
      return res.redirect(`${returnUrl}?error=connection_failed`);
    }
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

    const tokenData = global.oauth1TempTokens.get(oauth_token);
    const { secret: oauthTokenSecret, userId, teamId, returnUrl, isTeamConnection } = tokenData;
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

    if (isTeamConnection) {
      // Team connection: Update OAuth1 tokens in user_social_accounts table
      console.log('Updating OAuth1 tokens for team connection:', { teamId, userId });
      
      // Validate team membership and permissions
      const teamMemberResult = await pool.query(`
        SELECT role FROM team_members 
        WHERE team_id = $1 AND user_id = $2 AND status = 'active'
      `, [teamId, userId]);
      
      if (teamMemberResult.rows.length === 0) {
        console.error('User not authorized for team:', { teamId, userId });
        return res.redirect(`${returnUrl}?error=unauthorized`);
      }
      
      const userRole = teamMemberResult.rows[0].role;
      if (!['owner', 'admin'].includes(userRole)) {
        console.error('User lacks permission to connect accounts:', { teamId, userId, role: userRole });
        return res.redirect(`${returnUrl}?error=insufficient_permissions`);
      }
      
      // Update existing social account with OAuth1 tokens (if exists)
      const updateResult = await pool.query(`
        UPDATE user_social_accounts
        SET oauth1_access_token = $1,
            oauth1_access_token_secret = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE team_id = $3 AND platform = 'twitter' AND user_id = $4 AND is_active = true
        RETURNING id
      `, [accessToken, accessTokenSecret, teamId, userId]);
      
      if (updateResult.rows.length === 0) {
        console.error('No existing Twitter account found for OAuth1 token update:', { teamId, userId });
        return res.redirect(`${returnUrl}?error=account_not_found`);
      }
      
      console.log('OAuth 1.0a tokens stored successfully for team:', teamId);
      res.redirect(`${returnUrl}?success=oauth1_connected`);
    } else {
      // Individual user connection: Update twitter_auth table (legacy)
      await pool.query(`
        UPDATE twitter_auth 
        SET oauth1_access_token = $1, 
            oauth1_access_token_secret = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $3
      `, [accessToken, accessTokenSecret, userId]);

      console.log('OAuth 1.0a tokens stored successfully for user:', userId);
      res.redirect(`${process.env.CLIENT_URL}/settings?oauth1_connected=true`);
    }
  } catch (error) {
    console.error('OAuth 1.0a callback error:', error);
    
    if (isTeamConnection && returnUrl) {
      return res.redirect(`${returnUrl}?error=oauth1_connection_failed`);
    }
    
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
router.get('/connect-oauth1', authenticateToken, async (req, res) => {
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

// GET /api/twitter/team-connect-oauth1 - Team-based OAuth 1.0a for media uploads
router.get('/team-connect-oauth1', async (req, res) => {
  try {
    const { teamId, userId, returnUrl } = req.query;
    
    if (!teamId || !userId || !returnUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameters: teamId, userId, and returnUrl' 
      });
    }

    console.log('Initiating OAuth 1.0a team connection:', { teamId, userId });

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
    console.log('OAuth 1.0a team request token response:', responseText);

    if (!response.ok) {
      throw new Error(`Request token failed: ${responseText}`);
    }

    // Parse response
    const params = new URLSearchParams(responseText);
    const oauthToken = params.get('oauth_token');
    const oauthTokenSecret = params.get('oauth_token_secret');

    if (!oauthToken || !oauthTokenSecret) {
      throw new Error('Missing OAuth token or secret');
    }

    // Store token temporarily with team context
    global.oauth1TempTokens = global.oauth1TempTokens || new Map();
    global.oauth1TempTokens.set(oauthToken, { 
      secret: oauthTokenSecret, 
      userId,
      teamId,
      returnUrl,
      isTeamConnection: true
    });

    // Clean up after 5 minutes
    setTimeout(() => {
      if (global.oauth1TempTokens) {
        global.oauth1TempTokens.delete(oauthToken);
      }
    }, 5 * 60 * 1000);

    // Step 2: Redirect to Twitter
    const authURL = `https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`;
    
    res.redirect(authURL);
  } catch (error) {
    console.error('OAuth 1.0a team connect error:', error);
    const { returnUrl } = req.query;
    if (returnUrl) {
      return res.redirect(`${returnUrl}?error=oauth1_init_failed`);
    }
    res.status(500).json({ error: 'Failed to initiate OAuth 1.0a team connection' });
  }
});

// GET /api/twitter/test-team-accounts - Test endpoint to verify team accounts functionality (no auth required)
router.get('/test-team-accounts', async (req, res) => {
  try {
    // Test with a sample team ID if provided, otherwise just return structure
    const testTeamId = req.query.teamId;
    
    if (!testTeamId) {
      return res.json({
        message: 'Provide ?teamId=<uuid> to test with actual data',
        structure: {
          accounts: [],
          team_id: null
        }
      });
    }

    console.log('Testing team Twitter accounts for team:', testTeamId);

    // Get all Twitter accounts for this team
    const accountsResult = await newPlatformPool.query(`
      SELECT 
        id,
        account_id,
        account_username,
        account_display_name,
        profile_image_url,
        created_at,
        updated_at,
        oauth1_access_token IS NOT NULL AND oauth1_access_token_secret IS NOT NULL as has_oauth1
      FROM user_social_accounts 
      WHERE team_id = $1 AND platform = 'twitter' AND is_active = true
      ORDER BY created_at ASC
    `, [testTeamId]);

    const accounts = accountsResult.rows.map(account => ({
      id: account.id,
      twitter_user_id: account.account_id,
      username: account.account_username,
      display_name: account.account_display_name,
      profile_image_url: account.profile_image_url,
      has_oauth1: account.has_oauth1,
      created_at: account.created_at,
      updated_at: account.updated_at
    }));

    console.log(`Found ${accounts.length} Twitter accounts for team ${testTeamId}`);
    
    res.json({ 
      success: true,
      accounts,
      team_id: testTeamId,
      message: `Found ${accounts.length} Twitter accounts for team`
    });
  } catch (error) {
    console.error('Failed to test team Twitter accounts:', error);
    res.status(500).json({ error: 'Failed to test team accounts', details: error.message });
  }
});

// GET /api/twitter/user/profile - Return authenticated user's profile
router.get('/user/profile', authenticateToken, async (req, res) => {
  console.log('[PROERP] /api/twitter/user/profile called');
  if (!req.user) {
    console.log('[PROERP] Not authenticated');
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  console.log('[PROERP] Authenticated user:', {
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    team_id: req.user.team_id,
    teamMemberships: req.user.teamMemberships
  });
  res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name || '',
      team_id: req.user.team_id || null,
      teamMemberships: req.user.teamMemberships || [],
    }
  });
});

// GET /api/twitter/team-accounts - Get team's Twitter accounts for account switching (REQUIRES AUTH)
router.get('/team-accounts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('Fetching team Twitter accounts for user:', userId);

    // Get user's team (assuming they can only be in one active team)
    const teamResult = await newPlatformPool.query(`
      SELECT team_id FROM team_members 
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `, [userId]);

    if (teamResult.rows.length === 0) {
      return res.json({ accounts: [] }); // User not in any team
    }

    const teamId = teamResult.rows[0].team_id;

    // Get Twitter accounts from user_social_accounts (OAuth1)
    const oauth1AccountsResult = await newPlatformPool.query(`
      SELECT 
        id,
        account_id,
        account_username,
        account_display_name,
        profile_image_url,
        created_at,
        updated_at,
        oauth1_access_token IS NOT NULL AND oauth1_access_token_secret IS NOT NULL as has_oauth1
      FROM user_social_accounts 
      WHERE team_id = $1 AND platform = 'twitter' AND is_active = true
      ORDER BY created_at ASC
    `, [teamId]);

    const oauth1Accounts = oauth1AccountsResult.rows.map(account => ({
      id: account.id,
      twitter_user_id: account.account_id,
      username: account.account_username,
      display_name: account.account_display_name,
      profile_image_url: account.profile_image_url,
      has_oauth1: account.has_oauth1,
      created_at: account.created_at,
      updated_at: account.updated_at,
      type: 'oauth1'
    }));

    // Get Twitter accounts from team_accounts (OAuth2)
    const oauth2AccountsResult = await pool.query(`
      SELECT 
        team_id,
        user_id,
        twitter_user_id,
        twitter_username,
        twitter_display_name,
        twitter_profile_image_url,
        followers_count,
        following_count,
        tweet_count,
        verified,
        active,
        token_expires_at,
        updated_at
      FROM team_accounts
      WHERE team_id = $1 AND active = true
      ORDER BY updated_at DESC
    `, [teamId]);

    const oauth2Accounts = oauth2AccountsResult.rows.map(account => ({
      id: `${account.team_id}_${account.twitter_user_id}`,
      twitter_user_id: account.twitter_user_id,
      username: account.twitter_username,
      display_name: account.twitter_display_name,
      profile_image_url: account.twitter_profile_image_url,
      followers_count: account.followers_count,
      following_count: account.following_count,
      tweet_count: account.tweet_count,
      verified: account.verified,
      has_oauth1: false,
      created_at: null,
      updated_at: account.updated_at,
      type: 'oauth2'
    }));

    // Merge both account types
    const accounts = [...oauth1Accounts, ...oauth2Accounts];

    console.log(`[API] /api/twitter/team-accounts response for team ${teamId}:`, JSON.stringify(accounts, null, 2));
    res.json({ 
      success: true,
      accounts,
      team_id: teamId
    });
  } catch (error) {
    console.error('Failed to fetch team Twitter accounts:', error);
    res.status(500).json({ error: 'Failed to fetch team accounts' });
  }
});

export default router;
