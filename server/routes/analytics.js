import express from 'express';
import pool from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { authenticateToken, validateTwitterConnection } from '../middleware/auth.js';
import { buildTwitterScopeFilter, resolveTwitterScope } from '../utils/twitterScopeResolver.js';
import { markTweetDeleted } from '../services/tweetRetentionService.js';

const router = express.Router();
const SYNC_COOLDOWN_MS = Number(process.env.ANALYTICS_SYNC_COOLDOWN_MS || 3 * 60 * 1000);
const SYNC_CANDIDATE_LIMIT = Number(process.env.ANALYTICS_SYNC_CANDIDATE_LIMIT || 20);
const SYNC_LOOKBACK_DAYS = Number(process.env.ANALYTICS_SYNC_LOOKBACK_DAYS || 50);
const SYNC_STALE_AFTER_MINUTES = Number(process.env.ANALYTICS_SYNC_STALE_AFTER_MINUTES || 120);
const SYNC_FORCE_REFRESH_COUNT = Number(process.env.ANALYTICS_SYNC_FORCE_REFRESH_COUNT || 20);
const SYNC_LOCK_STALE_MS = Number(process.env.ANALYTICS_SYNC_LOCK_STALE_MS || 20 * 60 * 1000);
const ANALYTICS_PRECOMPUTE_TTL_MS = Number(process.env.ANALYTICS_PRECOMPUTE_TTL_MS || 2 * 60 * 1000);
const ANALYTICS_DEBUG = process.env.ANALYTICS_DEBUG === 'true';
const ANALYTICS_CACHE_SCHEMA_VERSION = 'v2';
const TWEET_ANALYTICS_COLUMNS = ['impressions', 'likes', 'retweets', 'replies', 'quote_count', 'bookmark_count'];

const getSyncKey = (userId, accountId) => `${userId}:${accountId || 'personal'}`;
let analyticsSyncStateReady = false;
let analyticsPrecomputeCacheReady = false;
let tweetAnalyticsColumnsReady = false;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const analyticsInfo = (...args) => {
  if (ANALYTICS_DEBUG) {
    console.log(...args);
  }
};

const ensureAnalyticsSyncStateTable = async () => {
  if (analyticsSyncStateReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_sync_state (
      sync_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT,
      in_progress BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMP,
      last_sync_at TIMESTAMP,
      next_allowed_at TIMESTAMP,
      last_result VARCHAR(50),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_sync_state_user_account ON analytics_sync_state(user_id, account_id)`);
  analyticsSyncStateReady = true;
};

const ensureAnalyticsPrecomputeCacheTable = async () => {
  if (analyticsPrecomputeCacheReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_precompute_cache (
      cache_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT,
      endpoint TEXT NOT NULL,
      days INTEGER NOT NULL,
      payload JSONB NOT NULL,
      computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_analytics_precompute_cache_user_account
      ON analytics_precompute_cache(user_id, account_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_analytics_precompute_cache_expiry
      ON analytics_precompute_cache(expires_at)
  `);

  analyticsPrecomputeCacheReady = true;
};

const ensureTweetAnalyticsColumns = async () => {
  if (tweetAnalyticsColumnsReady) return;

  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tweets'`
  );

  const existingColumns = new Set((rows || []).map((row) => row.column_name));
  const missingColumns = TWEET_ANALYTICS_COLUMNS.filter((columnName) => !existingColumns.has(columnName));

  if (missingColumns.length > 0) {
    const alterParts = missingColumns.map((columnName) => `ADD COLUMN IF NOT EXISTS ${columnName} INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE tweets ${alterParts.join(', ')}`);
  }

  const hasQuotesColumn = existingColumns.has('quotes');
  const hasBookmarksColumn = existingColumns.has('bookmarks');
  const hasQuoteCountColumn = existingColumns.has('quote_count') || missingColumns.includes('quote_count');
  const hasBookmarkCountColumn = existingColumns.has('bookmark_count') || missingColumns.includes('bookmark_count');

  if (hasQuotesColumn && hasQuoteCountColumn) {
    await pool.query(`
      UPDATE tweets
      SET quote_count = COALESCE(NULLIF(quote_count, 0), quotes, 0)
      WHERE COALESCE(quote_count, 0) = 0
        AND COALESCE(quotes, 0) > 0
    `);
  }

  if (hasBookmarksColumn && hasBookmarkCountColumn) {
    await pool.query(`
      UPDATE tweets
      SET bookmark_count = COALESCE(NULLIF(bookmark_count, 0), bookmarks, 0)
      WHERE COALESCE(bookmark_count, 0) = 0
        AND COALESCE(bookmarks, 0) > 0
    `);
  }

  tweetAnalyticsColumnsReady = true;
};

const normalizeScopeAccountId = (scope) => {
  if (!scope || scope.mode !== 'team') return null;
  if (!scope.effectiveAccountId) return null;
  return String(scope.effectiveAccountId);
};

const buildAnalyticsCacheKey = ({ endpoint, userId, days, scope }) => {
  const teamScopeIds = Array.isArray(scope?.teamScope?.relatedAccountIds)
    ? [...scope.teamScope.relatedAccountIds].map(String).sort()
    : [];

  return [
    ANALYTICS_CACHE_SCHEMA_VERSION,
    endpoint || 'unknown',
    userId || 'unknown',
    scope?.mode || 'personal',
    scope?.effectiveAccountId || 'personal',
    scope?.twitterUserId || 'none',
    teamScopeIds.join(',') || 'none',
    days || 50,
  ].join('|');
};

const getAnalyticsCachedPayload = async ({ cacheKey }) => {
  await ensureAnalyticsPrecomputeCacheTable();

  const { rows } = await pool.query(
    `SELECT payload, computed_at
     FROM analytics_precompute_cache
     WHERE cache_key = $1
       AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [cacheKey]
  );

  if (!rows.length) return null;
  return rows[0];
};

const setAnalyticsCachedPayload = async ({ cacheKey, userId, accountId, endpoint, days, payload }) => {
  await ensureAnalyticsPrecomputeCacheTable();

  const expiresAt = new Date(Date.now() + Math.max(10000, ANALYTICS_PRECOMPUTE_TTL_MS));
  await pool.query(
    `INSERT INTO analytics_precompute_cache (
       cache_key, user_id, account_id, endpoint, days, payload, computed_at, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP, $7)
     ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           computed_at = CURRENT_TIMESTAMP,
           expires_at = EXCLUDED.expires_at,
           endpoint = EXCLUDED.endpoint,
           days = EXCLUDED.days,
           user_id = EXCLUDED.user_id,
           account_id = EXCLUDED.account_id`,
    [cacheKey, userId, accountId, endpoint, days, JSON.stringify(payload || {}), expiresAt]
  );
};

const clearAnalyticsCachedPayload = async ({ userId, accountId = null }) => {
  await ensureAnalyticsPrecomputeCacheTable();
  const normalizedAccountId = accountId === null || accountId === undefined ? null : String(accountId);

  if (normalizedAccountId) {
    await pool.query(
      `DELETE FROM analytics_precompute_cache
       WHERE user_id = $1 AND account_id = $2`,
      [userId, normalizedAccountId]
    );
    return;
  }

  await pool.query(
    `DELETE FROM analytics_precompute_cache
     WHERE user_id = $1`,
    [userId]
  );
};

const toTimestamp = (value) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
};

const buildSyncStatusPayload = (state, now = Date.now()) => {
  const nextAllowedMs = state?.next_allowed_at ? new Date(state.next_allowed_at).getTime() : null;
  const lastSyncMs = state?.last_sync_at ? new Date(state.last_sync_at).getTime() : null;

  return {
    inProgress: !!state?.in_progress,
    cooldownMs: SYNC_COOLDOWN_MS,
    nextAllowedAt: nextAllowedMs ? new Date(nextAllowedMs).toISOString() : null,
    cooldownRemainingMs: nextAllowedMs && nextAllowedMs > now ? nextAllowedMs - now : 0,
    lastSyncAt: lastSyncMs ? new Date(lastSyncMs).toISOString() : null,
    lastResult: state?.last_result || null,
  };
};

const getSyncState = async (syncKey) => {
  await ensureAnalyticsSyncStateTable();
  const { rows } = await pool.query(
    `SELECT sync_key, user_id, account_id, in_progress, started_at, last_sync_at, next_allowed_at, last_result
     FROM analytics_sync_state
     WHERE sync_key = $1
     LIMIT 1`,
    [syncKey]
  );
  return rows[0] || null;
};

const getSyncStatusPayload = async (syncKey, now = Date.now()) => {
  const state = await getSyncState(syncKey);
  return buildSyncStatusPayload(state, now);
};

const setSyncState = async (syncKey, { userId, accountId, patch = {} }) => {
  await ensureAnalyticsSyncStateTable();
  const normalizedAccountId = accountId === null || accountId === undefined ? null : String(accountId);

  await pool.query(
    `INSERT INTO analytics_sync_state (sync_key, user_id, account_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (sync_key) DO NOTHING`,
    [syncKey, userId, normalizedAccountId]
  );

  const values = [syncKey, userId, normalizedAccountId];
  const assignments = ['user_id = $2', 'account_id = $3'];

  if (hasOwn(patch, 'inProgress')) {
    values.push(!!patch.inProgress);
    assignments.push(`in_progress = $${values.length}`);
  }
  if (hasOwn(patch, 'startedAt')) {
    values.push(toTimestamp(patch.startedAt));
    assignments.push(`started_at = $${values.length}`);
  }
  if (hasOwn(patch, 'lastSyncAt')) {
    values.push(toTimestamp(patch.lastSyncAt));
    assignments.push(`last_sync_at = $${values.length}`);
  }
  if (hasOwn(patch, 'nextAllowedAt')) {
    values.push(toTimestamp(patch.nextAllowedAt));
    assignments.push(`next_allowed_at = $${values.length}`);
  }
  if (hasOwn(patch, 'lastResult')) {
    values.push(patch.lastResult || null);
    assignments.push(`last_result = $${values.length}`);
  }

  const { rows } = await pool.query(
    `UPDATE analytics_sync_state
     SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE sync_key = $1
     RETURNING sync_key, user_id, account_id, in_progress, started_at, last_sync_at, next_allowed_at, last_result`,
    values
  );

  return rows[0] || null;
};

const acquireSyncLock = async ({ syncKey, userId, accountId }) => {
  await ensureAnalyticsSyncStateTable();
  const normalizedAccountId = accountId === null || accountId === undefined ? null : String(accountId);
  const staleBefore = new Date(Date.now() - SYNC_LOCK_STALE_MS);

  const { rows } = await pool.query(
    `INSERT INTO analytics_sync_state (
       sync_key, user_id, account_id, in_progress, started_at, last_result, updated_at
     )
     VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, 'running', CURRENT_TIMESTAMP)
     ON CONFLICT (sync_key) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           account_id = EXCLUDED.account_id,
           in_progress = true,
           started_at = CURRENT_TIMESTAMP,
           last_result = 'running',
           updated_at = CURRENT_TIMESTAMP
     WHERE analytics_sync_state.in_progress = false
        OR analytics_sync_state.started_at IS NULL
        OR analytics_sync_state.started_at < $4
     RETURNING sync_key`,
    [syncKey, userId, normalizedAccountId, staleBefore]
  );

  return rows.length > 0;
};

const isRateLimitError = (error) => {
  const status = error?.code || error?.status || error?.response?.status;
  if (status === 429 || status === '429') return true;

  const message = String(error?.message || '').toLowerCase();
  return message.includes('429') || message.includes('rate limit');
};

const getRateLimitResetInfo = (error) => {
  const fallbackTimestamp = Date.now() + 15 * 60 * 1000;
  const candidates = [
    error?.rateLimit?.reset ? Number(error.rateLimit.reset) * 1000 : null,
    error?.headers?.['x-rate-limit-reset'] ? Number(error.headers['x-rate-limit-reset']) * 1000 : null,
    error?.response?.headers?.['x-rate-limit-reset'] ? Number(error.response.headers['x-rate-limit-reset']) * 1000 : null,
  ].filter((value) => Number.isFinite(value) && value > Date.now());

  const resetTimestamp = candidates.length > 0 ? candidates[0] : fallbackTimestamp;
  const waitMinutes = Math.max(1, Math.ceil((resetTimestamp - Date.now()) / 60000));

  return { resetTimestamp, waitMinutes };
};

const THREAD_BUCKET_SQL = `CASE
  WHEN (
    CASE
      WHEN jsonb_typeof(COALESCE(thread_tweets, '[]'::jsonb)) = 'array'
        THEN jsonb_array_length(COALESCE(thread_tweets, '[]'::jsonb))
      ELSE 0
    END
  ) > 0
    OR (content IS NOT NULL AND array_length(string_to_array(content, '---'), 1) > 1)
  THEN 'thread'
  ELSE 'single'
END`;
const ANALYTICS_EVENT_TS_SQL = `COALESCE(external_created_at, created_at)`;
const ANALYTICS_ENGAGEMENT_SQL = `COALESCE(likes, 0) + COALESCE(retweets, 0) + COALESCE(replies, 0) + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)`;

const injectScopeClause = (sql, scopeClause) => {
  if (!scopeClause) return sql;
  const marker = '/*__SCOPE__*/';
  if (sql.includes(marker)) {
    return sql.replace(marker, scopeClause);
  }

  // Match actual query clauses at line boundaries (avoid matching "WITHIN GROUP (...)").
  const boundaryMatch = sql.match(/(?:^|\n)\s*(GROUP BY|ORDER BY|LIMIT|HAVING|UNION)\b/i);
  if (!boundaryMatch || boundaryMatch.index === undefined) {
    return `${sql}${scopeClause}`;
  }

  return `${sql.slice(0, boundaryMatch.index).trimEnd()}${scopeClause}\n${sql
    .slice(boundaryMatch.index)
    .trimStart()}`;
};

// Get analytics overview
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    await ensureTweetAnalyticsColumns();

    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 50;
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });

    if (!twitterScope.connected && twitterScope.mode === 'personal') {
      return res.json({
        disconnected: true,
        overview: {},
        daily_metrics: [],
        tweets: [],
        hourly_engagement: [],
        content_type_metrics: [],
        growth: {
          current: {},
          previous: {},
        },
      });
    }

    if (twitterScope.ignoredSelectedAccountId) {
      analyticsInfo('[analytics/overview] Ignoring selected account header in personal mode', {
        userId,
        selectedAccountId,
      });
    }

    analyticsInfo('Analytics overview fetch', { userId, selectedAccountId, days, mode: twitterScope.mode });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const overviewCacheKey = buildAnalyticsCacheKey({
      endpoint: 'overview',
      userId,
      days,
      scope: twitterScope,
    });
    const cached = await getAnalyticsCachedPayload({ cacheKey: overviewCacheKey });
    if (cached?.payload) {
      return res.json({
        ...cached.payload,
        cached: true,
        computedAt: cached.computed_at,
      });
    }

    const buildScopedStatement = (baseSql, baseParams, alias = '') => {
      const { clause, params } = buildTwitterScopeFilter({
        scope: twitterScope,
        alias,
        startIndex: baseParams.length + 1,
        includeLegacyPersonalFallback: true,
        includeTeamOrphanFallback: true,
        orphanUserId: userId,
      });

      return {
        sql: injectScopeClause(baseSql, clause),
        params: [...baseParams, ...params],
      };
    };

    // Get comprehensive tweet metrics (both platform and external tweets)
    const tweetMetricsStatement = buildScopedStatement(
      `SELECT
        COUNT(*) as total_tweets,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(retweets), 0) as total_retweets,
        COALESCE(SUM(replies), 0) as total_replies,
        COALESCE(SUM(quote_count), 0) as total_quotes,
        COALESCE(SUM(bookmark_count), 0) as total_bookmarks,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(SUM(${ANALYTICS_ENGAGEMENT_SQL}), 0) as total_engagement,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN
          ROUND((COALESCE(SUM(${ANALYTICS_ENGAGEMENT_SQL}), 0)::DECIMAL / COALESCE(SUM(impressions), 1)::DECIMAL) * 100, 2)
        ELSE 0 END as engagement_rate,
        COUNT(CASE WHEN likes > 0 OR retweets > 0 OR replies > 0 OR COALESCE(quote_count, 0) > 0 OR COALESCE(bookmark_count, 0) > 0 THEN 1 END) as engaging_tweets,
        COALESCE(MAX(impressions), 0) as max_impressions,
        COALESCE(MAX(likes), 0) as max_likes,
        COALESCE(MAX(retweets), 0) as max_retweets,
        COALESCE(MAX(replies), 0) as max_replies,
        COALESCE(MAX(quote_count), 0) as max_quotes,
        COALESCE(MAX(bookmark_count), 0) as max_bookmarks
       FROM tweets
       WHERE user_id = $1
       AND ${ANALYTICS_EVENT_TS_SQL} >= $2
       AND status = 'posted'`,
      [userId, startDate]
    );
    const { rows: tweetMetrics } = await pool.query(tweetMetricsStatement.sql, tweetMetricsStatement.params);

    // Get daily metrics for chart
    const dailyMetricsStatement = buildScopedStatement(
      `SELECT
        DATE(${ANALYTICS_EVENT_TS_SQL}) as date,
        COUNT(*) as tweets_count,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(likes), 0) as likes,
        COALESCE(SUM(retweets), 0) as retweets,
        COALESCE(SUM(replies), 0) as replies,
        COALESCE(SUM(quote_count), 0) as quotes,
        COALESCE(SUM(bookmark_count), 0) as bookmarks,
        COALESCE(SUM(${ANALYTICS_ENGAGEMENT_SQL}), 0) as total_engagement,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN
          ROUND((COALESCE(SUM(${ANALYTICS_ENGAGEMENT_SQL}), 0)::DECIMAL / COALESCE(SUM(impressions), 1)::DECIMAL) * 100, 2)
        ELSE 0 END as engagement_rate,
        COALESCE(AVG(impressions), 0) as avg_impressions_per_tweet,
        COALESCE(AVG(likes), 0) as avg_likes_per_tweet
       FROM tweets
       WHERE user_id = $1
       AND ${ANALYTICS_EVENT_TS_SQL} >= $2
       AND status = 'posted'
       GROUP BY DATE(${ANALYTICS_EVENT_TS_SQL})
       ORDER BY date DESC
       LIMIT $3`,
      [userId, startDate, days]
    );
    const { rows: dailyMetrics } = await pool.query(dailyMetricsStatement.sql, dailyMetricsStatement.params);

    // Get all tweets for analytics (not just top performing)
    const tweetsStatement = buildScopedStatement(
      `SELECT
        id, tweet_id, content,
        COALESCE(impressions, 0) as impressions,
        COALESCE(likes, 0) as likes,
        COALESCE(retweets, 0) as retweets,
        COALESCE(replies, 0) as replies,
        COALESCE(quote_count, 0) as quote_count,
        COALESCE(bookmark_count, 0) as bookmark_count,
        source,
        COALESCE(external_created_at, created_at) as created_at,
        COALESCE(updated_at, external_created_at, created_at) as metrics_updated_at,
        (COALESCE(impressions, 0) + COALESCE(likes, 0) * 2 + COALESCE(retweets, 0) * 3 + COALESCE(replies, 0) * 2 + COALESCE(quote_count, 0) * 2 + COALESCE(bookmark_count, 0)) as engagement_score,
        CASE WHEN COALESCE(impressions, 0) > 0 THEN
          ROUND(((COALESCE(likes, 0) + COALESCE(retweets, 0) + COALESCE(replies, 0) + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0))::DECIMAL / impressions::DECIMAL) * 100, 2)
        ELSE 0 END as tweet_engagement_rate
       FROM tweets
       WHERE user_id = $1
       AND ${ANALYTICS_EVENT_TS_SQL} >= $2
       AND status = 'posted'
       ORDER BY created_at DESC`,
      [userId, startDate]
    );
    const { rows: tweets } = await pool.query(tweetsStatement.sql, tweetsStatement.params);

    // Get hourly engagement patterns
    const hourlyEngagementStatement = buildScopedStatement(
      `SELECT
        EXTRACT(HOUR FROM ${ANALYTICS_EVENT_TS_SQL}) as hour,
        COUNT(*) as tweets_count,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(AVG(${ANALYTICS_ENGAGEMENT_SQL}), 0) as avg_engagement
       FROM tweets
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
       GROUP BY EXTRACT(HOUR FROM ${ANALYTICS_EVENT_TS_SQL})
       ORDER BY avg_engagement DESC`,
      [userId, startDate]
    );
    const { rows: hourlyEngagement } = await pool.query(hourlyEngagementStatement.sql, hourlyEngagementStatement.params);

    // Get content type performance
    const contentTypeStatement = buildScopedStatement(
      `SELECT
        ${THREAD_BUCKET_SQL} as content_type,
        COUNT(*) as tweets_count,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(AVG(${ANALYTICS_ENGAGEMENT_SQL}), 0) as avg_total_engagement
       FROM tweets
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted' AND content IS NOT NULL
       GROUP BY ${THREAD_BUCKET_SQL}`,
      [userId, startDate]
    );
    const { rows: contentTypeMetrics } = await pool.query(contentTypeStatement.sql, contentTypeStatement.params);

    // Get growth metrics (compare with previous period)
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - days);

    const previousMetricsStatement = buildScopedStatement(
      `SELECT
        COUNT(*) as prev_total_tweets,
        COALESCE(SUM(impressions), 0) as prev_total_impressions,
        COALESCE(SUM(likes), 0) as prev_total_likes,
        COALESCE(SUM(retweets), 0) as prev_total_retweets,
        COALESCE(SUM(replies), 0) as prev_total_replies,
        COALESCE(SUM(quote_count), 0) as prev_total_quotes,
        COALESCE(SUM(bookmark_count), 0) as prev_total_bookmarks,
        COALESCE(SUM(${ANALYTICS_ENGAGEMENT_SQL}), 0) as prev_total_engagement
       FROM tweets
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND ${ANALYTICS_EVENT_TS_SQL} < $3 AND status = 'posted'`,
      [userId, previousStartDate, startDate]
    );
    const { rows: previousMetrics } = await pool.query(previousMetricsStatement.sql, previousMetricsStatement.params);

    analyticsInfo('Analytics overview data fetched successfully');

    const responsePayload = {
      disconnected: false,
      overview: tweetMetrics[0] || {},
      daily_metrics: dailyMetrics || [],
      tweets: tweets || [],
      hourly_engagement: hourlyEngagement || [],
      content_type_metrics: contentTypeMetrics || [],
      growth: {
        current: tweetMetrics[0] || {},
        previous: previousMetrics[0] || {},
      },
    };

    await setAnalyticsCachedPayload({
      cacheKey: overviewCacheKey,
      userId,
      accountId: normalizeScopeAccountId(twitterScope),
      endpoint: 'overview',
      days,
      payload: responsePayload,
    });

    res.json(responsePayload);

  } catch (error) {
    console.error('Analytics overview error:', error?.message || error);
    res.status(500).json({
      error: 'Failed to fetch analytics overview',
      message: error.message,
    });
  }
});

router.get('/sync-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });
    const effectiveAccountId = twitterScope.mode === 'team' ? twitterScope.effectiveAccountId : null;
    const key = getSyncKey(userId, effectiveAccountId);
    const syncStatus = await getSyncStatusPayload(key);

    return res.json({
      success: true,
      disconnected: !twitterScope.connected && twitterScope.mode === 'personal',
      syncStatus,
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch sync status',
      message: error.message,
    });
  }
});

// Sync analytics from Twitter (SEPARATE ROUTE)
// Enhanced Sync Analytics Route with Proper Rate Limiting
router.post('/sync', validateTwitterConnection, async (req, res) => {
  let updatedCount = 0;
  let errorCount = 0;
  const updatedTweetIds = new Set();
  const skippedTweetIds = new Set();
  const skipReasons = {
    missing_tweet_id: 0,
    not_found: 0,
    lookup_error: 0,
    no_public_metrics: 0,
    no_change: 0,
    rate_limited: 0,
  };
  let syncKey = null;
  let ownsSyncLock = false;
  let syncAccountId = null;
  let syncUserId = null;
  let shouldInvalidateAnalyticsCache = false;
  let tweetsToUpdate = [];
  let debugInfo = null;
  const syncRunId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const log = (message, extra = null) => {
    if (extra) {
      console.log(`[ANALYTICS_SYNC][${syncRunId}] ${message}`, extra);
    } else {
      console.log(`[ANALYTICS_SYNC][${syncRunId}] ${message}`);
    }
  };

  try {
    await ensureTweetAnalyticsColumns();

    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const parsedRequestedDays = Number.parseInt(req.body?.days, 10);
    const requestedLookbackDays = Number.isFinite(parsedRequestedDays) && parsedRequestedDays > 0
      ? Math.min(Math.max(parsedRequestedDays, 7), 90)
      : SYNC_LOOKBACK_DAYS;
    const teamAccountScope = twitterAccount?.isTeamAccount
      ? await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId })
      : null;
    const twitterScope = twitterAccount?.isTeamAccount && teamAccountScope?.mode === 'team'
      ? teamAccountScope
      : {
          mode: 'personal',
          connected: true,
          userId,
          selectedAccountId: null,
          effectiveAccountId: null,
          twitterUserId: twitterAccount?.twitter_user_id || null,
          teamScope: null,
          ignoredSelectedAccountId: !!selectedAccountId,
        };
    const effectiveAccountId = twitterScope.mode === 'team' ? twitterScope.effectiveAccountId : null;
    syncKey = getSyncKey(userId, effectiveAccountId);
    syncAccountId = effectiveAccountId;
    syncUserId = userId;

    log('Sync requested', {
      userId,
      selectedAccountId,
      effectiveAccountId,
      isTeamAccount: !!twitterAccount?.isTeamAccount,
      scopeAccountIds: twitterScope.mode === 'team' ? twitterScope.teamScope?.relatedAccountIds || null : null,
      allowOrphanFallback: twitterScope.mode === 'team' ? !!twitterScope.teamScope?.allowOrphanFallback : true,
      twitterUserId: twitterScope.twitterUserId,
    });

    if (selectedAccountId && twitterAccount?.isTeamAccount && twitterScope.mode !== 'team') {
      log('Selected team account not accessible for sync, falling back to default user scope', { selectedAccountId });
    } else if (selectedAccountId && !effectiveAccountId) {
      log('Ignoring x-selected-account-id for personal sync', { selectedAccountId });
    }

    const now = Date.now();
    const currentSyncStatus = await getSyncStatusPayload(syncKey, now);

    if (currentSyncStatus.inProgress) {
      return res.status(409).json({
        success: false,
        error: 'Analytics sync already in progress',
        message: 'A sync request is already running for this account. Please wait for it to finish.',
        type: 'sync_in_progress',
        syncStatus: currentSyncStatus,
      });
    }

    if (currentSyncStatus.cooldownRemainingMs > 0) {
      const waitMinutes = Math.max(1, Math.ceil(currentSyncStatus.cooldownRemainingMs / 60000));
      return res.status(200).json({
        success: false,
        cooldown: true,
        error: 'Sync cooldown active',
        message: `Please wait about ${waitMinutes} minutes before syncing again.`,
        type: 'sync_cooldown',
        waitMinutes,
        syncStatus: currentSyncStatus,
      });
    }

    const lockAcquired = await acquireSyncLock({
      syncKey,
      userId,
      accountId: effectiveAccountId,
    });

    if (!lockAcquired) {
      const latestSyncStatus = await getSyncStatusPayload(syncKey, now);
      return res.status(409).json({
        success: false,
        error: 'Analytics sync already in progress',
        message: 'A sync request is already running for this account. Please wait for it to finish.',
        type: 'sync_in_progress',
        syncStatus: latestSyncStatus,
      });
    }
    ownsSyncLock = true;

    log('Sync lock acquired', { syncKey });

    let twitterClient;
    if (twitterAccount.access_token) {
      try {
        twitterClient = new TwitterApi(twitterAccount.access_token);
      } catch (oauth2Error) {
        console.error('OAuth 2.0 initialization failed:', oauth2Error);
        await setSyncState(syncKey, {
          userId,
          accountId: effectiveAccountId,
          patch: { inProgress: false, lastResult: 'auth_error' },
        });
        return res.status(401).json({
          error: 'Twitter authentication failed',
          message: 'Please reconnect your Twitter account.',
          type: 'twitter_auth_error',
          syncStatus: await getSyncStatusPayload(syncKey),
        });
      }
    } else {
      throw new Error('No OAuth 2.0 access token found');
    }

    const syncScopeParams = [userId];
    let syncWhereClause = 'WHERE user_id = $1';
    const { clause: syncScopeClause, params: syncScopeFilterParams } = buildTwitterScopeFilter({
      scope: twitterScope,
      startIndex: syncScopeParams.length + 1,
      includeLegacyPersonalFallback: twitterScope.mode !== 'team',
      includeTeamOrphanFallback: twitterScope.mode === 'team',
      orphanUserId: userId,
    });
    syncScopeParams.push(...syncScopeFilterParams);
    syncWhereClause += syncScopeClause;

    const effectiveForceRefreshCount = Math.min(
      SYNC_CANDIDATE_LIMIT,
      Math.max(1, SYNC_FORCE_REFRESH_COUNT)
    );

    const lookbackDaysIndex = syncScopeParams.push(requestedLookbackDays);
    const forceRefreshCountIndex = syncScopeParams.push(effectiveForceRefreshCount);
    const staleAfterMinutesIndex = syncScopeParams.push(SYNC_STALE_AFTER_MINUTES);
    const candidateLimitIndex = syncScopeParams.push(SYNC_CANDIDATE_LIMIT);

    log('Sync candidate config', {
      lookbackDays: requestedLookbackDays,
      staleAfterMinutes: SYNC_STALE_AFTER_MINUTES,
      forceRefreshCount: effectiveForceRefreshCount,
      candidateLimit: SYNC_CANDIDATE_LIMIT,
    });

    const syncQuery = `
      WITH scoped_tweets AS (
        SELECT
          id,
          tweet_id,
          content,
          created_at,
          external_created_at,
          updated_at,
          impressions,
          likes,
          retweets,
          replies,
          quote_count,
          bookmark_count,
          COALESCE(external_created_at, created_at) AS sort_ts
        FROM tweets
        ${syncWhereClause}
        AND status = 'posted'
        AND source IN ('platform', 'external')
        AND tweet_id IS NOT NULL
        AND COALESCE(external_created_at, created_at) >= NOW() - ($${lookbackDaysIndex}::int * INTERVAL '1 day')
      ),
      force_candidates AS (
        SELECT *
        FROM scoped_tweets
        ORDER BY sort_ts DESC
        LIMIT $${forceRefreshCountIndex}
      ),
      stale_candidates AS (
        SELECT *
        FROM scoped_tweets
        WHERE
          impressions IS NULL
          OR impressions = 0
          OR updated_at IS NULL
          OR updated_at < NOW() - ($${staleAfterMinutesIndex}::int * INTERVAL '1 minute')
        ORDER BY sort_ts DESC
        LIMIT $${candidateLimitIndex}
      )
      SELECT
        id,
        tweet_id,
        content,
        created_at,
        impressions,
        likes,
        retweets,
        replies,
        quote_count,
        bookmark_count
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_ts DESC) AS rn
        FROM (
          SELECT * FROM force_candidates
          UNION ALL
          SELECT * FROM stale_candidates
        ) AS unioned
      ) AS deduped
      WHERE rn = 1
      ORDER BY created_at DESC
      LIMIT $${candidateLimitIndex}
    `;

    const syncResult = await pool.query(syncQuery, syncScopeParams);
    tweetsToUpdate = syncResult.rows || [];

    log('Tweets selected for sync', {
      totalCandidates: tweetsToUpdate.length,
      sampleTweetIds: tweetsToUpdate.slice(0, 5).map((row) => row.tweet_id),
    });

    if (tweetsToUpdate.length === 0) {
      const diagParams = [userId];
      let diagWhereClause = 'WHERE user_id = $1';
      const { clause: diagScopeClause, params: diagScopeFilterParams } = buildTwitterScopeFilter({
        scope: twitterScope,
        startIndex: diagParams.length + 1,
        includeLegacyPersonalFallback: twitterScope.mode !== 'team',
        includeTeamOrphanFallback: twitterScope.mode === 'team',
        orphanUserId: userId,
      });
      diagParams.push(...diagScopeFilterParams);
      diagWhereClause += diagScopeClause;

      const diagLookbackDaysIndex = diagParams.push(requestedLookbackDays);
      const diagStaleAfterMinutesIndex = diagParams.push(SYNC_STALE_AFTER_MINUTES);

      const diagnosticsResult = await pool.query(
        `SELECT
          COUNT(*)::int AS total_posted_with_tweet_id,
          COUNT(*) FILTER (WHERE source = 'platform')::int AS platform_count,
          COUNT(*) FILTER (WHERE source = 'external')::int AS external_count,
          COUNT(*) FILTER (WHERE impressions IS NULL OR impressions = 0)::int AS zero_metrics_count,
         COUNT(*) FILTER (
            WHERE updated_at IS NULL OR updated_at < NOW() - ($${diagStaleAfterMinutesIndex}::int * INTERVAL '1 minute')
          )::int AS stale_count
         FROM tweets
         ${diagWhereClause}
         AND status = 'posted'
         AND source IN ('platform', 'external')
         AND tweet_id IS NOT NULL
         AND COALESCE(external_created_at, created_at) >= NOW() - ($${diagLookbackDaysIndex}::int * INTERVAL '1 day')`,
        diagParams
      );

      const diagnostics = diagnosticsResult.rows?.[0] || {};
      debugInfo = {
        totalPostedWithTweetId: diagnostics.total_posted_with_tweet_id || 0,
        platformCount: diagnostics.platform_count || 0,
        externalCount: diagnostics.external_count || 0,
        zeroMetricsCount: diagnostics.zero_metrics_count || 0,
        staleCount: diagnostics.stale_count || 0,
      };

      log('No candidates found for sync', debugInfo);

      const completedAt = Date.now();
      await setSyncState(syncKey, {
        userId,
        accountId: effectiveAccountId,
        patch: {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
          lastResult: 'noop',
        },
      });

      return res.json({
        success: true,
        message: 'No tweets need syncing at this time',
        stats: {
          metrics_updated: 0,
          errors: 0,
          total_processed: 0,
          total_candidates: 0,
          skip_reasons: skipReasons,
        },
        debugInfo,
        runId: syncRunId,
        syncStatus: await getSyncStatusPayload(syncKey),
      });
    }

    // Use batch lookups to keep calls low and avoid client timeouts.
    const batchSize = 50;

    for (let i = 0; i < tweetsToUpdate.length; i += batchSize) {
      const batch = tweetsToUpdate.slice(i, i + batchSize);
      const tweetIds = batch
        .map((tweet) => String(tweet.tweet_id || '').trim())
        .filter(Boolean);

      if (tweetIds.length === 0) {
        skipReasons.missing_tweet_id += batch.length;
        for (const tweet of batch) skippedTweetIds.add(tweet.id);
        log('Batch skipped due to missing tweet IDs', { batchSize: batch.length });
        continue;
      }

      log('Fetching batch metrics', {
        batchIndex: Math.floor(i / batchSize) + 1,
        batchSize: tweetIds.length,
        firstTweetId: tweetIds[0],
      });

      let batchLookup;
      try {
        batchLookup = await twitterClient.v2.tweets(tweetIds, {
          'tweet.fields': ['public_metrics', 'created_at'],
        });
        // Debug: Log Twitter API response for this batch
        console.log('[SYNC DEBUG] Twitter API response for tweetIds:', tweetIds, JSON.stringify(batchLookup, null, 2));
      } catch (batchError) {
        if (isRateLimitError(batchError)) {
          const { resetTimestamp, waitMinutes } = getRateLimitResetInfo(batchError);
          const resetTime = new Date(resetTimestamp);
          const rateLimitedCount = Math.max(0, tweetsToUpdate.length - i);

          for (let j = i; j < tweetsToUpdate.length; j++) {
            skippedTweetIds.add(tweetsToUpdate[j].id);
          }
          skipReasons.rate_limited += rateLimitedCount;
          errorCount += rateLimitedCount;

          const completedAt = Date.now();
          await setSyncState(syncKey, {
            userId,
            accountId: effectiveAccountId,
            patch: {
              inProgress: false,
              lastSyncAt: completedAt,
              nextAllowedAt: Math.max(resetTimestamp, completedAt + SYNC_COOLDOWN_MS),
              lastResult: 'rate_limited',
            },
          });

          const payload = {
            success: updatedCount > 0,
            partial: updatedCount > 0,
            rateLimited: true,
            error: 'Twitter API rate limit exceeded',
            message: `Rate limit reached after updating ${updatedCount} tweets. Please retry in about ${waitMinutes} minutes.`,
            type: 'rate_limit',
            resetTime: resetTime.toISOString(),
            waitMinutes,
            updatedTweetIds: Array.from(updatedTweetIds),
            skippedTweetIds: Array.from(skippedTweetIds),
            stats: {
              metrics_updated: updatedCount,
              errors: errorCount,
              total_processed: updatedCount + skippedTweetIds.size,
              total_candidates: tweetsToUpdate.length,
              remaining: Math.max(0, tweetsToUpdate.length - (updatedCount + skippedTweetIds.size)),
              skip_reasons: skipReasons,
            },
            debugInfo,
            runId: syncRunId,
            syncStatus: await getSyncStatusPayload(syncKey),
          };

          log('Rate limit encountered during batch sync', {
            waitMinutes,
            updatedCount,
            skippedCount: skippedTweetIds.size,
          });

          return updatedCount > 0 ? res.status(200).json(payload) : res.status(429).json(payload);
        }

        throw batchError;
      }

      const tweetData = Array.isArray(batchLookup?.data) ? batchLookup.data : [];
      const lookupErrors = Array.isArray(batchLookup?.errors) ? batchLookup.errors : [];
      log('Batch lookup complete', {
        returnedData: tweetData.length,
        returnedErrors: lookupErrors.length,
      });
      const metricsByTweetId = new Map(
        tweetData
          .filter((item) => item?.id && item?.public_metrics)
          .map((item) => [String(item.id), item.public_metrics])
      );
      const errorByTweetId = new Map(
        lookupErrors
          .filter((item) => item?.resource_id || item?.value)
          .map((item) => [String(item.resource_id || item.value), item])
      );

      for (const tweet of batch) {
        const tweetId = String(tweet.tweet_id || '');
        const publicMetrics = metricsByTweetId.get(tweetId);

        if (publicMetrics) {
          const nextImpressions = publicMetrics.impression_count || 0;
          const nextLikes = publicMetrics.like_count || 0;
          const nextRetweets = publicMetrics.retweet_count || 0;
          const nextReplies = publicMetrics.reply_count || 0;
          const nextQuotes = publicMetrics.quote_count || 0;
          const nextBookmarks = publicMetrics.bookmark_count || 0;

          const currentImpressions = Number(tweet.impressions || 0);
          const currentLikes = Number(tweet.likes || 0);
          const currentRetweets = Number(tweet.retweets || 0);
          const currentReplies = Number(tweet.replies || 0);
          const currentQuotes = Number(tweet.quote_count || 0);
          const currentBookmarks = Number(tweet.bookmark_count || 0);

          const hasDelta =
            currentImpressions !== nextImpressions ||
            currentLikes !== nextLikes ||
            currentRetweets !== nextRetweets ||
            currentReplies !== nextReplies ||
            currentQuotes !== nextQuotes ||
            currentBookmarks !== nextBookmarks;

          if (!hasDelta) {
            skipReasons.no_change++;
            skippedTweetIds.add(tweet.id);
            log('Tweet metrics unchanged', {
              tweetId,
              dbId: tweet.id,
              impressions: nextImpressions,
              likes: nextLikes,
              retweets: nextRetweets,
              replies: nextReplies,
            });
            continue;
          }

          // Debug: Log before DB update
          console.log('[SYNC DEBUG] Updating DB for tweet', tweetId, {
            dbId: tweet.id,
            current: {
              impressions: currentImpressions,
              likes: currentLikes,
              retweets: currentRetweets,
              replies: currentReplies,
              quotes: currentQuotes,
              bookmarks: currentBookmarks,
            },
            next: {
              impressions: nextImpressions,
              likes: nextLikes,
              retweets: nextRetweets,
              replies: nextReplies,
              quotes: nextQuotes,
              bookmarks: nextBookmarks,
            }
          });
          await pool.query(
            `UPDATE tweets SET
              impressions = $1,
              likes = $2,
              retweets = $3,
              replies = $4,
              quote_count = $5,
              bookmark_count = $6,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $7`,
            [
              nextImpressions,
              nextLikes,
              nextRetweets,
              nextReplies,
              nextQuotes,
              nextBookmarks,
              tweet.id
            ]
          );
          updatedCount++;
          shouldInvalidateAnalyticsCache = true;
          updatedTweetIds.add(tweet.id);
          log('Tweet metrics updated', {
            tweetId,
            dbId: tweet.id,
            impressions: publicMetrics.impression_count || 0,
            likes: publicMetrics.like_count || 0,
            retweets: publicMetrics.retweet_count || 0,
            replies: publicMetrics.reply_count || 0,
          });
          continue;
        }

        const tweetLookupError = errorByTweetId.get(tweetId);
        const isNotFoundError =
          tweetLookupError?.type?.includes('resource-not-found') ||
          String(tweetLookupError?.title || '').toLowerCase().includes('not found');

        if (isNotFoundError) {
          await markTweetDeleted(tweet.id);
          shouldInvalidateAnalyticsCache = true;
          skipReasons.not_found++;
          log('Tweet not found on Twitter, marked deleted', { tweetId, dbId: tweet.id });
        } else if (tweetLookupError) {
          errorCount++;
          skipReasons.lookup_error++;
          log('Tweet lookup error', {
            tweetId,
            dbId: tweet.id,
            title: tweetLookupError.title,
            detail: tweetLookupError.detail,
            type: tweetLookupError.type,
          });
        } else {
          skipReasons.no_public_metrics++;
          log('Tweet skipped: no public metrics in lookup response', { tweetId, dbId: tweet.id });
        }

        skippedTweetIds.add(tweet.id);
      }
    }

    const completedAt = Date.now();
    await setSyncState(syncKey, {
      userId,
      accountId: effectiveAccountId,
      patch: {
        inProgress: false,
        lastSyncAt: completedAt,
        nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
        lastResult: errorCount > 0 ? 'completed_with_errors' : 'completed',
      },
    });

    log('Sync complete', {
      updatedCount,
      errorCount,
      skippedCount: skippedTweetIds.size,
      totalCandidates: tweetsToUpdate.length,
      remaining: Math.max(0, tweetsToUpdate.length - (updatedCount + skippedTweetIds.size)),
      skipReasons,
    });

    res.json({
      success: true,
      message: `Analytics sync completed! Updated ${updatedCount} tweets${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
      updatedTweetIds: Array.from(updatedTweetIds),
      skippedTweetIds: Array.from(skippedTweetIds),
      stats: {
        metrics_updated: updatedCount,
        errors: errorCount,
        total_processed: updatedCount + skippedTweetIds.size,
        total_candidates: tweetsToUpdate.length,
        remaining: Math.max(0, tweetsToUpdate.length - (updatedCount + skippedTweetIds.size)),
        skip_reasons: skipReasons,
      },
      debugInfo,
      runId: syncRunId,
      syncStatus: await getSyncStatusPayload(syncKey),
    });

  } catch (error) {
    log('Sync error', {
      message: error?.message,
      code: error?.code,
      status: error?.status || error?.response?.status,
    });

    if (isRateLimitError(error)) {
      const { resetTimestamp, waitMinutes } = getRateLimitResetInfo(error);
      const resetTime = new Date(resetTimestamp);
      const completedAt = Date.now();
      const rateLimitedRemainder = Math.max(0, tweetsToUpdate.length - (updatedCount + skippedTweetIds.size));
      if (rateLimitedRemainder > 0) {
        errorCount += rateLimitedRemainder;
        skipReasons.rate_limited += rateLimitedRemainder;
      } else if (errorCount === 0 && updatedCount === 0) {
        errorCount = 1;
      }

      if (syncKey) {
        await setSyncState(syncKey, {
          userId,
          accountId: effectiveAccountId,
          patch: {
            inProgress: false,
            lastSyncAt: completedAt,
            nextAllowedAt: Math.max(resetTimestamp, completedAt + SYNC_COOLDOWN_MS),
            lastResult: 'rate_limited',
          },
        });
      }

      const payload = {
        success: updatedCount > 0,
        partial: updatedCount > 0,
        rateLimited: true,
        error: 'Twitter API rate limit exceeded',
        message: `Please wait ${waitMinutes} minutes before trying again. Updated ${updatedCount} tweets so far.`,
        resetTime: resetTime.toISOString(),
        waitMinutes,
        type: 'rate_limit',
        updatedTweetIds: Array.from(updatedTweetIds),
        skippedTweetIds: Array.from(skippedTweetIds),
        stats: {
          metrics_updated: updatedCount,
          errors: errorCount,
          total_processed: updatedCount + skippedTweetIds.size,
          total_candidates: tweetsToUpdate.length,
          remaining: Math.max(0, tweetsToUpdate.length - (updatedCount + skippedTweetIds.size)),
          skip_reasons: skipReasons,
        },
        debugInfo,
        runId: syncRunId,
        syncStatus: syncKey ? await getSyncStatusPayload(syncKey) : null,
      };

      return updatedCount > 0 ? res.status(200).json(payload) : res.status(429).json(payload);
    }

    if (syncKey) {
      const completedAt = Date.now();
      await setSyncState(syncKey, {
        userId,
        accountId: effectiveAccountId,
        patch: {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
          lastResult: 'error',
        },
      });
    }

    res.status(500).json({
      error: 'Failed to sync analytics data',
      message: error.message || 'Unknown error occurred',
      type: 'server_error',
      updatedTweetIds: Array.from(updatedTweetIds),
      skippedTweetIds: Array.from(skippedTweetIds),
      stats: {
        metrics_updated: updatedCount,
        errors: errorCount,
        total_processed: updatedCount + skippedTweetIds.size,
        total_candidates: tweetsToUpdate.length,
        remaining: Math.max(0, tweetsToUpdate.length - (updatedCount + skippedTweetIds.size)),
        skip_reasons: skipReasons,
      },
      debugInfo,
      runId: syncRunId,
      syncStatus: syncKey ? await getSyncStatusPayload(syncKey) : null,
    });
  } finally {
    // Always clear analytics cache after sync, regardless of shouldInvalidateAnalyticsCache
    if (syncUserId) {
      try {
        await clearAnalyticsCachedPayload({ userId: syncUserId, accountId: syncAccountId });
        console.log('[SYNC DEBUG] Cleared analytics cache for', syncUserId, syncAccountId);
      } catch (cacheError) {
        console.warn('[analytics/sync] failed to invalidate precompute cache', cacheError?.message || cacheError);
      }
    }

    if (syncKey && ownsSyncLock) {
      await setSyncState(syncKey, {
        userId: syncUserId || req.user.id,
        accountId: syncAccountId,
        patch: { inProgress: false },
      });
    }
  }
});

// Force refresh metrics for a single tweet card (debug/verification)
router.post('/tweets/:tweetId/refresh', validateTwitterConnection, async (req, res) => {
  try {
    await ensureTweetAnalyticsColumns();

    const userId = req.user.id;
    const dbTweetId = req.params.tweetId;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });
    const effectiveAccountId = twitterScope.mode === 'team' ? twitterScope.effectiveAccountId : null;

    const { clause: scopeClause, params: scopeParams } = buildTwitterScopeFilter({
      scope: twitterScope,
      alias: 't',
      startIndex: 3,
      includeLegacyPersonalFallback: twitterScope.mode !== 'team',
      includeTeamOrphanFallback: twitterScope.mode === 'team',
      orphanUserId: userId,
    });

    const queryParams = [dbTweetId, userId, ...scopeParams];
    const tweetResult = await pool.query(
      `SELECT
         t.id,
         t.tweet_id,
         COALESCE(t.impressions, 0) AS impressions,
         COALESCE(t.likes, 0) AS likes,
         COALESCE(t.retweets, 0) AS retweets,
         COALESCE(t.replies, 0) AS replies,
         COALESCE(t.quote_count, 0) AS quote_count,
         COALESCE(t.bookmark_count, 0) AS bookmark_count,
         t.updated_at
       FROM tweets t
       WHERE t.id = $1
         AND t.user_id = $2
         AND t.status = 'posted'
         AND t.tweet_id IS NOT NULL
         ${scopeClause}
       LIMIT 1`,
      queryParams
    );

    if (!tweetResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Tweet not found in current analytics scope',
        code: 'TWEET_NOT_FOUND',
      });
    }

    const tweet = tweetResult.rows[0];
    const twitterClient = new TwitterApi(req.twitterAccount.access_token);

    let lookup;
    try {
      lookup = await twitterClient.v2.tweets([String(tweet.tweet_id)], {
        'tweet.fields': ['public_metrics', 'created_at'],
      });
    } catch (lookupError) {
      if (isRateLimitError(lookupError)) {
        const { resetTimestamp, waitMinutes } = getRateLimitResetInfo(lookupError);
        return res.status(429).json({
          success: false,
          error: 'Twitter API rate limit exceeded',
          type: 'rate_limit',
          waitMinutes,
          resetTime: new Date(resetTimestamp).toISOString(),
        });
      }
      throw lookupError;
    }

    const dataRows = Array.isArray(lookup?.data) ? lookup.data : [];
    const errorRows = Array.isArray(lookup?.errors) ? lookup.errors : [];
    const row = dataRows.find((item) => String(item?.id || '') === String(tweet.tweet_id));
    const lookupError = errorRows.find((item) => String(item?.resource_id || item?.value || '') === String(tweet.tweet_id));

    if (!row?.public_metrics) {
      const notFound =
        lookupError?.type?.includes('resource-not-found') ||
        String(lookupError?.title || '').toLowerCase().includes('not found');
      if (notFound) {
        await markTweetDeleted(tweet.id);
        await clearAnalyticsCachedPayload({ userId, accountId: effectiveAccountId });
        return res.json({
          success: true,
          changed: true,
          deleted: true,
          message: 'Tweet no longer exists on Twitter and was marked deleted locally.',
          checkedAt: new Date().toISOString(),
        });
      }

      return res.status(422).json({
        success: false,
        error: 'Twitter did not return metrics for this tweet',
        code: 'NO_PUBLIC_METRICS',
      });
    }

    const nextMetrics = {
      impressions: Number(row.public_metrics.impression_count || 0),
      likes: Number(row.public_metrics.like_count || 0),
      retweets: Number(row.public_metrics.retweet_count || 0),
      replies: Number(row.public_metrics.reply_count || 0),
      quote_count: Number(row.public_metrics.quote_count || 0),
      bookmark_count: Number(row.public_metrics.bookmark_count || 0),
    };
    const currentMetrics = {
      impressions: Number(tweet.impressions || 0),
      likes: Number(tweet.likes || 0),
      retweets: Number(tweet.retweets || 0),
      replies: Number(tweet.replies || 0),
      quote_count: Number(tweet.quote_count || 0),
      bookmark_count: Number(tweet.bookmark_count || 0),
    };

    const changed =
      currentMetrics.impressions !== nextMetrics.impressions ||
      currentMetrics.likes !== nextMetrics.likes ||
      currentMetrics.retweets !== nextMetrics.retweets ||
      currentMetrics.replies !== nextMetrics.replies ||
      currentMetrics.quote_count !== nextMetrics.quote_count ||
      currentMetrics.bookmark_count !== nextMetrics.bookmark_count;

    let metricsUpdatedAt = tweet.updated_at ? new Date(tweet.updated_at).toISOString() : null;
    if (changed) {
      const updateResult = await pool.query(
        `UPDATE tweets
         SET impressions = $1,
             likes = $2,
             retweets = $3,
             replies = $4,
             quote_count = $5,
             bookmark_count = $6,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING updated_at`,
        [
          nextMetrics.impressions,
          nextMetrics.likes,
          nextMetrics.retweets,
          nextMetrics.replies,
          nextMetrics.quote_count,
          nextMetrics.bookmark_count,
          tweet.id,
        ]
      );
      metricsUpdatedAt = updateResult.rows?.[0]?.updated_at
        ? new Date(updateResult.rows[0].updated_at).toISOString()
        : new Date().toISOString();
      await clearAnalyticsCachedPayload({ userId, accountId: effectiveAccountId });
    }

    return res.json({
      success: true,
      changed,
      tweetId: tweet.id,
      twitterTweetId: String(tweet.tweet_id),
      before: currentMetrics,
      after: nextMetrics,
      checkedAt: new Date().toISOString(),
      metricsUpdatedAt,
      message: changed ? 'Metrics updated from Twitter.' : 'Checked Twitter: metrics unchanged.',
    });
  } catch (error) {
    console.error('[analytics/tweet-refresh] error:', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh tweet metrics',
      message: error?.message || 'Unknown error',
    });
  }
});

// Debug route to check what Twitter tokens are available for the user
router.get('/debug-tokens', validateTwitterConnection, async (req, res) => {
  const twitterAccount = req.twitterAccount;
  res.json({
    tokenTypes: {
      oauth2_access: !!twitterAccount.access_token,
      oauth1_access: !!twitterAccount.oauth1_access_token,
      oauth1_secret: !!twitterAccount.oauth1_access_token_secret,
    },
    tokenLengths: {
      oauth2: twitterAccount.access_token?.length,
      oauth1: twitterAccount.oauth1_access_token?.length,
    }
  });
});

// Get detailed engagement insights
router.get('/engagement', authenticateToken, async (req, res) => {
  try {
    await ensureTweetAnalyticsColumns();

    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 50;
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });

    if (!twitterScope.connected && twitterScope.mode === 'personal') {
      return res.json({
        disconnected: true,
        engagement_patterns: [],
        optimal_times: [],
        content_insights: [],
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const engagementCacheKey = buildAnalyticsCacheKey({
      endpoint: 'engagement',
      userId,
      days,
      scope: twitterScope,
    });
    const cached = await getAnalyticsCachedPayload({ cacheKey: engagementCacheKey });
    if (cached?.payload) {
      return res.json({
        ...cached.payload,
        cached: true,
        computedAt: cached.computed_at,
      });
    }

    const buildScopedStatement = (baseSql, baseParams, alias = '') => {
      const { clause, params } = buildTwitterScopeFilter({
        scope: twitterScope,
        alias,
        startIndex: baseParams.length + 1,
        includeLegacyPersonalFallback: true,
        includeTeamOrphanFallback: true,
        orphanUserId: userId,
      });

      return {
        sql: injectScopeClause(baseSql, clause),
        params: [...baseParams, ...params],
      };
    };

    const warnings = [];
    const runQueryWithFallback = async ({ label, statement, fallback = [] }) => {
      try {
        const { rows } = await pool.query(statement.sql, statement.params);
        return rows;
      } catch (queryError) {
        warnings.push(label);
        console.error(`[analytics/engagement] ${label} query failed`, {
          message: queryError?.message,
          code: queryError?.code,
        });
        return fallback;
      }
    };

    // Get engagement patterns by content type
    const engagementPatternsStatement = buildScopedStatement(
      `SELECT 
        CASE 
          WHEN content LIKE '%#%' THEN 'with_hashtags'
          ELSE 'no_hashtags'
        END as hashtag_usage,
        ${THREAD_BUCKET_SQL} as content_type,
        CASE 
          WHEN LENGTH(content) <= 100 THEN 'short'
          WHEN LENGTH(content) <= 200 THEN 'medium'
          ELSE 'long'
        END as content_length,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        AVG(${ANALYTICS_ENGAGEMENT_SQL}) as avg_total_engagement,
        CASE WHEN AVG(impressions) > 0 THEN 
          ROUND((AVG(${ANALYTICS_ENGAGEMENT_SQL}) / AVG(impressions)) * 100, 2) 
        ELSE 0 END as avg_engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
       GROUP BY hashtag_usage, content_type, content_length
       ORDER BY avg_total_engagement DESC`,
      [userId, startDate]
    );
    const engagementPatterns = await runQueryWithFallback({
      label: 'engagement_patterns',
      statement: engagementPatternsStatement,
      fallback: [],
    });

    // Get best performing times
    const timeAnalysisStatement = buildScopedStatement(
      `SELECT 
        EXTRACT(DOW FROM ${ANALYTICS_EVENT_TS_SQL}) as day_of_week,
        EXTRACT(HOUR FROM ${ANALYTICS_EVENT_TS_SQL}) as hour_of_day,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(${ANALYTICS_ENGAGEMENT_SQL}) as avg_engagement,
        CASE WHEN AVG(impressions) > 0 THEN 
          ROUND((AVG(${ANALYTICS_ENGAGEMENT_SQL}) / AVG(impressions)) * 100, 2) 
        ELSE 0 END as avg_engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
       GROUP BY EXTRACT(DOW FROM ${ANALYTICS_EVENT_TS_SQL}), EXTRACT(HOUR FROM ${ANALYTICS_EVENT_TS_SQL})
       ORDER BY avg_engagement DESC, tweets_count DESC
       LIMIT 20`,
      [userId, startDate]
    );
    const timeAnalysis = await runQueryWithFallback({
      label: 'optimal_times',
      statement: timeAnalysisStatement,
      fallback: [],
    });

    // Get content performance insights
    const contentInsightsStatement = buildScopedStatement(
      `SELECT 
        'hashtag_performance' as insight_type,
        CASE WHEN content LIKE '%#%' THEN 'with_hashtags' ELSE 'without_hashtags' END as category,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(${ANALYTICS_ENGAGEMENT_SQL}) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
       GROUP BY CASE WHEN content LIKE '%#%' THEN 'with_hashtags' ELSE 'without_hashtags' END
        
       UNION ALL
       
        SELECT 
         'thread_performance' as insight_type,
         CASE WHEN ${THREAD_BUCKET_SQL} = 'thread' THEN 'threads' ELSE 'single_tweets' END as category,
         COUNT(*) as tweets_count,
         AVG(impressions) as avg_impressions,
         AVG(${ANALYTICS_ENGAGEMENT_SQL}) as avg_engagement
        FROM tweets 
        WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
        GROUP BY CASE WHEN ${THREAD_BUCKET_SQL} = 'thread' THEN 'threads' ELSE 'single_tweets' END`,
      [userId, startDate]
    );
    const contentInsights = await runQueryWithFallback({
      label: 'content_insights',
      statement: contentInsightsStatement,
      fallback: [],
    });

    const responsePayload = {
      disconnected: false,
      partial: warnings.length > 0,
      warnings,
      engagement_patterns: engagementPatterns,
      optimal_times: timeAnalysis,
      content_insights: contentInsights
    };

    await setAnalyticsCachedPayload({
      cacheKey: engagementCacheKey,
      userId,
      accountId: normalizeScopeAccountId(twitterScope),
      endpoint: 'engagement',
      days,
      payload: responsePayload,
    });

    res.json(responsePayload);

  } catch (error) {
    console.error('Engagement analytics error:', error);
    res.status(200).json({
      disconnected: false,
      partial: true,
      warnings: ['engagement_route_error'],
      engagement_patterns: [],
      optimal_times: [],
      content_insights: [],
      error: 'Failed to fetch engagement analytics',
    });
  }
});

// Get follower and reach analytics
router.get('/audience', authenticateToken, async (req, res) => {
  try {
    await ensureTweetAnalyticsColumns();

    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 50;
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });

    if (!twitterScope.connected && twitterScope.mode === 'personal') {
      return res.json({
        disconnected: true,
        reach_metrics: [],
        engagement_distribution: [],
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const audienceCacheKey = buildAnalyticsCacheKey({
      endpoint: 'audience',
      userId,
      days,
      scope: twitterScope,
    });
    const cached = await getAnalyticsCachedPayload({ cacheKey: audienceCacheKey });
    if (cached?.payload) {
      return res.json({
        ...cached.payload,
        cached: true,
        computedAt: cached.computed_at,
      });
    }

    const buildScopedStatement = (baseSql, baseParams, alias = '') => {
      const { clause, params } = buildTwitterScopeFilter({
        scope: twitterScope,
        alias,
        startIndex: baseParams.length + 1,
        includeLegacyPersonalFallback: true,
        includeTeamOrphanFallback: true,
        orphanUserId: userId,
      });

      return {
        sql: injectScopeClause(baseSql, clause),
        params: [...baseParams, ...params],
      };
    };

    const warnings = [];
    const runQueryWithFallback = async ({ label, statement, fallback = [] }) => {
      try {
        const { rows } = await pool.query(statement.sql, statement.params);
        return rows;
      } catch (queryError) {
        warnings.push(label);
        console.error(`[analytics/audience] ${label} query failed`, {
          message: queryError?.message,
          code: queryError?.code,
        });
        return fallback;
      }
    };

    // Get reach and impression distribution
    const reachMetricsStatement = buildScopedStatement(
      `SELECT 
        DATE(${ANALYTICS_EVENT_TS_SQL}) as date,
        SUM(impressions) as total_impressions,
        SUM(${ANALYTICS_ENGAGEMENT_SQL}) as total_engagement,
        COUNT(DISTINCT CASE WHEN impressions > 0 THEN id END) as tweets_with_impressions,
        AVG(impressions) as avg_impressions_per_tweet,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY impressions) as median_impressions,
        MAX(impressions) as max_impressions,
        MIN(impressions) as min_impressions
       FROM tweets 
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
       GROUP BY DATE(${ANALYTICS_EVENT_TS_SQL})
       ORDER BY date DESC`,
      [userId, startDate]
    );
    const reachMetrics = await runQueryWithFallback({
      label: 'reach_metrics',
      statement: reachMetricsStatement,
      fallback: [],
    });

    // Get engagement distribution
    const engagementDistributionStatement = buildScopedStatement(
      `SELECT 
        CASE 
          WHEN impressions = 0 THEN 'no_impressions'
          WHEN impressions < 100 THEN 'low_reach'
          WHEN impressions < 1000 THEN 'medium_reach'
          WHEN impressions < 10000 THEN 'high_reach'
          ELSE 'viral_reach'
        END as reach_category,
        COUNT(*) as tweets_count,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        AVG(impressions) as avg_impressions,
        AVG(${ANALYTICS_ENGAGEMENT_SQL}) as avg_total_engagement
       FROM tweets 
       WHERE user_id = $1 AND ${ANALYTICS_EVENT_TS_SQL} >= $2 AND status = 'posted'
       GROUP BY reach_category
       ORDER BY avg_impressions DESC`,
      [userId, startDate]
    );
    const engagementDistribution = await runQueryWithFallback({
      label: 'engagement_distribution',
      statement: engagementDistributionStatement,
      fallback: [],
    });

    const responsePayload = {
      disconnected: false,
      partial: warnings.length > 0,
      warnings,
      reach_metrics: reachMetrics,
      engagement_distribution: engagementDistribution
    };

    await setAnalyticsCachedPayload({
      cacheKey: audienceCacheKey,
      userId,
      accountId: normalizeScopeAccountId(twitterScope),
      endpoint: 'audience',
      days,
      payload: responsePayload,
    });

    res.json(responsePayload);

  } catch (error) {
    console.error('Audience analytics error:', error);
    res.status(200).json({
      disconnected: false,
      partial: true,
      warnings: ['audience_route_error'],
      reach_metrics: [],
      engagement_distribution: [],
      error: 'Failed to fetch audience analytics',
    });
  }
});

export default router;



