import express from 'express';
import pool from '../config/database.js';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import { mediaService } from '../services/mediaService.js';
import { validateTwitterConnection, authenticateToken } from '../middleware/auth.js';
import {
  cleanupDuplicatePersonalTwitterAuth,
  fetchLatestPersonalTwitterAuth,
  fetchPersonalTwitterAuthById,
} from '../utils/personalTwitterAuth.js';
import {
  deactivateTwitterConnectedAccount,
  mapTwitterRegistryInputFromSourceRow,
  upsertTwitterConnectedAccount,
} from '../utils/twitterConnectedAccountRegistry.js';
import {
  createTwitterPostingClient,
  ensureTwitterAccountReady,
  getTwitterConnectionStatus,
  TwitterReconnectRequiredError,
} from '../utils/twitterRuntimeAuth.js';

// Import new-platform database pool for user_social_accounts access
import pg from 'pg';
const { Pool } = pg;
const platformDatabaseUrl = process.env.NEW_PLATFORM_DATABASE_URL || process.env.DATABASE_URL || '';
const usePlatformDbSsl =
  platformDatabaseUrl.includes('supabase.com') ||
  platformDatabaseUrl.includes('supabase.co') ||
  process.env.NODE_ENV === 'production';

const newPlatformPool = new Pool({
  connectionString: platformDatabaseUrl,
  ssl: usePlatformDbSsl ? { rejectUnauthorized: false } : false,
});

const router = express.Router();
const TWITTER_DEBUG = process.env.TWITTER_DEBUG === 'true';

const twitterDebug = (...args) => {
  if (TWITTER_DEBUG) {
    console.log(...args);
  }
};

const getActiveTeamIdsFromUserPayload = (user = {}) => {
  const memberships = Array.isArray(user?.teamMemberships) ? user.teamMemberships : null;
  if (!memberships) return null;

  return Array.from(
    new Set(
      memberships
        .filter((row) => String(row?.status || 'active').toLowerCase() === 'active')
        .map((row) => String(row?.teamId || row?.team_id || '').trim())
        .filter(Boolean)
    )
  );
};

const resolveValidatedRequestTeamId = async (req) => {
  const userId = req.user?.id || req.user?.userId || null;
  if (!userId) return null;

  const authActiveTeamIds = getActiveTeamIdsFromUserPayload(req.user) || [];
  const hintedTeamIds = [
    req.headers['x-team-id'],
    req.user?.teamId,
    req.user?.team_id,
    ...authActiveTeamIds,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (hintedTeamIds.length === 0) return null;

  const membershipResult = await pool.query(
    `SELECT team_id
     FROM team_members
     WHERE user_id = $1
       AND status = 'active'
       AND team_id::text = ANY($2::text[])
     ORDER BY
       CASE
         WHEN team_id::text = $3::text THEN 0
         ELSE 1
       END,
       team_id ASC
     LIMIT 1`,
    [userId, hintedTeamIds, hintedTeamIds[0]]
  );

  if (membershipResult.rows.length === 0) {
    return null;
  }

  return String(membershipResult.rows[0].team_id || '').trim() || null;
};

const isTeamModeRequest = async (req) => Boolean(await resolveValidatedRequestTeamId(req));

const sendTeamModePersonalLock = (res) =>
  res.status(403).json({
    error: 'You are in team mode. Personal Twitter account actions are locked.',
    code: 'TEAM_MODE_PERSONAL_LOCKED',
  });

function sendPopupResult(
  res,
  messageType,
  payload = {},
  message = 'Authentication complete. You can close this window.',
  redirectUrl = `${process.env.CLIENT_URL}/settings`
) {
  const eventData = JSON.stringify({ type: messageType, ...payload })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const safeMessage = String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fallbackUrl = JSON.stringify(redirectUrl || `${process.env.CLIENT_URL}/settings`)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  // Allow inline callback script and keep opener available for popup callbacks.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

  return res.send(`
    <html>
      <body>
        <script>
          var payload = ${eventData};
          try {
            if (window.opener) {
              window.opener.postMessage(payload, '*');
            }
          } catch (e) {}
          try {
            if (!window.opener) {
              localStorage.setItem('suitegenie_oauth_result', JSON.stringify(payload));
            }
          } catch (e) {}
          window.close();
          setTimeout(function () {
            try { window.open('', '_self'); } catch (e) {}
            try { window.close(); } catch (e) {}
            if (!window.closed || !window.opener) {
              window.location.replace(${fallbackUrl});
            }
          }, 150);
        </script>
        <p>${safeMessage}</p>
      </body>
    </html>
  `);
}


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
    const twitterClient = createTwitterPostingClient(twitterAccount, { preferOAuth1: true });
    if (!twitterClient) {
      return res.status(401).json({ error: 'Twitter account not connected. Please reconnect your Twitter account.' });
    }
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

const normalizeTwitterOAuthProfile = (twitterUser = {}) => {
  const data = twitterUser?.data && typeof twitterUser.data === 'object' ? twitterUser.data : {};
  const publicMetrics =
    data?.public_metrics && typeof data.public_metrics === 'object' ? data.public_metrics : {};

  const normalizedId = String(data?.id || '').trim();
  const normalizedUsername = String(data?.username || '').trim();
  const normalizedName = String(data?.name || normalizedUsername || '').trim();

  return {
    id: normalizedId || null,
    username: normalizedUsername || null,
    displayName: normalizedName || null,
    profileImageUrl: typeof data?.profile_image_url === 'string' ? data.profile_image_url : null,
    followersCount: Number.isFinite(Number(publicMetrics?.followers_count))
      ? Number(publicMetrics.followers_count)
      : null,
    followingCount: Number.isFinite(Number(publicMetrics?.following_count))
      ? Number(publicMetrics.following_count)
      : null,
    tweetCount: Number.isFinite(Number(publicMetrics?.tweet_count))
      ? Number(publicMetrics.tweet_count)
      : null,
    verified: Boolean(data?.verified),
  };
};

const normalizeTwitterTokenExpiry = (tokens = {}) => {
  const rawExpiresIn = Number(tokens?.expires_in);
  if (!Number.isFinite(rawExpiresIn) || rawExpiresIn <= 0) {
    return null;
  }

  const expiresAt = new Date(Date.now() + rawExpiresIn * 1000);
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt;
};

// Store PKCE verifiers temporarily (in production, use Redis)
const pkceStore = new Map();

// GET /api/twitter/status - Returns connected Twitter account info
router.get('/status', async (req, res) => {
  try {
    const userId = req.user?.id;
    const requestTeamId = await resolveValidatedRequestTeamId(req);
    const selectedAccountId = req.headers['x-selected-account-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // In team mode, personal status is intentionally hidden/locked.
    if (requestTeamId) {
      return res.json({
        connected: false,
        account: null,
        accounts: [],
        teamMode: true,
        personalLocked: true,
        message: 'You are in team mode. Switch out of team mode to manage personal Twitter account connections.',
      });
    }

    let account = null;
    if (selectedAccountId) {
      account = await fetchPersonalTwitterAuthById(pool, userId, selectedAccountId, {
        columns: `id, twitter_user_id, twitter_username, twitter_display_name,
                twitter_profile_image_url, followers_count, following_count,
                tweet_count, verified, created_at,
                oauth1_access_token, oauth1_access_token_secret`,
      });
    }

    if (!account) {
      account = await fetchLatestPersonalTwitterAuth(pool, userId, {
        columns: `id, twitter_user_id, twitter_username, twitter_display_name,
                twitter_profile_image_url, followers_count, following_count,
                tweet_count, verified, created_at,
                oauth1_access_token, oauth1_access_token_secret`,
      });
    }
    if (!account) {
      return res.json({ connected: false, account: null, accounts: [] });
    }
    
    // Map database fields to frontend expected format
    const formattedAccount = {
      id: account.id,
      account_id: account.id,
      twitter_user_id: account.twitter_user_id,
      username: account.twitter_username,
      twitterUsername: account.twitter_username,
      display_name: account.twitter_display_name,
      displayName: account.twitter_display_name,
      profile_image_url: account.twitter_profile_image_url,
      followers_count: account.followers_count,
      following_count: account.following_count,
      tweet_count: account.tweet_count,
      verified: account.verified,
      created_at: account.created_at,
      connectedAt: account.created_at,
      has_oauth1: !!(account.oauth1_access_token && account.oauth1_access_token_secret)
    };
    
    // Return as array for frontend compatibility
    res.json({ connected: true, account: formattedAccount, accounts: [formattedAccount] });
  } catch (error) {
    console.error('Twitter status error:', error);
    res.status(500).json({ error: 'Failed to fetch Twitter account status' });
  }
});

// GET /api/twitter/connect - OAuth 2.0 with PKCE
router.get('/connect', authenticateToken, async (req, res) => {
  try {
    if (await isTeamModeRequest(req)) {
      return sendTeamModePersonalLock(res);
    }

    const userId = req.user.id;
    const popup = String(req.query.popup || '').toLowerCase() === 'true';
    
    console.log('Generating Twitter OAuth URL with PKCE for user:', userId);
    console.log('Client ID:', process.env.TWITTER_CLIENT_ID);
    console.log('Redirect URI:', process.env.TWITTER_REDIRECT_URI);
    
    // Generate PKCE challenge
    const { codeVerifier, codeChallenge } = generatePKCE();
    
    // Store code verifier temporarily (use user ID as key)
    pkceStore.set(userId, {
      codeVerifier,
      userId,
      popup
    });
    
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
  const sessionData = pkceStore.get(sessionKey);
  console.log('[OAuth2 Callback] Step 4: Retrieved session data', sessionData);
  const isObjectSession = typeof sessionData === 'object' && sessionData !== null;
  const isTeamConnection = isObjectSession && !!sessionData.teamId;
  const isPopupFlow = isObjectSession && !!sessionData.popup && !isTeamConnection;

  if (error) {
    console.error('[OAuth2 Callback] Step 2: Error in callback', error);
    if (isPopupFlow) {
      pkceStore.delete(sessionKey);
      return sendPopupResult(
        res,
        'TWITTER_AUTH_ERROR',
        { provider: 'twitter', oauthType: 'oauth2', error: 'oauth_denied' },
        'Twitter authorization was denied.',
        `${process.env.CLIENT_URL}/settings?error=oauth_denied`
      );
    }
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=oauth_denied`);
  }

  if (!code) {
    console.error('[OAuth2 Callback] Step 3: No authorization code received');
    if (isPopupFlow) {
      pkceStore.delete(sessionKey);
      return sendPopupResult(
        res,
        'TWITTER_AUTH_ERROR',
        { provider: 'twitter', oauthType: 'oauth2', error: 'no_code' },
        'Twitter callback missing authorization code.',
        `${process.env.CLIENT_URL}/settings?error=no_code`
      );
    }
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=no_code`);
  }

  if (!sessionData) {
    console.error('[OAuth2 Callback] Step 5: No session data found for', sessionKey);
    return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=session_expired`);
  }

  const codeVerifier = isObjectSession ? sessionData.codeVerifier : sessionData;
  const userId = isObjectSession ? (sessionData.userId || sessionKey) : sessionKey;
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
    
    // Check response status and get text first for better error handling
    const responseText = await tokenResponse.text();
    console.log('[OAuth2 Callback] Step 7: Token response', { status: tokenResponse.status, responseText });
    
    // Try to parse JSON, handle errors gracefully
    let tokens;
    try {
      tokens = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[OAuth2 Callback] Step 7.5: Failed to parse token response as JSON', { parseError, responseText });
      pkceStore.delete(sessionKey);
      if (isTeamConnection && returnUrl) {
        return res.redirect(`${returnUrl}?error=token_parse_failed`);
      }
      if (isPopupFlow) {
        return sendPopupResult(
          res,
          'TWITTER_AUTH_ERROR',
          { provider: 'twitter', oauthType: 'oauth2', error: 'token_parse_failed' },
          'Failed to parse Twitter token response. Please try again.',
          `${process.env.CLIENT_URL}/settings?error=token_parse_failed`
        );
      }
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=token_parse_failed`);
    }
    
    if (!tokens.access_token) {
      console.error('[OAuth2 Callback] Step 8: No access token received', tokens);
      pkceStore.delete(sessionKey);
      if (isTeamConnection && returnUrl) {
        return res.redirect(`${returnUrl}?error=token_failed`);
      }
      if (isPopupFlow) {
        return sendPopupResult(
          res,
          'TWITTER_AUTH_ERROR',
          { provider: 'twitter', oauthType: 'oauth2', error: 'token_failed' },
          'No access token received from Twitter. Please try again.',
          `${process.env.CLIENT_URL}/settings?error=token_failed`
        );
      }
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=token_failed`);
    }

    pkceStore.delete(sessionKey);
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

    const expiresAt = normalizeTwitterTokenExpiry(tokens);
    console.log('[OAuth2 Callback] Step 12: Calculated token expiry', expiresAt);
    const normalizedTwitterProfile = normalizeTwitterOAuthProfile(twitterUser);

    if (!normalizedTwitterProfile.id || !normalizedTwitterProfile.username) {
      console.error('[OAuth2 Callback] Step 12.5: Incomplete Twitter user payload', {
        twitterUser,
        normalizedTwitterProfile,
      });
      if (isTeamConnection && returnUrl) {
        return res.redirect(`${returnUrl}?error=user_data_incomplete`);
      }
      if (isPopupFlow) {
        return sendPopupResult(
          res,
          'TWITTER_AUTH_ERROR',
          { provider: 'twitter', oauthType: 'oauth2', error: 'user_data_incomplete' },
          'Twitter did not return complete account details. Please try again.',
          `${process.env.CLIENT_URL}/settings?error=user_data_incomplete`
        );
      }
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=user_data_incomplete`);
    }

    if (isTeamConnection) {
      console.log('[OAuth2 Callback] Step 13: Team connection detected', {
        teamId,
        userId,
        twitterUserId: normalizedTwitterProfile.id,
        twitterUsername: normalizedTwitterProfile.username,
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: upsertedTeamRows } = await client.query(
          `
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
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `,
          [
            teamId,
            userId,
            normalizedTwitterProfile.id,
            normalizedTwitterProfile.username,
            normalizedTwitterProfile.displayName,
            tokens.access_token,
            tokens.refresh_token || null,
            expiresAt,
            normalizedTwitterProfile.profileImageUrl,
            normalizedTwitterProfile.followersCount,
            normalizedTwitterProfile.followingCount,
            normalizedTwitterProfile.tweetCount,
            normalizedTwitterProfile.verified,
          ]
        );
        const teamAccountRow = upsertedTeamRows[0];
        await upsertTwitterConnectedAccount(client, {
          ...mapTwitterRegistryInputFromSourceRow('team_accounts', teamAccountRow),
          metadata: {
            connected_via: 'oauth2',
          },
        });
        await client.query('COMMIT');
        pkceStore.delete(sessionKey);
        console.log('[OAuth2 Callback] Step 14: Team account stored and session cleaned up');
        return res.redirect(`${returnUrl}?success=team&username=${encodeURIComponent(normalizedTwitterProfile.username)}`);
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        console.error('[OAuth2 Callback] Step 14 ERROR: Failed to upsert team account', {
          message: err?.message || String(err),
          code: err?.code || null,
          detail: err?.detail || null,
          constraint: err?.constraint || null,
          teamId,
          userId,
          twitterUserId: normalizedTwitterProfile.id,
          twitterUsername: normalizedTwitterProfile.username,
        });
        pkceStore.delete(sessionKey);
        return res.redirect(`${returnUrl}?error=team_db_error`);
      } finally {
        client.release();
      }
    } else {
      console.log('[OAuth2 Callback] Step 13: Individual connection detected', { userId });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: personalRows } = await client.query(
          `
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
            RETURNING *
          `,
          [
            userId,
            tokens.access_token,
            tokens.refresh_token || null,
            expiresAt,
            normalizedTwitterProfile.id,
            normalizedTwitterProfile.username,
            normalizedTwitterProfile.displayName,
            normalizedTwitterProfile.profileImageUrl,
            normalizedTwitterProfile.followersCount,
            normalizedTwitterProfile.followingCount,
            normalizedTwitterProfile.tweetCount,
            normalizedTwitterProfile.verified,
          ]
        );
        const deletedDuplicateCount = await cleanupDuplicatePersonalTwitterAuth(client, userId);
        const personalAuthRow = personalRows[0];
        await upsertTwitterConnectedAccount(client, {
          ...mapTwitterRegistryInputFromSourceRow('twitter_auth', personalAuthRow),
          metadata: {
            connected_via: 'oauth2',
          },
        });
        await client.query('COMMIT');
        if (deletedDuplicateCount > 0) {
          console.log('[OAuth2 Callback] Removed duplicate personal twitter_auth rows:', {
            userId,
            deletedDuplicateCount,
          });
        }
        pkceStore.delete(sessionKey);
        console.log('[OAuth2 Callback] Step 14: Individual account stored and session cleaned up');
        if (isPopupFlow) {
          return sendPopupResult(
            res,
            'TWITTER_AUTH_SUCCESS',
            {
              provider: 'twitter',
              oauthType: 'oauth2',
              username: normalizedTwitterProfile.username
            },
            `Twitter account @${normalizedTwitterProfile.username} connected successfully.`,
            `${process.env.CLIENT_URL}/settings?twitter_connected=true`
          );
        }
        return res.redirect(`${process.env.CLIENT_URL}/settings?twitter_connected=true`);
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw err;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error('[OAuth2 Callback] Step 15: Error in callback handler', error);
    pkceStore.delete(sessionKey);
    if (isTeamConnection && returnUrl) {
      return res.redirect(`${returnUrl}?error=connection_failed`);
    }
    if (isPopupFlow) {
      return sendPopupResult(
        res,
        'TWITTER_AUTH_ERROR',
        { provider: 'twitter', oauthType: 'oauth2', error: 'connection_failed' },
        'Twitter connection failed. Please try again.',
        `${process.env.CLIENT_URL}/settings?error=connection_failed`
      );
    }
    return res.redirect(`${process.env.CLIENT_URL}/settings?error=connection_failed`);
  }
}

// OAuth 1.0a callback handler - FIXED VERSION
async function handleOAuth1Callback(req, res) {
  const { oauth_token, oauth_verifier } = req.query;
  let popupFlow = false;
  
  console.log('[OAuth1 Callback] OAuth 1.0a callback received:', { oauth_token: !!oauth_token, oauth_verifier: !!oauth_verifier });
  
  if (!oauth_token || !oauth_verifier) {
    return res.redirect(`${process.env.CLIENT_URL}/settings?error=oauth1_missing_params`);
  }

  try {
    // Get stored token secret
    if (!global.oauth1TempTokens || !global.oauth1TempTokens.has(oauth_token)) {
      throw new Error('OAuth token not found or expired');
    }

    const tokenData = global.oauth1TempTokens.get(oauth_token);
    const { secret: oauthTokenSecret, userId, teamId, returnUrl, isTeamConnection, popup } = tokenData;
    popupFlow = !!popup;
    global.oauth1TempTokens.delete(oauth_token); // Clean up

    console.log('[OAuth1 Callback] Token data retrieved:', { userId, teamId, isTeamConnection });

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
    console.log('[OAuth1 Callback] Access token response:', responseText);

    if (!response.ok) {
      throw new Error(`Access token failed: ${responseText}`);
    }

    // Parse access token response
    const params = new URLSearchParams(responseText);
    const accessToken = params.get('oauth_token');
    const accessTokenSecret = params.get('oauth_token_secret');
    // ⭐ FIX: Get these from params, not undefined variables
    const twitterUserId = params.get('user_id');
    const screenName = params.get('screen_name');

    if (!accessToken || !accessTokenSecret) {
      throw new Error('Missing access token or secret');
    }

    console.log('[OAuth1 Callback] OAuth1 tokens received:', { 
      hasAccessToken: !!accessToken, 
      hasAccessTokenSecret: !!accessTokenSecret,
      twitterUserId,
      screenName
    });

    if (isTeamConnection) {
      // Team connection: Update OAuth1 tokens in team_accounts table
      console.log('[OAuth1 Callback] Updating OAuth1 tokens for team connection:', { teamId, userId, twitterUserId, screenName });

      // Validate team membership and permissions
      const teamMemberResult = await pool.query(`
        SELECT role FROM team_members 
        WHERE team_id = $1 AND user_id = $2 AND status = 'active'
      `, [teamId, userId]);

      if (teamMemberResult.rows.length === 0) {
        console.error('[OAuth1 Callback] User not authorized for team:', { teamId, userId });
        return res.redirect(`${returnUrl}?error=unauthorized`);
      }

      const userRole = teamMemberResult.rows[0].role;
      if (!['owner', 'admin'].includes(userRole)) {
        console.error('[OAuth1 Callback] User lacks permission to connect accounts:', { teamId, userId, role: userRole });
        return res.redirect(`${returnUrl}?error=insufficient_permissions`);
      }

      // CRITICAL FIX: Update team_accounts table (not user_social_accounts)
      console.log('[OAuth1 Callback] Attempting to update team_accounts with OAuth1 tokens');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // First try to find existing account by twitter_user_id
        const existingAccountResult = await client.query(`
          SELECT *
          FROM team_accounts
          WHERE team_id = $1 AND twitter_user_id = $2
        `, [teamId, twitterUserId]);

        let persistedTeamAccount = null;

        if (existingAccountResult.rows.length > 0) {
          // Update existing team account with OAuth1 tokens
          console.log('[OAuth1 Callback] Found existing team account, updating with OAuth1 tokens');
          const updateResult = await client.query(`
            UPDATE team_accounts
            SET oauth1_access_token = $1,
                oauth1_access_token_secret = $2,
                active = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE team_id = $3 AND twitter_user_id = $4
            RETURNING *
          `, [accessToken, accessTokenSecret, teamId, twitterUserId]);

          console.log('[OAuth1 Callback] Update result:', updateResult.rows);
          persistedTeamAccount = updateResult.rows[0] || null;
        } else {
          // No existing OAuth2 account found - fetch Twitter details and create new account
          console.log('[OAuth1 Callback] No existing team account found, fetching Twitter details and creating new account');

          let accountDisplayName = screenName;
          let profileImageUrl = null;

          try {
            const { TwitterApi } = await import('twitter-api-v2');
            const twitterClient = new TwitterApi({
              appKey: process.env.TWITTER_CONSUMER_KEY,
              appSecret: process.env.TWITTER_CONSUMER_SECRET,
              accessToken,
              accessSecret: accessTokenSecret
            });

            const userData = await twitterClient.v1.verifyCredentials();
            accountDisplayName = userData.name;
            profileImageUrl = userData.profile_image_url_https;

            console.log('[OAuth1 Callback] Fetched Twitter details:', {
              screenName: userData.screen_name,
              name: userData.name,
              profileImageUrl
            });
          } catch (fetchErr) {
            console.error('[OAuth1 Callback] Failed to fetch Twitter account details:', fetchErr);
          }

          // Insert new team account with OAuth1 tokens only
          const insertResult = await client.query(`
            INSERT INTO team_accounts (
              team_id, user_id, twitter_user_id, twitter_username, twitter_display_name,
              twitter_profile_image_url, oauth1_access_token, oauth1_access_token_secret,
              active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
          `, [teamId, userId, twitterUserId, screenName, accountDisplayName, profileImageUrl, accessToken, accessTokenSecret]);

          console.log('[OAuth1 Callback] Insert result:', insertResult.rows);
          persistedTeamAccount = insertResult.rows[0] || null;
        }

        if (!persistedTeamAccount) {
          throw new Error('Failed to store OAuth1 tokens in team_accounts');
        }

        await upsertTwitterConnectedAccount(client, {
          ...mapTwitterRegistryInputFromSourceRow('team_accounts', persistedTeamAccount),
          metadata: {
            connected_via: persistedTeamAccount.access_token ? 'oauth2+oauth1' : 'oauth1',
          },
        });

        await client.query('COMMIT');
        console.log('[OAuth1 Callback] OAuth 1.0a tokens stored successfully in team_accounts');
        return res.redirect(`${returnUrl}?success=oauth1_connected&username=${encodeURIComponent(persistedTeamAccount.twitter_username)}`);
      } catch (teamOAuth1Error) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        console.error('[OAuth1 Callback] Failed to store OAuth1 tokens in team_accounts', teamOAuth1Error);
        return res.redirect(`${returnUrl}?error=oauth1_storage_failed`);
      } finally {
        client.release();
      }
    } else {
      // Individual user connection: Update twitter_auth table (legacy)
      console.log('[OAuth1 Callback] Updating OAuth1 tokens for individual user:', userId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const updateResult = await client.query(`
          UPDATE twitter_auth
          SET oauth1_access_token = $1,
              oauth1_access_token_secret = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $3
          RETURNING *
        `, [accessToken, accessTokenSecret, userId]);

        const deletedDuplicateCount = await cleanupDuplicatePersonalTwitterAuth(client, userId);
        if (deletedDuplicateCount > 0) {
          console.log('[OAuth1 Callback] Removed duplicate personal twitter_auth rows:', {
            userId,
            deletedDuplicateCount,
          });
        }

        const personalTwitterAuth =
          updateResult.rows[0] ||
          (await fetchLatestPersonalTwitterAuth(client, userId));

        if (!personalTwitterAuth) {
          throw new Error('Personal twitter_auth not found for OAuth1 callback');
        }

        await upsertTwitterConnectedAccount(client, {
          ...mapTwitterRegistryInputFromSourceRow('twitter_auth', personalTwitterAuth),
          metadata: {
            connected_via: personalTwitterAuth.access_token ? 'oauth2+oauth1' : 'oauth1',
          },
        });

        await client.query('COMMIT');
        console.log('[OAuth1 Callback] OAuth 1.0a tokens stored successfully for user:', userId);
        if (popupFlow) {
          return sendPopupResult(
            res,
            'TWITTER_AUTH_SUCCESS',
            { provider: 'twitter', oauthType: 'oauth1', username: screenName },
            `Twitter media permissions enabled for @${screenName || 'your account'}.`,
            `${process.env.CLIENT_URL}/settings?oauth1_connected=true`
          );
        }
        return res.redirect(`${process.env.CLIENT_URL}/settings?oauth1_connected=true`);
      } catch (personalOAuth1Error) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw personalOAuth1Error;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error('[OAuth1 Callback] OAuth 1.0a callback error:', error);
    
    // Get tokenData safely in case it exists
    let isTeamConnection = false;
    let returnUrl = null;
    let popup = popupFlow;
    
    if (global.oauth1TempTokens && global.oauth1TempTokens.has(oauth_token)) {
      const tokenData = global.oauth1TempTokens.get(oauth_token);
      isTeamConnection = tokenData?.isTeamConnection;
      returnUrl = tokenData?.returnUrl;
      popup = tokenData?.popup;
    }
    
    if (isTeamConnection && returnUrl) {
      return res.redirect(`${returnUrl}?error=oauth1_connection_failed`);
    }
    if (popup) {
      return sendPopupResult(
        res,
        'TWITTER_AUTH_ERROR',
        { provider: 'twitter', oauthType: 'oauth1', error: 'oauth1_connection_failed' },
        'Failed to enable Twitter media permissions. Please try again.',
        `${process.env.CLIENT_URL}/settings?error=oauth1_connection_failed`
      );
    }

    return res.redirect(`${process.env.CLIENT_URL}/settings?error=oauth1_connection_failed`);
  }
}

// POST /api/twitter/disconnect - Disconnect Twitter account
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user?.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = await resolveValidatedRequestTeamId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (requestTeamId && !selectedAccountId) {
      return res.status(400).json({
        error: 'Team account selection required. Please select a team Twitter account first.',
        code: 'TEAM_ACCOUNT_SELECTION_REQUIRED',
      });
    }

    if (selectedAccountId && requestTeamId) {
      const membershipResult = await pool.query(
        `SELECT 1
         FROM team_members
         WHERE team_id = $1 AND user_id = $2 AND status = 'active'
         LIMIT 1`,
        [requestTeamId, userId]
      );

      if (membershipResult.rows.length === 0) {
        return res.status(403).json({ error: 'Not authorized to disconnect this team account' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: disconnectedTeamRows, rowCount } = await client.query(
          `UPDATE team_accounts
           SET active = false,
               access_token = NULL,
               refresh_token = NULL,
               token_expires_at = NULL,
               oauth1_access_token = NULL,
               oauth1_access_token_secret = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1::text
             AND team_id::text = $2::text
           RETURNING *`,
          [selectedAccountId, requestTeamId]
        );

        if (rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'No team Twitter account found to disconnect' });
        }

        const disconnectedTeamAccount = disconnectedTeamRows[0];
        await deactivateTwitterConnectedAccount(client, {
          userId,
          teamId: requestTeamId,
          twitterUserId: disconnectedTeamAccount?.twitter_user_id,
          sourceTable: 'team_accounts',
          sourceId: disconnectedTeamAccount?.id,
        });

        await client.query('COMMIT');
        console.log('Team Twitter account disconnected successfully:', { userId, teamId: requestTeamId, selectedAccountId });
        return res.json({
          success: true,
          message: 'Twitter account disconnected successfully',
          accountType: 'team',
        });
      } catch (disconnectTeamError) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw disconnectTeamError;
      } finally {
        client.release();
      }
    }

    if (requestTeamId) {
      return sendTeamModePersonalLock(res);
    }

    console.log('Disconnecting personal Twitter account for user:', userId);

    // Delete the Twitter auth record for this user
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: deletedPersonalRows, rowCount } = await client.query(
        'DELETE FROM twitter_auth WHERE user_id = $1 RETURNING *',
        [userId]
      );

      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No Twitter account found to disconnect' });
      }

      const deletedPersonalAccount = deletedPersonalRows[0];
      await deactivateTwitterConnectedAccount(client, {
        userId,
        twitterUserId: deletedPersonalAccount?.twitter_user_id,
        sourceTable: 'twitter_auth',
        sourceId: deletedPersonalAccount?.id,
      });

      await client.query('COMMIT');
      console.log('Personal Twitter account disconnected successfully for user:', userId);
      res.json({
        success: true,
        message: 'Twitter account disconnected successfully',
        accountType: 'personal',
      });
    } catch (disconnectPersonalError) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw disconnectPersonalError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Twitter disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Twitter account' });
  }
});

// GET /api/twitter/connect-oauth1 - OAuth 1.0a for media uploads
router.get('/connect-oauth1', authenticateToken, async (req, res) => {
  try {
    if (await isTeamModeRequest(req)) {
      return sendTeamModePersonalLock(res);
    }

    const userId = req.user?.id;
    const popup = String(req.query.popup || '').toLowerCase() === 'true';
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
      userId,
      popup
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

    console.log('[OAuth1 Connect] Initiating OAuth 1.0a team connection:', { teamId, userId });

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
    console.log('[OAuth1 Connect] Request token response:', responseText);

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

    console.log('[OAuth1 Connect] Token stored temporarily:', { oauthToken, teamId, userId });

    // Clean up after 5 minutes
    setTimeout(() => {
      if (global.oauth1TempTokens) {
        global.oauth1TempTokens.delete(oauthToken);
        console.log('[OAuth1 Connect] Cleaned up expired token:', oauthToken);
      }
    }, 5 * 60 * 1000);

    // Step 2: Redirect to Twitter
    const authURL = `https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`;
    
    console.log('[OAuth1 Connect] Redirecting to Twitter:', authURL);
    res.redirect(authURL);
  } catch (error) {
    console.error('[OAuth1 Connect] OAuth 1.0a team connect error:', error);
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

    // Get all Twitter accounts for this team from team_accounts table
    const accountsResult = await pool.query(`
      SELECT 
        id,
        twitter_user_id,
        twitter_username,
        twitter_display_name,
        twitter_profile_image_url,
        followers_count,
        following_count,
        tweet_count,
        verified,
        created_at,
        updated_at,
        oauth1_access_token IS NOT NULL AND oauth1_access_token_secret IS NOT NULL as has_oauth1,
        access_token IS NOT NULL as has_oauth2
      FROM team_accounts 
      WHERE team_id = $1 AND active = true
      ORDER BY created_at ASC
    `, [testTeamId]);

    const accounts = accountsResult.rows.map(account => ({
      id: account.id,
      twitter_user_id: account.twitter_user_id,
      username: account.twitter_username,
      display_name: account.twitter_display_name,
      profile_image_url: account.twitter_profile_image_url,
      followers_count: account.followers_count,
      following_count: account.following_count,
      tweet_count: account.tweet_count,
      verified: account.verified,
      has_oauth1: account.has_oauth1,
      has_oauth2: account.has_oauth2,
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
  console.log('[PROFILE] /api/twitter/user/profile called');
  if (!req.user) {
    console.log('[PROFILE] Not authenticated');
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  console.log('[PROFILE] Authenticated user:', {
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

    twitterDebug('[TEAM-ACCOUNTS] Fetching team Twitter accounts for user:', userId);

    const authActiveTeamIds = getActiveTeamIdsFromUserPayload(req.user);
    const normalizedAuthTeamIds = Array.isArray(authActiveTeamIds)
      ? Array.from(new Set(authActiveTeamIds.map((id) => String(id || '').trim()).filter(Boolean)))
      : [];

    // Always validate against DB so leave/re-invite state reflects immediately.
    const teamResult = normalizedAuthTeamIds.length > 0
      ? await newPlatformPool.query(
          `SELECT team_id
           FROM team_members
           WHERE user_id = $1
             AND status = 'active'
             AND team_id::text = ANY($2::text[])
           ORDER BY team_id ASC
           LIMIT 1`,
          [userId, normalizedAuthTeamIds]
        )
      : await newPlatformPool.query(
          `SELECT team_id
           FROM team_members
           WHERE user_id = $1
             AND status = 'active'
           ORDER BY team_id ASC
           LIMIT 1`,
          [userId]
        );

    twitterDebug('[TEAM-ACCOUNTS] Team query result for user', userId, ':', teamResult.rows);
    const teamId = teamResult.rows[0]?.team_id || null;

    if (!teamId) {
      twitterDebug('[TEAM-ACCOUNTS] User', userId, 'is not in any active team');
      return res.json({ accounts: [] });
    }

    twitterDebug('[TEAM-ACCOUNTS] User', userId, 'is in team', teamId);

    // Get Twitter accounts from user_social_accounts (OAuth1)
    const oauth1AccountsResult = await newPlatformPool.query(`
      SELECT 
        id,
        user_id,
        account_id,
        account_username,
        account_display_name,
        profile_image_url,
        created_at,
        updated_at,
        oauth1_access_token IS NOT NULL AND oauth1_access_token_secret IS NOT NULL as has_oauth1
      FROM user_social_accounts 
      WHERE team_id = $1
        AND platform = 'twitter'
        AND is_active = true
      ORDER BY
        CASE WHEN user_id = $2 THEN 0 ELSE 1 END,
        created_at ASC
    `, [teamId, userId]);

    twitterDebug('[TEAM-ACCOUNTS] OAuth1 accounts found:', oauth1AccountsResult.rows.length);

    const oauth1Accounts = oauth1AccountsResult.rows.map(account => ({
      id: account.id,
      team_id: teamId,
      twitter_user_id: account.account_id,
      username: account.account_username,
      display_name: account.account_display_name,
      profile_image_url: account.profile_image_url,
      has_oauth1: account.has_oauth1,
      created_at: account.created_at,
      updated_at: account.updated_at,
      connected_by_user_id: account.user_id,
      type: 'oauth1'
    }));

    // ⭐ FIX: Get Twitter accounts from team_accounts with OAuth status
    const oauth2AccountsResult = await pool.query(`
      SELECT 
        id,
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
        updated_at,
        oauth1_access_token IS NOT NULL AND oauth1_access_token_secret IS NOT NULL as has_oauth1,
        access_token IS NOT NULL as has_oauth2
      FROM team_accounts
      WHERE team_id = $1
        AND active = true
      ORDER BY
        CASE WHEN user_id = $2 THEN 0 ELSE 1 END,
        updated_at DESC
    `, [teamId, userId]);

    twitterDebug('[TEAM-ACCOUNTS] Team accounts found:', oauth2AccountsResult.rows.length);

    const oauth2Accounts = oauth2AccountsResult.rows.map(account => ({
      id: account.id,
      team_id: account.team_id || teamId,
      twitter_user_id: account.twitter_user_id,
      username: account.twitter_username,
      display_name: account.twitter_display_name,
      profile_image_url: account.twitter_profile_image_url,
      followers_count: account.followers_count,
      following_count: account.following_count,
      tweet_count: account.tweet_count,
      verified: account.verified,
      has_oauth1: account.has_oauth1,  // ⭐ FIXED: Now reads from database
      has_oauth2: account.has_oauth2,  // ⭐ ADDED: OAuth2 status
      created_at: null,
      updated_at: account.updated_at,
      connected_by_user_id: account.user_id,
      type: 'team'
    }));

    // Merge both account types
    const accounts = [...oauth1Accounts, ...oauth2Accounts];

    twitterDebug(`[TEAM-ACCOUNTS] Response for team ${teamId}:`, JSON.stringify(accounts, null, 2));
    res.json({ 
      success: true,
      accounts,
      team_id: teamId
    });
  } catch (error) {
    twitterDebug('[TEAM-ACCOUNTS] Failed to fetch team Twitter accounts (detail):', error);
    console.error('[TEAM-ACCOUNTS] Failed to fetch team Twitter accounts:', error?.message || error);
    res.status(500).json({ error: 'Failed to fetch team accounts' });
  }
});

// GET /api/twitter/token-status - Check Twitter token expiration status
router.get('/token-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const requestTeamId = await resolveValidatedRequestTeamId(req);
    const selectedAccountId = req.headers['x-selected-account-id'];
    
    twitterDebug('[token-status] Checking for user:', userId, 'team:', requestTeamId, 'account:', selectedAccountId);
    
    let tokenData = null;
    
    // Team scope applies via explicit header or authenticated team membership.
    if (requestTeamId && !selectedAccountId) {
      return res.json({
        connected: false,
        requiresTeamAccountSelection: true,
        error: 'Team account selection required. Please select a team Twitter account.',
        code: 'TEAM_ACCOUNT_SELECTION_REQUIRED',
      });
    }

    if (selectedAccountId && requestTeamId) {
      const { rows: teamRows } = await pool.query(
        `SELECT ta.id, ta.twitter_user_id, ta.access_token, ta.refresh_token,
                ta.token_expires_at, ta.oauth1_access_token, ta.oauth1_access_token_secret
         FROM team_accounts ta
         INNER JOIN team_members tm
           ON tm.team_id = ta.team_id
          AND tm.user_id = $3
          AND tm.status = 'active'
         WHERE ta.id::text = $1::text
           AND ta.team_id::text = $2::text
         LIMIT 1`,
        [selectedAccountId, requestTeamId, userId]
      );
      if (teamRows.length > 0) {
        tokenData = teamRows[0];
        twitterDebug('[token-status] Team account found:', {
          hasOAuth1: !!tokenData.oauth1_access_token,
          expiresAt: tokenData.token_expires_at 
        });
      }
    } else if (!requestTeamId) {
      // Personal scope only.
      if (selectedAccountId) {
        tokenData = await fetchPersonalTwitterAuthById(pool, userId, selectedAccountId, {
          columns: 'id, twitter_user_id, access_token, refresh_token, token_expires_at, oauth1_access_token, oauth1_access_token_secret',
        });
      }
      if (!tokenData) {
        tokenData = await fetchLatestPersonalTwitterAuth(pool, userId, {
          columns: 'id, twitter_user_id, access_token, refresh_token, token_expires_at, oauth1_access_token, oauth1_access_token_secret',
        });
      }
      if (tokenData) {
        twitterDebug('[token-status] Personal account found:', {
          accountId: tokenData.id || null,
          hasOAuth1: !!tokenData.oauth1_access_token,
          expiresAt: tokenData.token_expires_at 
        });
      }
    }
    
    if (!tokenData) {
      twitterDebug('[token-status] No token data found - not connected');
      return res.json({ connected: false });
    }

    let resolvedAccount = tokenData;
    try {
      const readyResult = await ensureTwitterAccountReady({
        dbPool: pool,
        account: tokenData,
        accountType: requestTeamId ? 'team' : 'personal',
        reason: 'token-status',
        onLog: (...args) => twitterDebug(...args),
      });
      resolvedAccount = readyResult.account;
    } catch (error) {
      if (error instanceof TwitterReconnectRequiredError) {
        return res.json({
          connected: false,
          requiresReconnect: true,
          reason: error.reason,
          error: error.details || 'Twitter reconnect required.',
        });
      }
      throw error;
    }

    const statusInfo = getTwitterConnectionStatus(resolvedAccount);
    res.json({
      connected: statusInfo.postingCapable,
      expiresAt: statusInfo.expiresAtIso,
      minutesUntilExpiry: statusInfo.minutesUntilExpiry,
      isExpired: statusInfo.isExpired,
      needsRefresh: statusInfo.needsRefresh,
      isOAuth1: statusInfo.hasOauth1,
      hasOAuth1: statusInfo.hasOauth1,
      hasOAuth2: statusInfo.hasOauth2,
      mediaReady: statusInfo.mediaCapable,
      postingReady: statusInfo.postingCapable,
    });
  } catch (error) {
    twitterDebug('[token-status] Failed to check token status (detail):', error);
    console.error('Failed to check token status:', error?.message || error);
    res.status(500).json({ error: 'Failed to check token status' });
  }
});

export default router;
