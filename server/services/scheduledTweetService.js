import { pool } from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { creditService } from './creditService.js';
import { mediaService } from './mediaService.js';
import { decodeHTMLEntities } from '../utils/decodeHTMLEntities.js';
import { buildCrossPostPayloads, detectCrossPostMedia } from '../utils/crossPostOptimizer.js';

const THREAD_REPLY_DELAY_MS = Number.parseInt(process.env.SCHEDULED_THREAD_DELAY_MS || '600', 10);
const THREAD_REPLY_DELAY_JITTER_MS = Number.parseInt(process.env.SCHEDULED_THREAD_DELAY_JITTER_MS || '250', 10);
const SCHEDULED_THREAD_LARGE_SIZE_THRESHOLD = Number.parseInt(process.env.SCHEDULED_THREAD_LARGE_SIZE_THRESHOLD || '6', 10);
const SCHEDULED_RATE_LIMIT_MAX_RETRIES = Number.parseInt(process.env.SCHEDULED_RATE_LIMIT_MAX_RETRIES || '2', 10);
const SCHEDULED_RATE_LIMIT_WAIT_MS = Number.parseInt(process.env.SCHEDULED_RATE_LIMIT_WAIT_MS || '90000', 10);
const SCHEDULED_RATE_LIMIT_MAX_WAIT_MS = Number.parseInt(process.env.SCHEDULED_RATE_LIMIT_MAX_WAIT_MS || '600000', 10);
const SCHEDULED_PROCESSING_STUCK_MINUTES = Number.parseInt(
  process.env.SCHEDULED_PROCESSING_STUCK_MINUTES || '20',
  10
);
const SCHEDULED_DUE_BATCH_LIMIT = Number.parseInt(process.env.SCHEDULED_DUE_BATCH_LIMIT || '10', 10);
const SCHEDULED_DB_RETRY_MAX_ATTEMPTS = Number.parseInt(process.env.SCHEDULED_DB_RETRY_MAX_ATTEMPTS || '5', 10);
const MAX_SCHEDULING_WINDOW_DAYS = Number.parseInt(process.env.MAX_SCHEDULING_WINDOW_DAYS || '15', 10);
const TWITTER_OAUTH1_APP_KEY = process.env.TWITTER_API_KEY || process.env.TWITTER_CONSUMER_KEY || null;
const TWITTER_OAUTH1_APP_SECRET = process.env.TWITTER_API_SECRET || process.env.TWITTER_CONSUMER_SECRET || null;
const LINKEDIN_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.LINKEDIN_CROSSPOST_TIMEOUT_MS || '10000', 10);
const THREADS_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.THREADS_CROSSPOST_TIMEOUT_MS || '10000', 10);
const TWITTER_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.TWITTER_CROSSPOST_TIMEOUT_MS || '20000', 10);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let scheduledAccountIdColumnTypeCache = null;
let scheduledMetadataColumnExistsCache = null;

function isDateValue(value) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

async function refreshScheduledOAuth2TokenIfNeeded({ scheduledTweet, accountRow, accountType }) {
  if (!scheduledTweet?.access_token) {
    return;
  }

  if (!isDateValue(scheduledTweet.token_expires_at)) {
    return;
  }

  const tokenExpiry = new Date(scheduledTweet.token_expires_at);
  const now = new Date();
  const refreshThreshold = new Date(tokenExpiry.getTime() - (10 * 60 * 1000));
  const isExpired = tokenExpiry <= now;

  if (now < refreshThreshold && !isExpired) {
    return;
  }

  const minutesUntilExpiry = Math.floor((tokenExpiry - now) / (60 * 1000));
  console.log('[Scheduled Tweet] OAuth2 token refresh check', {
    scheduledTweetId: scheduledTweet.id,
    accountType,
    username: scheduledTweet.twitter_username,
    isExpired,
    minutesUntilExpiry,
    hasRefreshToken: !!scheduledTweet.refresh_token,
  });

  if (!scheduledTweet.refresh_token) {
    if (isExpired) {
      throw new Error('Twitter token expired and no refresh token is available. Please reconnect your Twitter account.');
    }
    return;
  }

  if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
    if (isExpired) {
      throw new Error('Twitter token expired and refresh is unavailable because TWITTER_CLIENT_ID/TWITTER_CLIENT_SECRET are missing.');
    }
    return;
  }

  try {
    const credentials = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString('base64');

    const refreshResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: scheduledTweet.refresh_token,
        client_id: process.env.TWITTER_CLIENT_ID,
      }),
    });

    const tokens = await refreshResponse.json();

    if (!tokens?.access_token) {
      const detail = tokens?.error_description || tokens?.error || 'Refresh token invalid or expired';
      if (isExpired) {
        throw new Error(`Twitter token refresh failed: ${detail}. Please reconnect your Twitter account.`);
      }
      console.warn('[Scheduled Tweet] OAuth2 refresh failed but current token still usable:', detail);
      return;
    }

    const newExpiresAt = new Date(Date.now() + ((tokens.expires_in || 7200) * 1000));
    if (accountType === 'team') {
      await pool.query(
        `UPDATE team_accounts
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [
          tokens.access_token,
          tokens.refresh_token || scheduledTweet.refresh_token,
          newExpiresAt,
          accountRow.id,
        ]
      );
    } else {
      await pool.query(
        `UPDATE twitter_auth
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4`,
        [
          tokens.access_token,
          tokens.refresh_token || scheduledTweet.refresh_token,
          newExpiresAt,
          scheduledTweet.user_id,
        ]
      );
    }

    scheduledTweet.access_token = tokens.access_token;
    scheduledTweet.refresh_token = tokens.refresh_token || scheduledTweet.refresh_token;
    scheduledTweet.token_expires_at = newExpiresAt;
    if (accountRow) {
      accountRow.access_token = scheduledTweet.access_token;
      accountRow.refresh_token = scheduledTweet.refresh_token;
      accountRow.token_expires_at = scheduledTweet.token_expires_at;
    }

    console.log('[Scheduled Tweet] OAuth2 token refreshed for scheduled posting', {
      scheduledTweetId: scheduledTweet.id,
      username: scheduledTweet.twitter_username,
      expiresAt: newExpiresAt.toISOString(),
    });
  } catch (error) {
    if (isExpired) {
      throw error;
    }
    console.warn('[Scheduled Tweet] OAuth2 refresh failed before expiry, continuing with current token:', error.message);
  }
}

function normalizeScheduledAccountId(rawAccountId, columnType) {
  if (rawAccountId === null || rawAccountId === undefined) {
    return null;
  }

  const value = String(rawAccountId).trim();
  if (!value) {
    return null;
  }

  if (columnType === 'integer') {
    return /^\d+$/.test(value) ? Number.parseInt(value, 10) : null;
  }

  if (columnType === 'uuid') {
    return UUID_PATTERN.test(value) ? value : null;
  }

  return value;
}

async function getScheduledAccountIdColumnType() {
  if (scheduledAccountIdColumnTypeCache) {
    return scheduledAccountIdColumnTypeCache;
  }

  try {
    const { rows } = await pool.query(
      `SELECT data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'scheduled_tweets'
         AND column_name = 'account_id'
       LIMIT 1`
    );
    const dataType = String(rows[0]?.data_type || rows[0]?.udt_name || '').toLowerCase();

    if (dataType === 'uuid') {
      scheduledAccountIdColumnTypeCache = 'uuid';
    } else if (['integer', 'bigint', 'smallint', 'int2', 'int4', 'int8'].includes(dataType)) {
      scheduledAccountIdColumnTypeCache = 'integer';
    } else {
      scheduledAccountIdColumnTypeCache = 'text';
    }
  } catch (error) {
    console.warn('[ScheduledTweetService] Failed to resolve scheduled_tweets.account_id type. Defaulting to text.', error.message);
    scheduledAccountIdColumnTypeCache = 'text';
  }

  return scheduledAccountIdColumnTypeCache;
}

async function hasScheduledMetadataColumn() {
  if (typeof scheduledMetadataColumnExistsCache === 'boolean') {
    return scheduledMetadataColumnExistsCache;
  }

  try {
    const { rows } = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'scheduled_tweets'
         AND column_name = 'metadata'
       LIMIT 1`
    );
    scheduledMetadataColumnExistsCache = rows.length > 0;
  } catch (error) {
    console.warn('[ScheduledTweetService] Failed to detect scheduled_tweets.metadata column:', error?.message || String(error));
    scheduledMetadataColumnExistsCache = false;
  }

  return scheduledMetadataColumnExistsCache;
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return { ...fallback };
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...fallback, ...value };
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...fallback, ...parsed };
      }
    } catch {
      return { ...fallback };
    }
  }
  return { ...fallback };
}

function parseJsonArrayLoose(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      const split = value.split(',').map((item) => item.trim()).filter(Boolean);
      return split;
    }
  }
  return [];
}

function normalizeCrossPostMediaArray(value) {
  return parseJsonArrayLoose(value)
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
}

function parseScheduledCrossPostConfig(scheduledTweet) {
  const metadata = parseJsonObject(scheduledTweet?.metadata, {});
  const crossPost = metadata?.cross_post;
  if (!crossPost || typeof crossPost !== 'object' || Array.isArray(crossPost)) {
    return { enabled: false, metadata };
  }

  const targets = crossPost?.targets && typeof crossPost.targets === 'object' ? crossPost.targets : {};
  const routing = crossPost?.routing && typeof crossPost.routing === 'object' ? crossPost.routing : {};
  const linkedinRoute =
    routing?.linkedin && typeof routing.linkedin === 'object' && !Array.isArray(routing.linkedin)
      ? routing.linkedin
      : null;
  const threadsRoute =
    routing?.threads && typeof routing.threads === 'object' && !Array.isArray(routing.threads)
      ? routing.threads
      : null;
  const twitterRoute =
    routing?.twitter && typeof routing.twitter === 'object' && !Array.isArray(routing.twitter)
      ? routing.twitter
      : null;
  const linkedin = Boolean(targets.linkedin);
  const threads = Boolean(targets.threads);
  const twitter = Boolean(targets.twitter);

  if (!linkedin && !threads && !twitter) {
    return { enabled: false, metadata };
  }

  return {
    enabled: true,
    metadata,
    config: {
      linkedin,
      threads,
      twitter,
      optimizeCrossPost: crossPost.optimizeCrossPost !== false,
      media: normalizeCrossPostMediaArray(crossPost.media),
      routing: {
        linkedinTargetAccountId:
          linkedinRoute?.targetAccountId !== undefined && linkedinRoute?.targetAccountId !== null
            ? String(linkedinRoute.targetAccountId).trim() || null
            : null,
        linkedinTargetLabel:
          linkedinRoute?.targetLabel !== undefined && linkedinRoute?.targetLabel !== null
            ? String(linkedinRoute.targetLabel).trim() || null
            : null,
        threadsTargetAccountId:
          threadsRoute?.targetAccountId !== undefined && threadsRoute?.targetAccountId !== null
            ? String(threadsRoute.targetAccountId).trim() || null
            : null,
        threadsTargetLabel:
          threadsRoute?.targetLabel !== undefined && threadsRoute?.targetLabel !== null
            ? String(threadsRoute.targetLabel).trim() || null
            : null,
        twitterTargetAccountId:
          twitterRoute?.targetAccountId !== undefined && twitterRoute?.targetAccountId !== null
            ? String(twitterRoute.targetAccountId).trim() || null
            : null,
        twitterTargetLabel:
          twitterRoute?.targetLabel !== undefined && twitterRoute?.targetLabel !== null
            ? String(twitterRoute.targetLabel).trim() || null
            : null,
      },
    },
  };
}

function buildScheduledCrossPostResultShape({
  linkedinEnabled = false,
  threadsEnabled = false,
  twitterEnabled = false,
  mediaDetected = false,
} = {}) {
  return {
    linkedin: {
      enabled: Boolean(linkedinEnabled),
      status: linkedinEnabled ? null : 'disabled',
      mediaDetected: Boolean(mediaDetected),
      mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
    },
    threads: {
      enabled: Boolean(threadsEnabled),
      status: threadsEnabled ? null : 'disabled',
      mediaDetected: Boolean(mediaDetected),
      mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
    },
    twitter: {
      enabled: Boolean(twitterEnabled),
      status: twitterEnabled ? null : 'disabled',
      mediaDetected: Boolean(mediaDetected),
      mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
    },
  };
}

function getTweetPermalink({ username, tweetId }) {
  const safeTweetId = String(tweetId || '').trim();
  const safeUsername = String(username || '').trim();
  if (!safeTweetId || !safeUsername) return '';
  return `https://twitter.com/${safeUsername}/status/${safeTweetId}`;
}

async function crossPostScheduledToLinkedIn({
  userId,
  teamId = null,
  targetLinkedinTeamAccountId = null,
  targetAccountId = null,
  content,
  tweetUrl,
  postMode = 'single',
  mediaDetected = false,
  media = [],
}) {
  const linkedinGenieUrl = String(process.env.LINKEDIN_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!linkedinGenieUrl || !internalApiKey) {
    return { status: 'skipped_not_configured' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LINKEDIN_CROSSPOST_TIMEOUT_MS);
    const res = await fetch(`${linkedinGenieUrl.replace(/\/$/, '')}/api/internal/cross-post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'tweet-genie',
        'x-platform-user-id': String(userId),
        ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
      },
      body: JSON.stringify({
        content,
        tweetUrl,
        sourcePlatform: 'x',
        postMode,
        mediaDetected: Boolean(mediaDetected),
        media: Array.isArray(media) ? media : [],
        ...(targetLinkedinTeamAccountId ? { targetLinkedinTeamAccountId: String(targetLinkedinTeamAccountId) } : {}),
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const body = await res.json().catch(() => ({}));
    if (res.status === 404 && body?.code === 'LINKEDIN_NOT_CONNECTED') return { status: 'not_connected' };
    if (res.status === 404 && body?.code === 'CROSSPOST_TARGET_ACCOUNT_NOT_FOUND') return { status: 'target_not_found' };
    if (res.status === 401 && body?.code === 'LINKEDIN_TOKEN_EXPIRED') return { status: 'not_connected' };
    if (res.status === 403 && body?.code === 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN') return { status: 'permission_revoked' };
    if (!res.ok) {
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }
    return {
      status: 'posted',
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'timeout' };
    return { status: 'failed' };
  }
}

async function crossPostScheduledToThreads({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  threadParts = [],
  postMode = 'single',
  tweetUrl = '',
  mediaDetected = false,
  optimizeCrossPost = true,
  media = [],
}) {
  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    return { status: 'skipped_not_configured' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), THREADS_CROSSPOST_TIMEOUT_MS);
    const res = await fetch(`${socialGenieUrl.replace(/\/$/, '')}/api/internal/threads/cross-post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'tweet-genie',
        'x-platform-user-id': String(userId),
        ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
      },
      body: JSON.stringify({
        postMode: postMode === 'thread' ? 'thread' : 'single',
        content,
        threadParts: Array.isArray(threadParts) ? threadParts : [],
        tweetUrl,
        sourcePlatform: 'x',
        optimizeCrossPost: optimizeCrossPost !== false,
        mediaDetected: Boolean(mediaDetected),
        media: Array.isArray(media) ? media : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const body = await res.json().catch(() => ({}));
    const code = String(body?.code || '').toUpperCase();
    if (!res.ok) {
      if (code === 'THREADS_NOT_CONNECTED' || code === 'THREADS_TOKEN_EXPIRED') return { status: 'not_connected' };
      if (code === 'THREADS_UNSUPPORTED_THREAD_MODE') return { status: 'unsupported_thread_mode' };
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }
    return {
      status: 'posted',
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'timeout' };
    return { status: 'failed' };
  }
}

async function crossPostScheduledToTwitterAccount({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  postMode = 'single',
  threadParts = [],
  mediaDetected = false,
  media = [],
}) {
  const tweetGenieUrl = String(process.env.TWEET_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    return { status: 'skipped_not_configured' };
  }
  if (!targetAccountId) {
    return { status: 'missing_target_route' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TWITTER_CROSSPOST_TIMEOUT_MS);
    const res = await fetch(`${tweetGenieUrl.replace(/\/$/, '')}/api/internal/twitter/cross-post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'tweet-genie',
        'x-platform-user-id': String(userId),
        ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
      },
      body: JSON.stringify({
        postMode: postMode === 'thread' ? 'thread' : 'single',
        content,
        threadParts: Array.isArray(threadParts) ? threadParts : [],
        mediaDetected: Boolean(mediaDetected),
        sourcePlatform: 'x',
        media: Array.isArray(media) ? media : [],
        targetAccountId: String(targetAccountId),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const body = await res.json().catch(() => ({}));
    const code = String(body?.code || '').toUpperCase();
    if (!res.ok) {
      if (code.includes('NOT_CONNECTED') || code.includes('TOKEN_EXPIRED')) return { status: 'not_connected' };
      if (code.includes('TARGET_ACCOUNT_NOT_FOUND') || code.includes('TARGET_ACCOUNT_FORBIDDEN')) {
        return { status: 'target_not_found' };
      }
      if (code === 'X_POST_TOO_LONG') return { status: 'failed_too_long' };
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }

    return {
      status: body?.status || 'posted',
      tweetId: body?.tweetId || null,
      tweetUrl: body?.tweetUrl || null,
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'timeout' };
    return { status: 'failed' };
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toUtcDbTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

function getScheduledThreadDelayMs() {
  const baseDelay = Number.isFinite(THREAD_REPLY_DELAY_MS) ? Math.max(0, THREAD_REPLY_DELAY_MS) : 600;
  const jitter = Number.isFinite(THREAD_REPLY_DELAY_JITTER_MS) ? Math.max(0, THREAD_REPLY_DELAY_JITTER_MS) : 250;
  if (!jitter) return baseDelay;
  return baseDelay + Math.floor(Math.random() * (jitter + 1));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHeaderValue(headers, headerName) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    return headers.get(headerName) ?? headers.get(headerName.toLowerCase());
  }
  return headers[headerName] ?? headers[headerName.toLowerCase()];
}

function isRateLimitedError(error) {
  const message = `${error?.message || ''} ${error?.data?.detail || ''}`.toLowerCase();
  return (
    error?.code === 429 ||
    error?.status === 429 ||
    error?.data?.status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes(' 429')
  );
}

function getRateLimitWaitMs(error, fallbackMs = SCHEDULED_RATE_LIMIT_WAIT_MS) {
  const headers = error?.headers || error?.response?.headers || null;
  const retryAfterRaw = Number(getHeaderValue(headers, 'retry-after'));
  if (Number.isFinite(retryAfterRaw) && retryAfterRaw > 0) {
    return Math.min(retryAfterRaw * 1000, SCHEDULED_RATE_LIMIT_MAX_WAIT_MS);
  }

  const resetRaw = Number(error?.rateLimit?.reset || getHeaderValue(headers, 'x-rate-limit-reset'));
  if (Number.isFinite(resetRaw) && resetRaw > 0) {
    const resetMs = Math.max(1000, resetRaw * 1000 - Date.now());
    return Math.min(resetMs, SCHEDULED_RATE_LIMIT_MAX_WAIT_MS);
  }

  const safeFallback = Number.isFinite(fallbackMs) && fallbackMs > 0 ? fallbackMs : 90000;
  return Math.min(safeFallback, SCHEDULED_RATE_LIMIT_MAX_WAIT_MS);
}

async function withRateLimitRetry(operation, { label, retries = SCHEDULED_RATE_LIMIT_MAX_RETRIES, fallbackWaitMs = SCHEDULED_RATE_LIMIT_WAIT_MS } = {}) {
  const maxRetries = Number.isFinite(retries) && retries >= 0 ? retries : 0;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitedError(error) || attempt >= maxRetries) {
        throw error;
      }

      const waitMs = getRateLimitWaitMs(error, fallbackWaitMs);
      console.warn(`[ScheduledRateLimit][${label || 'tweet'}] 429 on attempt ${attempt + 1}/${maxRetries + 1}. Waiting ${waitMs}ms before retry.`);
      await wait(waitMs);
    }
  }
}

function getAdaptiveScheduledThreadDelayMs({ index, totalParts, mediaCount = 0 }) {
  let delayMs = getScheduledThreadDelayMs();

  if (Number.isFinite(totalParts) && totalParts > SCHEDULED_THREAD_LARGE_SIZE_THRESHOLD) {
    delayMs += Math.min(3000, (totalParts - SCHEDULED_THREAD_LARGE_SIZE_THRESHOLD) * 300);
  }

  if (Number.isFinite(mediaCount) && mediaCount > 0) {
    delayMs += Math.min(2400, mediaCount * 450);
  }

  if (Number.isFinite(index) && index > 5) {
    delayMs += 350;
  }

  return Math.min(delayMs, SCHEDULED_RATE_LIMIT_MAX_WAIT_MS);
}


// Helper function to strip markdown formatting
function stripMarkdown(text) {
  if (!text) return text;

  let cleaned = text;

  // Remove bold: **text** or __text__
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');

  // Remove italic: *text* or _text_ (but not underscores in URLs or middle of words)
  cleaned = cleaned.replace(/\*([^*\s][^*]*[^*\s])\*/g, '$1');
  cleaned = cleaned.replace(/(?<!\w)_([^_\s][^_]*[^_\s])_(?!\w)/g, '$1');

  // Remove headers: # text, ## text, etc.
  cleaned = cleaned.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // Remove strikethrough: ~~text~~
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

  // Remove code blocks: `code` or ```code```
  cleaned = cleaned.replace(/```[^`]*```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  return cleaned.trim();
}


class ScheduledTweetService {
  /**
   * Fetch scheduled tweets for a user or team
   * @param {string} userId - User ID
   * @param {string} teamId - Team ID (optional)
   * @returns {Array} Array of scheduled tweets
   */
  async getScheduledTweets(userId, teamId = null) {
    try {
      let query, params;

      if (teamId) {
        // Fetch team scheduled tweets (visible to all team members)
        query = `
          SELECT st.*, 
                 ta.twitter_username as account_username,
                 u.email as scheduled_by_email,
                 u.name as scheduled_by_name
          FROM scheduled_tweets st
          LEFT JOIN team_accounts ta ON st.account_id::text = ta.id::text
          LEFT JOIN users u ON st.user_id = u.id
          WHERE st.team_id = $1 
          AND st.status IN ('pending', 'processing')
          ORDER BY st.scheduled_for ASC
        `;
        params = [teamId];
      } else {
        // Fetch personal scheduled tweets
        query = `
          SELECT st.*, ta.twitter_username
          FROM scheduled_tweets st
          JOIN twitter_auth ta ON st.user_id = ta.user_id
          WHERE st.user_id = $1 
          AND st.team_id IS NULL
          AND st.status IN ('pending', 'processing')
          ORDER BY st.scheduled_for ASC
        `;
        params = [userId];
      }

      const { rows } = await pool.query(query, params);
      return rows;
    } catch (error) {
      console.error('Error fetching scheduled tweets:', error);
      throw error;
    }
  }


  /**
   * Schedule a tweet or thread for future posting.
   * @param {Object} params
   *   - userId: UUID of the user
   *   - tweets: array of tweet strings (for thread) or single tweet
   *   - options: { scheduledFor, timezone, mediaUrls, teamId, accountId, ... }
   * @returns {Object} { scheduledId, scheduledTime }
   */
  async scheduleTweets({ userId, tweets, options = {} }) {
    // Accepts: array of strings, array of objects, or mixed
    if (!userId || !Array.isArray(tweets)) {
      throw new Error('Missing userId or tweets for scheduling');
    }


    // Flatten and sanitize tweets: allow [{content: "..."}, "..."] or ["..."]
    let flatTweets = tweets
      .map(t => (typeof t === 'string' ? t : (t && typeof t.content === 'string' ? t.content : '')))
      .map(t => (t || '').trim())
      .filter(t => t.length > 0);


    if (flatTweets.length === 0) {
      throw new Error('No valid tweets to schedule');
    }


    const scheduledForInput = options.scheduledFor || options.scheduled_for || new Date();
    const scheduledFor = toUtcDbTimestamp(scheduledForInput);
    if (!scheduledFor) {
      throw new Error('Invalid scheduledFor value for scheduling');
    }
    const scheduledForDate = scheduledForInput instanceof Date ? scheduledForInput : new Date(scheduledForInput);
    const maxScheduledAt = new Date(Date.now() + MAX_SCHEDULING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (scheduledForDate > maxScheduledAt) {
      throw new Error(`Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`);
    }
    const timezone = options.timezone || 'UTC';
    const mediaUrls = options.mediaUrls || options.media_urls || [];


    // Main tweet is first, rest are thread
    const mainContent = flatTweets[0];
    const threadTweets = flatTweets.length > 1 ? flatTweets.slice(1).map(content => ({ content })) : [];


    // Extract team_id and account_id from options
    const teamId = options.teamId || options.team_id || null;
    const accountId = options.accountId || options.account_id || null;
    const accountIdColumnType = await getScheduledAccountIdColumnType();
    const normalizedAccountId = normalizeScheduledAccountId(accountId, accountIdColumnType);
    const authorId = options.authorId || options.author_id || null;

    if (accountId && normalizedAccountId === null && accountIdColumnType !== 'text') {
      console.warn('[ScheduledTweetService] Dropping incompatible account_id for scheduled insert.', {
        accountId,
        accountIdColumnType,
      });
    }


    // Insert into scheduled_tweets with team_id and account_id
    const insertQuery = `
      INSERT INTO scheduled_tweets
        (user_id, scheduled_for, timezone, status, content, media_urls, thread_tweets, team_id, account_id, author_id, created_at, updated_at)
      VALUES
        ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, scheduled_for;
    `;
    const values = [
      userId,
      scheduledFor,
      timezone,
      mainContent,
      JSON.stringify(mediaUrls),
      JSON.stringify(threadTweets),
      teamId,
      normalizedAccountId,
      authorId
    ];


    const { rows } = await pool.query(insertQuery, values);
    return {
      scheduledId: rows[0].id,
      scheduledTime: rows[0].scheduled_for
    };
  }


  /**
   * For DB scheduler worker: process a scheduled tweet by its ID
   * @param {string} scheduledTweetId - Scheduled tweet ID
   */
  async processSingleScheduledTweetById(scheduledTweetId) {
    // Fetch the scheduled tweet and related info
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_tweets WHERE id = $1`,
      [scheduledTweetId]
    );
    if (!rows.length) {
      throw new Error(`Scheduled tweet not found: ${scheduledTweetId}`);
    }
    const scheduledTweet = rows[0];
    const normalizedStatus = String(scheduledTweet.status || '').toLowerCase();
    const approvalStatus = String(scheduledTweet.approval_status || '').toLowerCase();

    if (normalizedStatus !== 'pending' && normalizedStatus !== 'processing') {
      console.log(`[Scheduled Tweet] Skipping ${scheduledTweetId} because status is ${normalizedStatus}`);
      return { outcome: 'skipped', reason: 'status_not_processible', status: normalizedStatus };
    }

    if (approvalStatus && approvalStatus !== 'approved') {
      console.log(`[Scheduled Tweet] Skipping ${scheduledTweetId} because approval_status is ${approvalStatus}`);
      if (normalizedStatus === 'processing') {
        await pool.query(
          `UPDATE scheduled_tweets
           SET status = 'pending',
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [scheduledTweetId]
        );
      }
      return { outcome: 'skipped', reason: 'approval_pending', approvalStatus };
    }


    let accountRow = null;
    let accountType = 'personal';


    // ✅ FIXED: Get tokens from the correct table
    if (scheduledTweet.account_id) {
      // Team account - resolve by text to stay compatible with integer/uuid id schemas.
      const teamAccountRes = await pool.query(
        `SELECT id, twitter_user_id, twitter_username,
                access_token, refresh_token, token_expires_at,
                oauth1_access_token, oauth1_access_token_secret,
                active, team_id, user_id
         FROM team_accounts
         WHERE id::text = $1::text
           AND active = true
         LIMIT 1`,
        [scheduledTweet.account_id]
      );

      if (teamAccountRes.rows.length) {
        accountRow = teamAccountRes.rows[0];
        accountType = 'team';
        console.log(`[Scheduled Tweet] Using team account by account_id: ${accountRow.twitter_username}`);
      } else {
        console.warn(`[Scheduled Tweet] Team account not found by account_id=${scheduledTweet.account_id}. Trying team_id fallback.`);
      }
    }

    if (!accountRow && scheduledTweet.team_id) {
      // Fallback: find team account by team_id, preferring author_id match when available.
      const teamAccountRes = await pool.query(
        `SELECT id, twitter_user_id, twitter_username,
                access_token, refresh_token, token_expires_at,
                oauth1_access_token, oauth1_access_token_secret,
                active, team_id, user_id
         FROM team_accounts
         WHERE team_id = $1
           AND active = true
         ORDER BY
           CASE
             WHEN $2::text IS NOT NULL AND twitter_user_id = $2::text THEN 0
             ELSE 1
           END,
           updated_at DESC NULLS LAST,
           id DESC
         LIMIT 1`,
        [scheduledTweet.team_id, scheduledTweet.author_id || null]
      );
      if (!teamAccountRes.rows.length) {
        throw new Error(`No active Twitter account found for team: ${scheduledTweet.team_id}`);
      }
      accountRow = teamAccountRes.rows[0];
      accountType = 'team';
      console.log(`[Scheduled Tweet] Using team account (via team_id fallback): ${accountRow.twitter_username}`);
    }

    if (!accountRow) {
      // Personal account - use twitter_auth table
      console.log(`[Scheduled Tweet] User not in team, using personal account`);
      const personalRes = await pool.query(
        `SELECT * FROM twitter_auth WHERE user_id = $1`,
        [scheduledTweet.user_id]
      );
      if (!personalRes.rows.length) {
        throw new Error(`Personal twitter_auth not found for user: ${scheduledTweet.user_id}`);
      }
      accountRow = personalRes.rows[0];
      console.log(`[Scheduled Tweet] Using personal account: ${accountRow.twitter_username}`);
    }


    // ✅ Attach credentials to scheduledTweet object
    scheduledTweet.access_token = accountRow.access_token || null;
    scheduledTweet.refresh_token = accountRow.refresh_token || null;
    scheduledTweet.token_expires_at = accountRow.token_expires_at || null;
    scheduledTweet.twitter_username = accountRow.twitter_username;
    scheduledTweet.oauth1_access_token = accountRow.oauth1_access_token || null;
    scheduledTweet.oauth1_access_token_secret = accountRow.oauth1_access_token_secret || null;
    scheduledTweet.author_id = scheduledTweet.author_id || accountRow.twitter_user_id || null;
    scheduledTweet.isTeamAccount = accountType === 'team';
    console.log(`[Scheduled Tweet] Credentials attached:`, {
      hasOAuth2: !!scheduledTweet.access_token,
      hasOAuth1: !!(scheduledTweet.oauth1_access_token && scheduledTweet.oauth1_access_token_secret),
      username: scheduledTweet.twitter_username,
      accountType
    });

    await refreshScheduledOAuth2TokenIfNeeded({
      scheduledTweet,
      accountRow,
      accountType,
    });


    return this.processSingleScheduledTweet(scheduledTweet);
  }


  /**
   * Process all scheduled tweets that are due
   */
  async processScheduledTweets() {
    try {
      const stuckMinutes = Number.isFinite(SCHEDULED_PROCESSING_STUCK_MINUTES)
        ? Math.max(5, SCHEDULED_PROCESSING_STUCK_MINUTES)
        : 20;
      const batchLimit = Number.isFinite(SCHEDULED_DUE_BATCH_LIMIT) ? Math.max(1, SCHEDULED_DUE_BATCH_LIMIT) : 10;

      // Recover jobs that were stuck in "processing" (worker crash/network timeout).
      const { rows: recoveredRows } = await pool.query(
        `UPDATE scheduled_tweets
         SET status = 'pending',
             processing_started_at = NULL,
             error_message = CASE
               WHEN COALESCE(error_message, '') = '' THEN 'Recovered by scheduler watchdog after processing timeout.'
               ELSE error_message || ' | Recovered by scheduler watchdog after processing timeout.'
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'processing'
           AND updated_at < NOW() - ($1::int * INTERVAL '1 minute')
         RETURNING id`,
        [stuckMinutes]
      );
      if (recoveredRows.length > 0) {
        console.warn(`[ScheduledTweets] Recovered ${recoveredRows.length} stuck processing jobs.`);
      }

      // Process due tweets with per-account fairness (one due row per account each cycle).
      const { rows: scheduledTweets } = await pool.query(
        `WITH due AS (
           SELECT
             st.*,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(st.account_id::text, 'personal:' || st.user_id::text)
               ORDER BY st.scheduled_for ASC
             ) AS account_rank
           FROM scheduled_tweets st
           WHERE st.status = 'pending'
             AND st.scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
             AND (st.approval_status = 'approved' OR st.approval_status IS NULL)
         )
         SELECT *
         FROM due
         WHERE account_rank = 1
         ORDER BY scheduled_for ASC
         LIMIT $1`,
        [batchLimit]
      );


      for (const scheduledTweet of scheduledTweets) {
        await this.processSingleScheduledTweetById(scheduledTweet.id);
      }


      if (scheduledTweets.length > 0) {
        console.log(`Processed ${scheduledTweets.length} scheduled tweets`);
      }


    } catch (error) {
      console.error('Error processing scheduled tweets:', error);
    }
  }

  /**
   * Proactively refresh OAuth2 tokens for accounts with upcoming scheduled posts.
   * Reduces preventable failures for long-running schedules.
   */
  async refreshUpcomingScheduledTwitterTokens({
    horizonHours = 24,
    limitPerScope = 50,
  } = {}) {
    const safeHorizonHours = Number.isFinite(horizonHours) ? Math.max(1, Math.min(168, horizonHours)) : 24;
    const safeLimit = Number.isFinite(limitPerScope) ? Math.max(1, Math.min(500, limitPerScope)) : 50;

    const summary = {
      horizonHours: safeHorizonHours,
      checked: 0,
      refreshed: 0,
      errors: 0,
    };

    const personalQuery = `
      SELECT DISTINCT ON (ta.user_id)
             ta.id,
             ta.user_id,
             ta.twitter_username,
             ta.access_token,
             ta.refresh_token,
             ta.token_expires_at,
             ta.oauth1_access_token,
             ta.oauth1_access_token_secret
      FROM scheduled_tweets st
      INNER JOIN twitter_auth ta
        ON ta.user_id = st.user_id
      WHERE st.status = 'pending'
        AND st.team_id IS NULL
        AND (st.approval_status = 'approved' OR st.approval_status IS NULL)
        AND st.scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ($1::int * INTERVAL '1 hour')
      ORDER BY ta.user_id, st.scheduled_for ASC
      LIMIT $2
    `;

    const teamQuery = `
      SELECT DISTINCT ON (ta.id)
             ta.id,
             ta.user_id,
             ta.twitter_username,
             ta.access_token,
             ta.refresh_token,
             ta.token_expires_at,
             ta.oauth1_access_token,
             ta.oauth1_access_token_secret
      FROM scheduled_tweets st
      INNER JOIN team_accounts ta
        ON ta.id::text = st.account_id::text
      WHERE st.status = 'pending'
        AND st.team_id IS NOT NULL
        AND st.account_id IS NOT NULL
        AND ta.active = true
        AND (st.approval_status = 'approved' OR st.approval_status IS NULL)
        AND st.scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ($1::int * INTERVAL '1 hour')
      ORDER BY ta.id, st.scheduled_for ASC
      LIMIT $2
    `;

    const [personalRes, teamRes] = await Promise.all([
      pool.query(personalQuery, [safeHorizonHours, safeLimit]),
      pool.query(teamQuery, [safeHorizonHours, safeLimit]),
    ]);

    const targets = [
      ...personalRes.rows.map((row) => ({ row, accountType: 'personal' })),
      ...teamRes.rows.map((row) => ({ row, accountType: 'team' })),
    ];

    for (const target of targets) {
      const { row, accountType } = target;
      const beforeToken = row.access_token || null;
      const beforeExpiry = row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null;

      const scheduledLike = {
        id: `preflight_${accountType}_${row.id || row.user_id || 'unknown'}`,
        user_id: row.user_id || null,
        twitter_username: row.twitter_username || null,
        access_token: row.access_token || null,
        refresh_token: row.refresh_token || null,
        token_expires_at: row.token_expires_at || null,
        oauth1_access_token: row.oauth1_access_token || null,
        oauth1_access_token_secret: row.oauth1_access_token_secret || null,
      };

      try {
        summary.checked += 1;
        await refreshScheduledOAuth2TokenIfNeeded({
          scheduledTweet: scheduledLike,
          accountRow: row,
          accountType,
        });

        const afterToken = scheduledLike.access_token || null;
        const afterExpiry = scheduledLike.token_expires_at ? new Date(scheduledLike.token_expires_at).toISOString() : null;
        if (beforeToken !== afterToken || beforeExpiry !== afterExpiry) {
          summary.refreshed += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.warn('[Scheduled Tweet] Upcoming token preflight refresh failed', {
          accountType,
          userId: row.user_id || null,
          accountId: row.id || null,
          username: row.twitter_username || null,
          error: error?.message || String(error),
        });
      }
    }

    return summary;
  }


  /**
   * Process a single scheduled tweet and post it to Twitter
   * @param {Object} scheduledTweet - Scheduled tweet object with credentials attached
   */
  async processSingleScheduledTweet(scheduledTweet) {
    try {
      const metadataColumnAvailable = await hasScheduledMetadataColumn();
      const scheduledCrossPost = parseScheduledCrossPostConfig(scheduledTweet);

      // Mark as processing
      await pool.query(
        `UPDATE scheduled_tweets
         SET status = $1,
             processing_started_at = COALESCE(processing_started_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        ['processing', scheduledTweet.id]
      );


      // Create Twitter client - use OAuth1 if available, otherwise OAuth2
      let twitterClient;
      try {
        if (scheduledTweet.oauth1_access_token && scheduledTweet.oauth1_access_token_secret) {
          // Check if consumer keys are available
          if (!TWITTER_OAUTH1_APP_KEY || !TWITTER_OAUTH1_APP_SECRET) {
            console.warn('⚠️ OAuth 1.0a credentials missing in environment, falling back to OAuth 2.0');
            // Fallback to OAuth 2.0 if OAuth 1.0a env vars are missing
            if (scheduledTweet.access_token) {
              twitterClient = new TwitterApi(scheduledTweet.access_token);
              console.log('Using OAuth 2.0 for posting (OAuth 1.0a env vars not configured)');
            } else {
              throw new Error('No valid Twitter credentials found. Please check your environment variables and reconnect your Twitter account.');
            }
          } else {
            // Use OAuth 1.0a (more reliable for posting)
            twitterClient = new TwitterApi({
              appKey: TWITTER_OAUTH1_APP_KEY,
              appSecret: TWITTER_OAUTH1_APP_SECRET,
              accessToken: scheduledTweet.oauth1_access_token,
              accessSecret: scheduledTweet.oauth1_access_token_secret,
            });
            console.log('Using OAuth 1.0a for posting');
          }
        } else if (scheduledTweet.access_token) {
          // Fallback to OAuth 2.0
          twitterClient = new TwitterApi(scheduledTweet.access_token);
          console.log('Using OAuth 2.0 for posting');
        } else {
          throw new Error('No valid Twitter credentials found. Please reconnect your Twitter account.');
        }
      } catch (authError) {
        if (authError.code === 401 || authError.status === 401) {
          throw new Error('Twitter authentication failed (401). Token may be expired. Please reconnect your Twitter account.');
        }
        // Check for missing env vars error
        if (authError.message && authError.message.includes('Invalid consumer tokens')) {
          throw new Error('Twitter API configuration error. OAuth 1.0a requires TWITTER_CONSUMER_KEY/TWITTER_CONSUMER_SECRET (or TWITTER_API_KEY/TWITTER_API_SECRET).');
        }
        throw authError;
      }


      // Use stored media IDs directly if present
      let mediaIds = [];
      if (scheduledTweet.media_urls) {
        try {
          let parsed = scheduledTweet.media_urls;
          if (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed);
            } catch (e) {
              parsed = parsed.split(',').map(x => x.trim()).filter(Boolean);
            }
          }
          if (Array.isArray(parsed)) {
            if (parsed.every(x => typeof x === 'string' && /^\d+$/.test(x))) {
              mediaIds = parsed;
            }
          }
        } catch (mediaParseError) {
          console.error('Error parsing media_urls for scheduled tweet:', mediaParseError);
        }
      }


      // Parse per-tweet media for thread tweets
      let threadMediaArr = [];
      if (scheduledTweet.thread_media) {
        try {
          if (typeof scheduledTweet.thread_media === 'string') {
            threadMediaArr = JSON.parse(scheduledTweet.thread_media);
          } else if (Array.isArray(scheduledTweet.thread_media)) {
            threadMediaArr = scheduledTweet.thread_media;
          }
        } catch (e) {
          threadMediaArr = [];
        }
      }


      // Post main tweet with media IDs if present, decode HTML entities ONCE
      const cleanContent = stripMarkdown(scheduledTweet.content);
      console.log('[Thread Unicode Debug] Posting main tweet:', cleanContent);

      const tweetData = {
        text: decodeHTMLEntities(cleanContent),
        ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
      };


      const tweetResponse = await withRateLimitRetry(
        () => twitterClient.v2.tweet(tweetData),
        { label: 'scheduled-main-post' }
      );
      console.log(`✅ Main tweet posted successfully: ${tweetResponse.data.id}`);


      // Handle thread if present
      let threadSuccess = true;
      let threadError = null;
      const threadTweetIds = [];
      const postedThreadContents = [];

      if (scheduledTweet.thread_tweets && scheduledTweet.thread_tweets.length > 0) {
        let previousTweetId = tweetResponse.data.id;
        for (let i = 0; i < scheduledTweet.thread_tweets.length; i++) {
          try {
            let threadMediaIds = Array.isArray(threadMediaArr) && threadMediaArr[i + 1] ? threadMediaArr[i + 1] : [];
            const mediaCountForTweet = Array.isArray(threadMediaIds) ? threadMediaIds.length : 0;
            const totalParts = scheduledTweet.thread_tweets.length + 1;
            const shouldThrottle = i > 0 || totalParts > SCHEDULED_THREAD_LARGE_SIZE_THRESHOLD || mediaCountForTweet > 0;

            if (shouldThrottle) {
              const delayMs = getAdaptiveScheduledThreadDelayMs({
                index: i + 1,
                totalParts,
                mediaCount: mediaCountForTweet,
              });
              console.log(`[Thread ${i + 1}/${scheduledTweet.thread_tweets.length}] Waiting ${delayMs}ms before next reply`);
              await wait(delayMs);
            }
            const threadTweet = scheduledTweet.thread_tweets[i];
            const cleanThreadContent = stripMarkdown(threadTweet.content);
            postedThreadContents.push(cleanThreadContent);
            console.log(`[Thread ${i + 1}/${scheduledTweet.thread_tweets.length}] Posting:`, cleanThreadContent);
            const threadTweetData = {
              text: decodeHTMLEntities(cleanThreadContent),
              reply: { in_reply_to_tweet_id: previousTweetId },
              ...(Array.isArray(threadMediaIds) && threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
            };
            const threadResponse = await withRateLimitRetry(
              () => twitterClient.v2.tweet(threadTweetData),
              { label: `scheduled-thread-post-${i + 1}` }
            );
            previousTweetId = threadResponse.data.id;
            threadTweetIds.push({
              tweetId: threadResponse.data.id,
              content: cleanThreadContent,
              mediaIds: threadMediaIds
            });
            console.log(`✅ Thread tweet ${i + 1} posted successfully: ${threadResponse.data.id}`);
          } catch (threadErr) {
            console.error(`❌ Error posting thread tweet ${i + 1}:`, threadErr);
            threadSuccess = false;
            threadError = threadErr;
            if (isRateLimitedError(threadErr)) {
              const waitMs = getRateLimitWaitMs(threadErr);
              const waitSeconds = Math.ceil(waitMs / 1000);
              console.error(`Stopping remaining thread tweets after rate limit on part ${i + 1}. Retry after ~${waitSeconds}s.`);
            }
            if (threadErr.code === 403 || (threadErr.data && threadErr.data.status === 403)) {
              console.error('⚠️ Thread failed with 403 - likely duplicate content. Main tweet was posted successfully.');
            }
            break;
          }
        }
      }


      // Insert into tweets table for history tracking
      const tweetInsertQuery = `
        INSERT INTO tweets (
          user_id, content, tweet_id, status, posted_at, 
          source, account_id, author_id, created_at, updated_at
        ) VALUES ($1, $2, $3, 'posted', CURRENT_TIMESTAMP, 'platform', $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `;
      const accountId = scheduledTweet.account_id || null;
      const authorId = scheduledTweet.author_id || null;
      const { rows: insertedTweet } = await pool.query(tweetInsertQuery, [
        scheduledTweet.user_id,
        cleanContent,
        tweetResponse.data.id,
        accountId,
        authorId
      ]);
      console.log(`Inserted main tweet into history with ID: ${insertedTweet[0].id}`);
      if (threadTweetIds.length > 0) {
        for (const threadTweet of threadTweetIds) {
          await pool.query(tweetInsertQuery, [
            scheduledTweet.user_id,
            threadTweet.content,
            threadTweet.tweetId,
            accountId,
            authorId
          ]);
        }
        console.log(`Inserted ${threadTweetIds.length} additional thread tweets into history`);
      }

      let crossPostResult = null;
      if (scheduledCrossPost.enabled) {
        const mediaDetected = detectCrossPostMedia({
          media: mediaIds,
          threadMedia: threadMediaArr,
        });
        crossPostResult = buildScheduledCrossPostResultShape({
          linkedinEnabled: scheduledCrossPost.config.linkedin,
          threadsEnabled: scheduledCrossPost.config.threads,
          twitterEnabled: scheduledCrossPost.config.twitter,
          mediaDetected,
        });

        const shouldCrossPostThread = !(scheduledTweet.thread_tweets && scheduledTweet.thread_tweets.length > 0) || threadSuccess;
        if (!shouldCrossPostThread) {
          if (crossPostResult.linkedin.enabled) crossPostResult.linkedin.status = 'skipped_source_thread_failed';
          if (crossPostResult.threads.enabled) crossPostResult.threads.status = 'skipped_source_thread_failed';
          if (crossPostResult.twitter.enabled) crossPostResult.twitter.status = 'skipped_source_thread_failed';
        } else {
          const scheduledMainSourceMedia =
            Array.isArray(scheduledCrossPost?.config?.media) && scheduledCrossPost.config.media.length > 0
              ? scheduledCrossPost.config.media
              : (
                  Array.isArray(threadMediaArr) && threadMediaArr.length > 0
                    ? (Array.isArray(threadMediaArr?.[0]) ? threadMediaArr[0] : [])
                    : parseJsonArrayLoose(scheduledTweet.media)
                );
          const allThreadParts = [cleanContent, ...postedThreadContents].filter((part) => typeof part === 'string' && part.trim());
          const crossPostPayloads = buildCrossPostPayloads({
            content: cleanContent,
            thread: allThreadParts,
            optimizeCrossPost: scheduledCrossPost.config.optimizeCrossPost,
          });
          const tweetUrl = getTweetPermalink({
            username: scheduledTweet.twitter_username,
            tweetId: tweetResponse?.data?.id,
          });

          // Run cross-post targets in parallel when possible
          const isTeamCrossPost = Boolean(scheduledTweet.isTeamAccount);
          const linkedInTargetRouteId = scheduledCrossPost.config?.routing?.linkedinTargetAccountId || null;
          const threadsTargetRouteId = scheduledCrossPost.config?.routing?.threadsTargetAccountId || null;
          const twitterTargetRouteId = scheduledCrossPost.config?.routing?.twitterTargetAccountId || null;
          const twitterPostMode = allThreadParts.length > 1 ? 'thread' : 'single';
          const twitterThreadParts = twitterPostMode === 'thread' ? allThreadParts.slice(0, 25) : [];

          const crossPostTasks = [];

          if (crossPostResult.linkedin.enabled) {
            if (!linkedInTargetRouteId) {
              crossPostResult.linkedin.status = 'missing_target_route';
            } else {
              crossPostTasks.push((async () => {
                try {
                  const linkedInCrossPost = await crossPostScheduledToLinkedIn({
                    userId: scheduledTweet.user_id,
                    teamId: isTeamCrossPost ? scheduledTweet.team_id || null : null,
                    targetLinkedinTeamAccountId: isTeamCrossPost ? linkedInTargetRouteId : null,
                    targetAccountId: !isTeamCrossPost ? linkedInTargetRouteId : null,
                    content: crossPostPayloads.linkedin.content,
                    tweetUrl,
                    postMode: crossPostPayloads.linkedin.postMode,
                    mediaDetected,
                    media: scheduledMainSourceMedia,
                  });
                  return { target: 'linkedin', result: linkedInCrossPost };
                } catch (err) {
                  return { target: 'linkedin', error: err };
                }
              })());
            }
          }

          if (crossPostResult.threads.enabled) {
            if (!threadsTargetRouteId) {
              crossPostResult.threads.status = 'missing_target_route';
            } else {
              crossPostTasks.push((async () => {
                try {
                  const threadsCrossPost = await crossPostScheduledToThreads({
                    userId: scheduledTweet.user_id,
                    teamId: isTeamCrossPost ? scheduledTweet.team_id || null : null,
                    targetAccountId: threadsTargetRouteId,
                    content: crossPostPayloads.threads.content,
                    threadParts: crossPostPayloads.threads.threadParts,
                    postMode: crossPostPayloads.threads.postMode,
                    tweetUrl,
                    mediaDetected,
                    optimizeCrossPost: scheduledCrossPost.config.optimizeCrossPost,
                    media: scheduledMainSourceMedia,
                  });
                  return { target: 'threads', result: threadsCrossPost };
                } catch (err) {
                  return { target: 'threads', error: err };
                }
              })());
            }
          }

          if (crossPostResult.twitter.enabled) {
            if (!twitterTargetRouteId) {
              crossPostResult.twitter.status = 'missing_target_route';
            } else {
              crossPostTasks.push((async () => {
                try {
                  const twitterCrossPost = await crossPostScheduledToTwitterAccount({
                    userId: scheduledTweet.user_id,
                    teamId: isTeamCrossPost ? scheduledTweet.team_id || null : null,
                    targetAccountId: twitterTargetRouteId,
                    content: twitterPostMode === 'thread' ? twitterThreadParts[0] : cleanContent,
                    postMode: twitterPostMode,
                    threadParts: twitterThreadParts,
                    mediaDetected,
                    media: scheduledMainSourceMedia,
                  });
                  return { target: 'twitter', result: twitterCrossPost };
                } catch (err) {
                  return { target: 'twitter', error: err };
                }
              })());
            }
          }

          if (crossPostTasks.length > 0) {
            const settled = await Promise.allSettled(crossPostTasks);
            for (const s of settled) {
              if (s.status === 'fulfilled' && s.value && s.value.target) {
                const { target, result, error } = s.value;
                if (error) {
                  console.error(`[ScheduledTweet] Cross-post ${target} task failed:`, error?.message || error);
                  crossPostResult[target] = {
                    ...crossPostResult[target],
                    status: 'failed',
                  };
                } else {
                  crossPostResult[target] = {
                    ...crossPostResult[target],
                    ...result,
                    status: result?.status || 'failed',
                  };
                }
              } else if (s.status === 'rejected') {
                console.error('[ScheduledTweet] Cross-post task rejected:', s.reason?.message || s.reason);
              }
            }
          }
        }
      }

      const finalStatus = threadSuccess ? 'completed' : 'partially_completed';
      const errorMsg = threadSuccess ? null : `Main tweet posted, but thread failed: ${threadError?.message || 'Unknown error'}`;
      const nextMetadata = metadataColumnAvailable
        ? (() => {
            const baseMetadata = scheduledCrossPost?.metadata || parseJsonObject(scheduledTweet?.metadata, {});
            if (!crossPostResult && !scheduledCrossPost.enabled) {
              return baseMetadata;
            }
            const crossPostMeta = baseMetadata.cross_post && typeof baseMetadata.cross_post === 'object'
              ? { ...baseMetadata.cross_post }
              : {};
            crossPostMeta.last_attempted_at = new Date().toISOString();
            if (crossPostResult) {
              crossPostMeta.last_result = crossPostResult;
            }
            return {
              ...baseMetadata,
              cross_post: crossPostMeta,
            };
          })()
        : null;

      if (metadataColumnAvailable) {
        await pool.query(
          `UPDATE scheduled_tweets
           SET status = $1,
               posted_at = CURRENT_TIMESTAMP,
               error_message = $2,
               metadata = $3,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [finalStatus, errorMsg, JSON.stringify(nextMetadata || {}), scheduledTweet.id]
        );
      } else {
        await pool.query(
          `UPDATE scheduled_tweets
           SET status = $1,
               posted_at = CURRENT_TIMESTAMP,
               error_message = $2,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [finalStatus, errorMsg, scheduledTweet.id]
        );
      }
      if (threadSuccess) {
        console.log(`✅ Successfully posted scheduled tweet and thread: ${scheduledTweet.id}`);
      } else {
        console.log(`⚠️ Main tweet posted but thread failed: ${scheduledTweet.id}`);
      }
      return {
        outcome: threadSuccess ? 'succeeded' : 'partial',
        finalStatus,
        scheduledTweetId: scheduledTweet.id,
      };
    } catch (error) {
      console.error(`❌ Error posting scheduled tweet ${scheduledTweet.id}:`, error);
      let errorMessage = error.message || 'Unknown error';
      if (error.code === 401 || error.status === 401) {
        console.error('❌ Twitter 401 Error - Authentication failed');
        errorMessage = 'Twitter authentication failed (401). Please reconnect your Twitter account.';
      } else if (error.code === 403) {
        console.error('❌ Twitter 403 Error');
        errorMessage = `Twitter error (403): ${error.data?.detail || error.message || 'Forbidden - likely duplicate or rate limit'}`;
        await pool.query(
          `UPDATE scheduled_tweets
           SET status = $1,
               error_message = $2,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          ['failed', errorMessage, scheduledTweet.id]
        );
        console.log('🛑 Not retrying 403 error (likely duplicate content)');
        return { outcome: 'failed', reason: 'twitter_403', scheduledTweetId: scheduledTweet.id };
      } else if (isRateLimitedError(error)) {
        const retryDelayMs = getRateLimitWaitMs(error);
        const retryAt = new Date(Date.now() + retryDelayMs);
        const retryAtDb = toUtcDbTimestamp(retryAt);
        const currentRetryCount = Number(scheduledTweet.retry_count || 0);
        const nextRetryCount = currentRetryCount + 1;
        errorMessage = `Twitter rate limit exceeded. Auto-retrying at ${retryAt.toISOString()}.`;

        if (nextRetryCount >= SCHEDULED_DB_RETRY_MAX_ATTEMPTS) {
          try {
            await pool.query(
              `UPDATE scheduled_tweets
               SET status = $1,
                   error_message = $2,
                   retry_count = $3,
                   last_retry_at = CURRENT_TIMESTAMP,
                   processing_started_at = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $4`,
              ['failed', `Rate limit retry exhausted after ${nextRetryCount} attempts.`, nextRetryCount, scheduledTweet.id]
            );
          } catch (retryColumnError) {
            if (retryColumnError?.code === '42703') {
              await pool.query(
                `UPDATE scheduled_tweets
                 SET status = $1,
                     error_message = $2,
                     processing_started_at = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                ['failed', `Rate limit retry exhausted after ${nextRetryCount} attempts.`, scheduledTweet.id]
              );
            } else {
              throw retryColumnError;
            }
          }

          console.warn(
            `[ScheduledRateLimit] Marked scheduled tweet ${scheduledTweet.id} as failed after ${nextRetryCount} retries`
          );
          return {
            outcome: 'failed',
            reason: 'rate_limit_retry_exhausted',
            scheduledTweetId: scheduledTweet.id,
            retryCount: nextRetryCount,
          };
        }

        try {
          await pool.query(
            `UPDATE scheduled_tweets
             SET status = $1,
                 error_message = $2,
                 scheduled_for = CASE
                   WHEN scheduled_for < $4 THEN $4
                   ELSE scheduled_for
                 END,
                 retry_count = $5,
                 last_retry_at = CURRENT_TIMESTAMP,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            ['pending', errorMessage, scheduledTweet.id, retryAtDb, nextRetryCount]
          );
        } catch (retryColumnError) {
          if (retryColumnError?.code === '42703') {
            await pool.query(
              `UPDATE scheduled_tweets
               SET status = $1,
                   error_message = $2,
                   scheduled_for = CASE
                     WHEN scheduled_for < $4 THEN $4
                     ELSE scheduled_for
                   END,
                   processing_started_at = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3`,
              ['pending', errorMessage, scheduledTweet.id, retryAtDb]
            );
          } else {
            throw retryColumnError;
          }
        }

        console.warn(
          `[ScheduledRateLimit] Rescheduled scheduled tweet ${scheduledTweet.id} to ${retryAt.toISOString()} (retry ${nextRetryCount}/${SCHEDULED_DB_RETRY_MAX_ATTEMPTS})`
        );
        return {
          outcome: 'retry',
          scheduledTweetId: scheduledTweet.id,
          retryCount: nextRetryCount,
          retryAt: retryAt.toISOString(),
        };
      } else if (error.message && error.message.includes('Invalid consumer tokens')) {
        console.error('❌ Twitter API configuration error');
        errorMessage = 'Twitter API configuration error. Please check TWITTER_CONSUMER_KEY/TWITTER_CONSUMER_SECRET (or TWITTER_API_KEY/TWITTER_API_SECRET).';
      }
      console.error('   Full error:', JSON.stringify(error, null, 2));
      await pool.query(
        `UPDATE scheduled_tweets
         SET status = $1,
             error_message = $2,
             processing_started_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        ['failed', errorMessage, scheduledTweet.id]
      );
      try {
        const { rows: tweetRows } = await pool.query(
          'SELECT user_id, credits_used FROM tweets WHERE id = $1',
          [scheduledTweet.tweet_id]
        );
        if (tweetRows.length > 0) {
          await creditService.refundCredits(
            tweetRows[0].user_id,
            'scheduled_tweet_failed',
            tweetRows[0].credits_used
          );
        }
      } catch (refundError) {
        console.error('Error refunding credits for failed scheduled tweet:', refundError);
      }
      throw error;
    }
  }


  /**
   * Check if user can access a scheduled tweet (personal or team)
   * @param {string} userId - User ID
   * @param {string} scheduledTweetId - Scheduled tweet ID
   * @returns {boolean} True if user has access
   */
  async canUserAccessScheduledTweet(userId, scheduledTweetId) {
    const { rows } = await pool.query(
      `SELECT st.*, tm.user_id as is_team_member
       FROM scheduled_tweets st
       LEFT JOIN team_members tm ON st.team_id = tm.team_id AND tm.user_id = $1
       WHERE st.id = $2
       AND (st.user_id = $1 OR tm.user_id IS NOT NULL)`,
      [userId, scheduledTweetId]
    );

    return rows.length > 0;
  }


  /**
   * Re-upload media for scheduled tweets (placeholder implementation)
   * @param {Array} mediaUrls - Array of media URLs
   * @param {TwitterApi} twitterClient - Twitter API client
   * @returns {Array} Array of media IDs
   */
  async reuploadMedia(mediaUrls, twitterClient) {
    // This is a simplified implementation
    // In production, you'd want to store media files temporarily
    // and retrieve them here for re-upload
    const mediaIds = [];


    for (const mediaUrl of mediaUrls) {
      try {
        // For now, skip media re-upload in scheduled tweets
        // This would need proper media storage implementation
        console.log(`Skipping media re-upload for scheduled tweet: ${mediaUrl}`);
      } catch (error) {
        console.error('Media re-upload error:', error);
      }
    }


    return mediaIds;
  }


  /**
   * Get count of pending scheduled tweets for a user
   * @param {string} userId - User ID
   * @returns {number} Count of pending scheduled tweets
   */
  async getScheduledCount(userId) {
    try {
      const { rows } = await pool.query(
        'SELECT COUNT(*) FROM scheduled_tweets WHERE user_id = $1 AND status = $2',
        [userId, 'pending']
      );


      return parseInt(rows[0].count);
    } catch (error) {
      console.error('Error getting scheduled count:', error);
      return 0;
    }
  }


  /**
   * Cancel expired scheduled tweets (more than 24 hours overdue)
   */
  async cancelExpiredSchedules() {
    try {
      // Cancel schedules that are more than 24 hours overdue
      const { rows } = await pool.query(
        `UPDATE scheduled_tweets 
         SET status = 'expired', error_message = 'Schedule expired', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'pending' 
         AND scheduled_for < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
         RETURNING id`
      );


      if (rows.length > 0) {
        console.log(`Cancelled ${rows.length} expired scheduled tweets`);
      }
    } catch (error) {
      console.error('Error cancelling expired schedules:', error);
    }
  }
}


export const scheduledTweetService = new ScheduledTweetService();
