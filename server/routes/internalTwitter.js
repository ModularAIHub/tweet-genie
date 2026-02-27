import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import { pool } from '../config/database.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { mediaService } from '../services/mediaService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const TWITTER_OAUTH1_APP_KEY = process.env.TWITTER_API_KEY || process.env.TWITTER_CONSUMER_KEY || null;
const TWITTER_OAUTH1_APP_SECRET = process.env.TWITTER_API_SECRET || process.env.TWITTER_CONSUMER_SECRET || null;
const INTERNAL_CROSSPOST_MAX_MEDIA_ITEMS = 4;
const INTERNAL_CROSSPOST_REMOTE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const ensureInternalRequest = (req, res, next) => {
  const configuredKey = String(process.env.INTERNAL_API_KEY || '').trim();
  const providedKey = String(req.headers['x-internal-api-key'] || '').trim();

  if (!configuredKey) {
    return res.status(503).json({
      error: 'Internal API key is not configured',
      code: 'INTERNAL_API_KEY_NOT_CONFIGURED',
    });
  }

  if (!providedKey || providedKey !== configuredKey) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'INTERNAL_AUTH_FAILED',
    });
  }

  req.isInternal = true;
  next();
};

const resolvePlatformUserId = (req) => String(req.headers['x-platform-user-id'] || '').trim();
const resolvePlatformTeamId = (req) => String(req.headers['x-platform-team-id'] || '').trim();

const getPersonalTwitterAccount = async (platformUserId) => {
  if (!platformUserId) return null;
  const { rows } = await pool.query(
    `SELECT id, user_id, twitter_user_id, twitter_username, access_token, refresh_token, token_expires_at,
            oauth1_access_token, oauth1_access_token_secret
     FROM twitter_auth
     WHERE user_id = $1
     LIMIT 1`,
    [platformUserId]
  );
  return rows[0] || null;
};

const getPersonalTwitterAccountById = async (platformUserId, targetAccountId) => {
  if (!platformUserId || !targetAccountId) return null;
  const { rows } = await pool.query(
    `SELECT id, user_id, twitter_user_id, twitter_username, access_token, refresh_token, token_expires_at,
            oauth1_access_token, oauth1_access_token_secret
     FROM twitter_auth
     WHERE user_id = $1
       AND id::text = $2::text
     LIMIT 1`,
    [platformUserId, String(targetAccountId)]
  );
  return rows[0] || null;
};

const getTeamTwitterAccountForMember = async (platformUserId, platformTeamId) => {
  if (!platformUserId || !platformTeamId) return null;

  const { rows } = await pool.query(
    `SELECT ta.id, ta.team_id, ta.user_id, ta.twitter_user_id, ta.twitter_username,
            ta.access_token, ta.refresh_token, ta.token_expires_at,
            ta.oauth1_access_token, ta.oauth1_access_token_secret
     FROM team_accounts ta
     INNER JOIN team_members tm
       ON tm.team_id = ta.team_id
      AND tm.user_id = $1
      AND tm.status = 'active'
     WHERE ta.team_id::text = $2::text
       AND ta.active = true
     ORDER BY
       CASE WHEN ta.user_id = $1 THEN 0 ELSE 1 END,
       ta.updated_at DESC NULLS LAST,
       ta.id DESC
     LIMIT 1`,
    [platformUserId, platformTeamId]
  );

  return rows[0] || null;
};

const getTeamTwitterAccountForMemberById = async (platformUserId, platformTeamId, targetAccountId) => {
  if (!platformUserId || !platformTeamId || !targetAccountId) return null;

  const { rows } = await pool.query(
    `SELECT ta.id, ta.team_id, ta.user_id, ta.twitter_user_id, ta.twitter_username,
            ta.access_token, ta.refresh_token, ta.token_expires_at,
            ta.oauth1_access_token, ta.oauth1_access_token_secret
     FROM team_accounts ta
     INNER JOIN team_members tm
       ON tm.team_id = ta.team_id
      AND tm.user_id = $1
      AND tm.status = 'active'
     WHERE ta.team_id::text = $2::text
       AND ta.id::text = $3::text
       AND ta.active = true
     LIMIT 1`,
    [platformUserId, platformTeamId, String(targetAccountId)]
  );

  return rows[0] || null;
};

const isTokenExpired = (tokenExpiresAt) => {
  if (!tokenExpiresAt) return false;
  const expiresMs = new Date(tokenExpiresAt).getTime();
  return Number.isFinite(expiresMs) && expiresMs <= Date.now();
};

const trimText = (value, maxLength = 5000) => String(value || '').trim().slice(0, maxLength);

const normalizeCrossPostMediaInputs = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, INTERNAL_CROSSPOST_MAX_MEDIA_ITEMS);
};

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const fetchRemoteMediaAsDataUrl = async (value) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(String(value || '').trim(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > INTERNAL_CROSSPOST_REMOTE_MEDIA_MAX_BYTES) {
      throw new Error(`Remote media too large (${buffer.length} bytes)`);
    }
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } finally {
    clearTimeout(timeoutId);
  }
};

const resolveUploadableCrossPostMedia = async (mediaInputs = [], { userId, teamId } = {}) => {
  const normalized = normalizeCrossPostMediaInputs(mediaInputs);
  if (!normalized.length) {
    return { uploadable: [], skippedCount: 0, hadErrors: false, requestedCount: 0 };
  }

  // Resolve all items in parallel — remote fetches and data URL passthrough run simultaneously
  const results = await Promise.allSettled(
    normalized.map(async (item, index) => {
      if (item.startsWith('data:image/')) {
        return { item, skipped: false };
      }
      if (isHttpUrl(item)) {
        const dataUrl = await fetchRemoteMediaAsDataUrl(item);
        return { item: dataUrl, skipped: false };
      }
      return { item: null, skipped: true };
    })
  );

  const uploadable = [];
  let skippedCount = 0;
  let hadErrors = false;

  for (let index = 0; index < results.length; index++) {
    const settlement = results[index];
    if (settlement.status === 'rejected') {
      hadErrors = true;
      skippedCount += 1;
      logger.warn('[internal/twitter/cross-post] Skipping one media item', {
        userId,
        teamId: teamId || null,
        index,
        error: settlement.reason?.message || String(settlement.reason),
      });
      continue;
    }
    const { item, skipped } = settlement.value;
    if (skipped || !item) {
      skippedCount += 1;
    } else {
      uploadable.push(item);
    }
  }

  return { uploadable, skippedCount, hadErrors, requestedCount: normalized.length };
};

const hasOauth1Credentials = (account) =>
  Boolean(account?.oauth1_access_token && account?.oauth1_access_token_secret);

const createTwitterClientForPosting = (account) => {
  if (hasOauth1Credentials(account)) {
    if (TWITTER_OAUTH1_APP_KEY && TWITTER_OAUTH1_APP_SECRET) {
      return new TwitterApi({
        appKey: TWITTER_OAUTH1_APP_KEY,
        appSecret: TWITTER_OAUTH1_APP_SECRET,
        accessToken: account.oauth1_access_token,
        accessSecret: account.oauth1_access_token_secret,
      });
    }
  }

  if (account?.access_token) {
    return new TwitterApi(account.access_token);
  }

  throw new Error('No valid Twitter credentials found');
};

const runValidateTwitterConnection = async (platformUserId) => {
  const mockReq = {
    user: { id: platformUserId },
    headers: {},
  };

  return new Promise((resolve, reject) => {
    let statusCode = 500;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        const error = new Error(payload?.error || 'Twitter validation failed');
        error.status = statusCode;
        error.payload = payload || null;
        reject(error);
        return this;
      },
    };

    validateTwitterConnection(mockReq, mockRes, () => resolve(mockReq));
  });
};

/**
 * Posts an X thread by chaining replies.
 * First part is a normal tweet; each subsequent part replies to the previous.
 * Returns { firstTweetId, firstTweetUrl, tweetIds[] }
 */
const postXThread = async (twitterClient, parts, username, mediaIds = []) => {
  if (!parts || parts.length === 0) throw new Error('No thread parts provided');

  const tweetIds = [];

  // Post first tweet (optionally with media on the first tweet only)
  const firstPayload = {
    text: parts[0],
    ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
  };
  const firstResponse = await twitterClient.v2.tweet(firstPayload);
  const firstTweetId = firstResponse?.data?.id;
  if (!firstTweetId) throw new Error('Failed to get tweet ID from first thread part');
  tweetIds.push(firstTweetId);

  let lastTweetId = firstTweetId;

  // Chain remaining parts as replies
  for (let i = 1; i < parts.length; i++) {
    const replyResponse = await twitterClient.v2.tweet({
      text: parts[i],
      reply: { in_reply_to_tweet_id: lastTweetId },
    });
    const replyId = replyResponse?.data?.id;
    if (!replyId) {
      logger.warn('[internal/twitter/cross-post] Thread part missing tweet ID, stopping chain', {
        partIndex: i,
        lastTweetId,
      });
      break;
    }
    tweetIds.push(replyId);
    lastTweetId = replyId;
  }

  const safeUsername = username || 'i/web';
  const firstTweetUrl = `https://twitter.com/${safeUsername}/status/${firstTweetId}`;

  return { firstTweetId, firstTweetUrl, tweetIds };
};

router.get('/status', ensureInternalRequest, async (req, res) => {
  const platformUserId = resolvePlatformUserId(req);

  if (!platformUserId) {
    return res.status(400).json({
      connected: false,
      reason: 'missing_platform_user_id',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    const validatedReq = await runValidateTwitterConnection(platformUserId);
    const account = validatedReq?.twitterAccount || null;

    return res.json({
      connected: true,
      account: {
        id: account.id,
        twitter_user_id: account.twitter_user_id || null,
        username: account.twitter_username || null,
      },
    });
  } catch (error) {
    const reconnectReason = String(error?.payload?.reason || '').toLowerCase();
    if (error?.payload?.code === 'TWITTER_RECONNECT_REQUIRED') {
      return res.json({
        connected: false,
        reason: reconnectReason.includes('token') ? 'token_expired' : 'not_connected',
        code: reconnectReason.includes('token') ? 'TWITTER_TOKEN_EXPIRED' : 'TWITTER_NOT_CONNECTED',
      });
    }

    logger.error('[internal/twitter/status] Failed to resolve status', {
      userId: platformUserId,
      error: error?.message || String(error),
    });

    return res.status(500).json({
      connected: false,
      reason: 'internal_error',
      code: 'TWITTER_STATUS_FAILED',
    });
  }
});

router.get('/targets', ensureInternalRequest, async (req, res) => {
  const platformUserId = resolvePlatformUserId(req);
  const platformTeamId = resolvePlatformTeamId(req) || null;
  const excludeAccountId = String(req.query?.excludeAccountId || '').trim() || null;

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    let rows = [];
    if (platformTeamId) {
      const result = await pool.query(
        `SELECT ta.id, ta.twitter_user_id, ta.twitter_username, ta.twitter_display_name, ta.twitter_profile_image_url
         FROM team_accounts ta
         INNER JOIN team_members tm
           ON tm.team_id = ta.team_id
          AND tm.user_id = $1
          AND tm.status = 'active'
         WHERE ta.team_id::text = $2::text
           AND ta.active = true
         ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC`,
        [platformUserId, platformTeamId]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT id, twitter_user_id, twitter_username, twitter_display_name, twitter_profile_image_url
         FROM twitter_auth
         WHERE user_id = $1
         ORDER BY updated_at DESC NULLS LAST, id DESC`,
        [platformUserId]
      );
      rows = result.rows;
    }

    const accounts = rows
      .map((row) => ({
        id: row?.id !== undefined && row?.id !== null ? String(row.id) : null,
        platform: 'twitter',
        accountId: row?.twitter_user_id ? String(row.twitter_user_id) : null,
        username: row?.twitter_username ? String(row.twitter_username) : null,
        displayName:
          String(row?.twitter_display_name || '').trim() ||
          (row?.twitter_username ? `@${String(row.twitter_username)}` : 'X account'),
        avatar: row?.twitter_profile_image_url || null,
      }))
      .filter((row) => row.id && row.id !== String(excludeAccountId || ''));

    return res.json({ success: true, accounts });
  } catch (error) {
    logger.error('[internal/twitter/targets] Failed to list targets', {
      userId: platformUserId,
      teamId: platformTeamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to fetch Twitter targets',
      code: 'TWITTER_TARGETS_FAILED',
    });
  }
});

router.post('/cross-post', ensureInternalRequest, async (req, res) => {
  const platformUserId = resolvePlatformUserId(req);
  const platformTeamId = resolvePlatformTeamId(req);
  const {
    content = '',
    mediaDetected = false,
    postMode = 'single',
    threadParts = [],
    media = [],
    mediaUrls = [],
    targetAccountId = null,
  } = req.body || {};

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  const normalizedMode = String(postMode || 'single').toLowerCase();
  const isThreadMode = normalizedMode === 'thread';

  // Resolve which parts to post
  const normalizedThreadParts = isThreadMode
    ? (Array.isArray(threadParts) ? threadParts : []).map((p) => trimText(p, 280)).filter(Boolean)
    : [];

  // Validate content
  const normalizedContent = trimText(content, isThreadMode ? 280 : 1000);
  if (!normalizedContent && normalizedThreadParts.length === 0) {
    return res.status(400).json({
      error: 'content is required',
      code: 'TWITTER_CONTENT_REQUIRED',
    });
  }

  // Single mode length guard
  if (!isThreadMode && normalizedContent.length > 280) {
    return res.status(400).json({
      error: 'X post exceeds 280 characters',
      code: 'X_POST_TOO_LONG',
      length: normalizedContent.length,
    });
  }

  // Thread mode needs at least 1 part
  if (isThreadMode && normalizedThreadParts.length === 0) {
    return res.status(400).json({
      error: 'threadParts is required for thread mode',
      code: 'TWITTER_THREAD_PARTS_REQUIRED',
    });
  }

  try {
    let account = null;
    let accountScope = 'personal';

    if (targetAccountId) {
      if (platformTeamId) {
        account = await getTeamTwitterAccountForMemberById(platformUserId, platformTeamId, targetAccountId);
        if (account) accountScope = 'team';
      } else {
        account = await getPersonalTwitterAccountById(platformUserId, targetAccountId);
        if (account) accountScope = 'personal';
      }

      if (!account) {
        return res.status(404).json({
          error: 'Target Twitter account not found or inaccessible',
          code: 'TWITTER_TARGET_ACCOUNT_NOT_FOUND',
        });
      }
    } else {
      if (platformTeamId) {
        account = await getTeamTwitterAccountForMember(platformUserId, platformTeamId);
        if (account) accountScope = 'team';
      }

      if (!account) {
        const validatedReq = await runValidateTwitterConnection(platformUserId);
        account = validatedReq?.twitterAccount;
        accountScope = 'personal';
      }
    }

    if (!account) {
      return res.status(404).json({
        error: 'Twitter account not connected',
        code: 'TWITTER_NOT_CONNECTED',
      });
    }

    if (isTokenExpired(account.token_expires_at) && !hasOauth1Credentials(account)) {
      return res.status(401).json({
        error: 'Twitter token expired',
        code: 'TWITTER_TOKEN_EXPIRED',
      });
    }

    const twitterClient = createTwitterClientForPosting(account);
    const username = account.twitter_username || 'i/web';

    // --- Media handling (first tweet only for threads) ---
    const incomingMedia = normalizeCrossPostMediaInputs(
      Array.isArray(media) && media.length > 0 ? media : mediaUrls
    );
    const effectiveMediaDetected = Boolean(mediaDetected) || incomingMedia.length > 0;
    let mediaStatus = incomingMedia.length > 0 ? 'text_only_unsupported' : 'none';
    let mediaCount = 0;
    let tweetMediaIds = [];

    if (incomingMedia.length > 0) {
      const hasOauth1 = hasOauth1Credentials(account) && Boolean(TWITTER_OAUTH1_APP_KEY && TWITTER_OAUTH1_APP_SECRET);
      if (!hasOauth1) {
        mediaStatus = 'text_only_requires_oauth1';
      } else {
        const preparedMedia = await resolveUploadableCrossPostMedia(incomingMedia, {
          userId: platformUserId,
          teamId: platformTeamId || null,
        });

        if (preparedMedia.uploadable.length === 0) {
          mediaStatus = preparedMedia.hadErrors ? 'text_only_upload_failed' : 'text_only_unsupported';
        } else {
          try {
            tweetMediaIds = await mediaService.uploadMedia(preparedMedia.uploadable, twitterClient, {
              accessToken: account.oauth1_access_token,
              accessTokenSecret: account.oauth1_access_token_secret,
            });
            mediaCount = Array.isArray(tweetMediaIds) ? tweetMediaIds.length : 0;
            mediaStatus =
              preparedMedia.skippedCount > 0 ? 'posted_partial' : (mediaCount > 0 ? 'posted' : 'text_only_upload_failed');
          } catch (uploadError) {
            logger.warn('[internal/twitter/cross-post] Media upload failed, falling back to text-only', {
              userId: platformUserId,
              teamId: platformTeamId || null,
              error: uploadError?.message || String(uploadError),
            });
            mediaStatus = 'text_only_upload_failed';
            mediaCount = 0;
            tweetMediaIds = [];
          }
        }
      }
    }

    // --- Post: thread or single ---
    if (isThreadMode) {
      const { firstTweetId, firstTweetUrl, tweetIds } = await postXThread(
        twitterClient,
        normalizedThreadParts,
        username,
        tweetMediaIds
      );

      logger.info('[internal/twitter/cross-post] Posted X thread', {
        userId: platformUserId,
        teamId: platformTeamId || null,
        accountScope,
        firstTweetId,
        partCount: tweetIds.length,
        mediaStatus,
        mediaCount,
      });

      return res.json({
        success: true,
        status: 'posted',
        mode: 'thread',
        partCount: tweetIds.length,
        tweetId: firstTweetId,
        tweetUrl: firstTweetUrl,
        tweetIds,
        mediaDetected: Boolean(effectiveMediaDetected),
        mediaStatus,
        mediaCount,
      });

    } else {
      // Single tweet
      const tweetResponse = await twitterClient.v2.tweet({
        text: normalizedContent,
        ...(tweetMediaIds.length > 0 ? { media: { media_ids: tweetMediaIds } } : {}),
      });
      const tweetId = tweetResponse?.data?.id || null;
      const tweetUrl = tweetId ? `https://twitter.com/${username}/status/${tweetId}` : null;

      logger.info('[internal/twitter/cross-post] Posted to X', {
        userId: platformUserId,
        teamId: platformTeamId || null,
        accountScope,
        tweetId,
        mediaDetected: Boolean(effectiveMediaDetected),
        mediaStatus,
        mediaCount,
        length: normalizedContent.length,
      });

      return res.json({
        success: true,
        status: 'posted',
        mode: 'single',
        mediaDetected: Boolean(effectiveMediaDetected),
        tweetId,
        tweetUrl,
        mediaStatus,
        mediaCount,
      });
    }

  } catch (error) {
    if (error?.payload?.code === 'TWITTER_RECONNECT_REQUIRED') {
      const reconnectReason = String(error?.payload?.reason || '').toLowerCase();
      return res.status(reconnectReason.includes('token') ? 401 : 404).json({
        error: error?.payload?.error || 'Twitter account not connected',
        code: reconnectReason.includes('token') ? 'TWITTER_TOKEN_EXPIRED' : 'TWITTER_NOT_CONNECTED',
      });
    }

    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.code || 0);
    const message = String(error?.message || 'Failed to post to X');

    logger.error('[internal/twitter/cross-post] Failed to post to X', {
      userId: platformUserId,
      teamId: platformTeamId || null,
      error: message,
      code,
    });

    if (code.includes('AUTH') || code.includes('UNAUTHORIZED') || status === 401) {
      return res.status(401).json({ error: message, code: 'TWITTER_TOKEN_EXPIRED' });
    }

    return res.status(500).json({
      error: message,
      code: 'TWITTER_CROSSPOST_FAILED',
      mediaStatus: 'unknown',
    });
  }
});

router.post('/save-to-history', ensureInternalRequest, async (req, res) => {
  const platformUserId = resolvePlatformUserId(req);
  const platformTeamId = resolvePlatformTeamId(req);
  const {
    content = '',
    sourcePlatform = 'platform',
    tweetId = null,
    mediaDetected = false,
  } = req.body || {};

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  const normalizedContent = trimText(content, 5000);
  if (!normalizedContent) {
    return res.status(400).json({
      error: 'content is required',
      code: 'TWITTER_CONTENT_REQUIRED',
    });
  }

  try {
    const account =
      (platformTeamId ? await getTeamTwitterAccountForMember(platformUserId, platformTeamId) : null) ||
      await getPersonalTwitterAccount(platformUserId);
    const normalizedTweetId = String(tweetId || '').trim() || null;

    if (normalizedTweetId) {
      const { rows: existingRows } = await pool.query(
        `SELECT id
         FROM tweets
         WHERE user_id = $1
           AND tweet_id = $2
         LIMIT 1`,
        [platformUserId, normalizedTweetId]
      );
      if (existingRows.length > 0) {
        return res.json({
          success: true,
          status: 'already_exists',
          historyId: existingRows[0].id,
        });
      }
    }

    const safeSource = String(sourcePlatform || '').trim() || 'platform';
    const historyAccountId = platformTeamId ? account?.id || null : null;

    const { rows } = await pool.query(
      `INSERT INTO tweets (
        user_id,
        account_id,
        author_id,
        tweet_id,
        content,
        media_urls,
        thread_tweets,
        credits_used,
        is_thread,
        thread_count,
        impressions,
        likes,
        retweets,
        replies,
        status,
        source,
        posted_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 0, false, 1, 0, 0, 0, 0, 'posted', $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id`,
      [
        platformUserId,
        historyAccountId,
        account?.twitter_user_id || null,
        normalizedTweetId,
        normalizedContent,
        JSON.stringify([]),
        JSON.stringify([]),
        safeSource.length > 20 ? 'platform' : safeSource,
      ]
    );

    logger.info('[internal/twitter/save-to-history] Saved X cross-post to Tweet Genie history', {
      userId: platformUserId,
      teamId: platformTeamId || null,
      historyId: rows[0]?.id || null,
      tweetId: normalizedTweetId,
      mediaDetected: Boolean(mediaDetected),
      source: safeSource.length > 20 ? 'platform' : safeSource,
    });

    return res.json({
      success: true,
      status: 'saved',
      historyId: rows[0]?.id || null,
    });
  } catch (error) {
    logger.error('[internal/twitter/save-to-history] Error', {
      userId: platformUserId,
      teamId: platformTeamId || null,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to save to history',
      code: 'TWITTER_HISTORY_SAVE_FAILED',
    });
  }
});

export default router;
