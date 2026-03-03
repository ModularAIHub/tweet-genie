import dotenv from 'dotenv';
import pool from '../config/database.js';
import { markTweetDeleted } from '../services/tweetRetentionService.js';
import {
  createTwitterReadClient,
  refreshTwitterOauth2IfNeeded,
} from '../utils/twitterRuntimeAuth.js';

dotenv.config();

const ANALYTICS_AUTO_SYNC_ENABLED = process.env.ANALYTICS_AUTO_SYNC_ENABLED !== 'false';
const ANALYTICS_AUTO_SYNC_INTERVAL_MS = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_INTERVAL_MS || '300000',
  10
);
const ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS || '30000',
  10
);
const ANALYTICS_AUTO_SYNC_USER_BATCH = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_USER_BATCH || '5',
  10
);
const ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT || '12',
  10
);
const ANALYTICS_AUTO_SYNC_FORCE_REFRESH_COUNT = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_FORCE_REFRESH_COUNT || '3',
  10
);
const ANALYTICS_AUTO_SYNC_DEBUG = process.env.ANALYTICS_AUTO_SYNC_DEBUG === 'true';
const ANALYTICS_AUTO_SYNC_HOT_WINDOW_HOURS = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_HOT_WINDOW_HOURS || '2',
  10
);
const ANALYTICS_AUTO_SYNC_WARM_WINDOW_HOURS = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_WARM_WINDOW_HOURS || '24',
  10
);
const ANALYTICS_AUTO_SYNC_COOL_WINDOW_HOURS = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_COOL_WINDOW_HOURS || String(7 * 24),
  10
);
const ANALYTICS_AUTO_SYNC_HOT_STALE_MINUTES = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_HOT_STALE_MINUTES || '2',
  10
);
const ANALYTICS_AUTO_SYNC_WARM_STALE_MINUTES = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_WARM_STALE_MINUTES || '8',
  10
);
const ANALYTICS_AUTO_SYNC_COOL_STALE_MINUTES = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_COOL_STALE_MINUTES || '120',
  10
);
const ANALYTICS_AUTO_SYNC_COLD_STALE_MINUTES = Number.parseInt(
  process.env.ANALYTICS_AUTO_SYNC_COLD_STALE_MINUTES || '720',
  10
);

const SYNC_COOLDOWN_MS = Number(process.env.ANALYTICS_SYNC_COOLDOWN_MS || 3 * 60 * 1000);
const SYNC_LOOKBACK_DAYS = Number(process.env.ANALYTICS_SYNC_LOOKBACK_DAYS || 50);
const SYNC_LOCK_STALE_MS = Number(process.env.ANALYTICS_SYNC_LOCK_STALE_MS || 20 * 60 * 1000);

let analyticsSyncStateReady = false;
let analyticsAutoSyncInterval = null;
let analyticsAutoSyncBootstrapTimer = null;
let analyticsAutoSyncInFlight = false;
let analyticsAutoSyncLastRun = {
  startedAt: null,
  finishedAt: null,
  usersScanned: 0,
  usersSynced: 0,
  tweetsUpdated: 0,
  rateLimited: false,
  error: null,
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const getSyncKey = (userId, accountId) => `${userId}:${accountId || 'personal'}`;
const toPositiveInt = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const getAdaptivePolicy = () => {
  const hotWindowHours = toPositiveInt(ANALYTICS_AUTO_SYNC_HOT_WINDOW_HOURS, 2);
  const warmWindowHours = Math.max(hotWindowHours + 1, toPositiveInt(ANALYTICS_AUTO_SYNC_WARM_WINDOW_HOURS, 24));
  const coolWindowHours = Math.max(warmWindowHours + 1, toPositiveInt(ANALYTICS_AUTO_SYNC_COOL_WINDOW_HOURS, 168));

  return {
    hotWindowHours,
    warmWindowHours,
    coolWindowHours,
    hotStaleMinutes: toPositiveInt(ANALYTICS_AUTO_SYNC_HOT_STALE_MINUTES, 3),
    warmStaleMinutes: toPositiveInt(ANALYTICS_AUTO_SYNC_WARM_STALE_MINUTES, 15),
    coolStaleMinutes: toPositiveInt(ANALYTICS_AUTO_SYNC_COOL_STALE_MINUTES, 120),
    coldStaleMinutes: toPositiveInt(ANALYTICS_AUTO_SYNC_COLD_STALE_MINUTES, 720),
  };
};

const log = (...args) => {
  if (ANALYTICS_AUTO_SYNC_DEBUG) {
    console.log('[AnalyticsAutoSync]', ...args);
  }
};

const toTimestamp = (value) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_analytics_sync_state_user_account
      ON analytics_sync_state(user_id, account_id)
  `);

  analyticsSyncStateReady = true;
};

const setSyncState = async (syncKey, { userId, accountId = null, patch = {} }) => {
  await ensureAnalyticsSyncStateTable();

  await pool.query(
    `INSERT INTO analytics_sync_state (sync_key, user_id, account_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (sync_key) DO NOTHING`,
    [syncKey, userId, accountId]
  );

  const values = [syncKey, userId];
  const assignments = ['user_id = $2'];

  if (accountId) {
    values.push(accountId);
    assignments.push(`account_id = $${values.length}`);
  } else {
    assignments.push('account_id = NULL');
  }

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

  await pool.query(
    `UPDATE analytics_sync_state
     SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE sync_key = $1`,
    values
  );
};

const acquireSyncLock = async ({ syncKey, userId, accountId = null }) => {
  await ensureAnalyticsSyncStateTable();
  const staleBefore = new Date(Date.now() - SYNC_LOCK_STALE_MS);

  const { rows } = await pool.query(
    `INSERT INTO analytics_sync_state (
       sync_key, user_id, account_id, in_progress, started_at, last_result, updated_at
     )
     VALUES ($1, $2, $4, true, CURRENT_TIMESTAMP, 'running', CURRENT_TIMESTAMP)
     ON CONFLICT (sync_key) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           account_id = EXCLUDED.account_id,
           in_progress = true,
           started_at = CURRENT_TIMESTAMP,
           last_result = 'running',
           updated_at = CURRENT_TIMESTAMP
     WHERE analytics_sync_state.in_progress = false
        OR analytics_sync_state.started_at IS NULL
        OR analytics_sync_state.started_at < $3
     RETURNING sync_key`,
    [syncKey, userId, staleBefore, accountId]
  );

  return rows.length > 0;
};

const isRateLimitError = (error) => {
  const status = error?.code || error?.status || error?.response?.status;
  if (status === 429 || status === '429') return true;
  return String(error?.message || '').toLowerCase().includes('rate limit');
};

const isTwitterAuthError = (error) => {
  const status = error?.code || error?.status || error?.response?.status || error?.statusCode;
  if (status === 401 || status === '401' || status === 403 || status === '403') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden') || message.includes('invalid token') || message.includes('token has been revoked');
};

const getRateLimitResetInfo = (error) => {
  const fallbackTimestamp = Date.now() + 15 * 60 * 1000;
  const candidates = [
    error?.rateLimit?.reset ? Number(error.rateLimit.reset) * 1000 : null,
    error?.headers?.['x-rate-limit-reset'] ? Number(error.headers['x-rate-limit-reset']) * 1000 : null,
    error?.response?.headers?.['x-rate-limit-reset']
      ? Number(error.response.headers['x-rate-limit-reset']) * 1000
      : null,
  ].filter((value) => Number.isFinite(value) && value > Date.now());

  const resetTimestamp = candidates.length > 0 ? candidates[0] : fallbackTimestamp;
  const waitMinutes = Math.max(1, Math.ceil((resetTimestamp - Date.now()) / 60000));
  return { resetTimestamp, waitMinutes };
};

const refreshTwitterTokenIfNeeded = async (account, { accountType = 'personal', force = false } = {}) => {
  if (!account?.access_token) {
    return account;
  }

  const refreshResult = await refreshTwitterOauth2IfNeeded({
    dbPool: pool,
    account,
    accountType,
    force,
    reason: force ? 'analytics-auto-sync-force-retry' : 'analytics-auto-sync',
    onLog: (...args) => log(...args),
  });

  if (refreshResult.error) {
    log('Token refresh failed', {
      userId: account.user_id,
      accountId: account.id,
      message: refreshResult.error.details || refreshResult.error.reason,
    });
  }

  return refreshResult.account || account;
};

const getEligibleAccounts = async () => {
  await ensureAnalyticsSyncStateTable();

  const userBatch = Number.isFinite(ANALYTICS_AUTO_SYNC_USER_BATCH) && ANALYTICS_AUTO_SYNC_USER_BATCH > 0
    ? ANALYTICS_AUTO_SYNC_USER_BATCH
    : 10;

  const lookbackDays = Number.isFinite(SYNC_LOOKBACK_DAYS) && SYNC_LOOKBACK_DAYS > 0 ? SYNC_LOOKBACK_DAYS : 50;

  const { rows } = await pool.query(
    `WITH ranked_auth AS (
       SELECT
         ta.id,
         ta.user_id,
         ta.access_token,
         ta.refresh_token,
         ta.token_expires_at,
         ta.twitter_user_id,
         ROW_NUMBER() OVER (
           PARTITION BY ta.user_id
           ORDER BY ta.updated_at DESC NULLS LAST, ta.created_at DESC NULLS LAST, ta.id DESC
         ) AS rn
       FROM twitter_auth ta
       WHERE ta.access_token IS NOT NULL
         AND ta.twitter_user_id IS NOT NULL
     )
     SELECT
       ta.id,
       ta.user_id,
       ta.access_token,
       ta.refresh_token,
       ta.token_expires_at,
       ta.twitter_user_id
     FROM ranked_auth ta
     LEFT JOIN analytics_sync_state ass
       ON ass.sync_key = ta.user_id || ':personal'
     WHERE ta.rn = 1
       AND COALESCE(ass.in_progress, false) = false
       AND (ass.next_allowed_at IS NULL OR ass.next_allowed_at <= CURRENT_TIMESTAMP)
       AND EXISTS (
         SELECT 1
         FROM tweets t
         WHERE t.user_id = ta.user_id
           AND (t.account_id IS NULL OR t.account_id::text = '0')
           AND t.status = 'posted'
           AND t.tweet_id IS NOT NULL
           AND COALESCE(t.external_created_at, t.created_at) >= NOW() - ($1::int * INTERVAL '1 day')
       )
     ORDER BY COALESCE(ass.last_sync_at, TO_TIMESTAMP(0)) ASC
     LIMIT $2`,
    [lookbackDays, userBatch]
  );

  return rows;
};

const getEligibleTeamAccounts = async () => {
  await ensureAnalyticsSyncStateTable();

  const userBatch = Number.isFinite(ANALYTICS_AUTO_SYNC_USER_BATCH) && ANALYTICS_AUTO_SYNC_USER_BATCH > 0
    ? ANALYTICS_AUTO_SYNC_USER_BATCH
    : 10;
  const lookbackDays = Number.isFinite(SYNC_LOOKBACK_DAYS) && SYNC_LOOKBACK_DAYS > 0 ? SYNC_LOOKBACK_DAYS : 50;

  const { rows } = await pool.query(
    `SELECT
       ta.team_id,
       ta.user_id,
       ta.twitter_user_id,
       ta.access_token,
       ta.refresh_token,
       ta.token_expires_at,
       ta.team_id || ':' || ta.twitter_user_id AS account_key
     FROM team_accounts ta
     WHERE ta.access_token IS NOT NULL
       AND ta.twitter_user_id IS NOT NULL
       AND ta.active = true
     AND NOT EXISTS (
       SELECT 1 FROM analytics_sync_state ass
       WHERE ass.sync_key = ta.user_id || ':' || ta.team_id || ':' || ta.twitter_user_id
         AND (
           ass.in_progress = true
           OR (ass.next_allowed_at IS NOT NULL AND ass.next_allowed_at > CURRENT_TIMESTAMP)
         )
     )
     AND EXISTS (
       SELECT 1
       FROM tweets t
       WHERE t.user_id = ta.user_id
         AND t.account_id IS NOT NULL
         AND t.account_id::text != '0'
         AND t.status = 'posted'
         AND t.tweet_id IS NOT NULL
         AND COALESCE(t.external_created_at, t.created_at) >= NOW() - ($1::int * INTERVAL '1 day')
     )
     ORDER BY ta.updated_at ASC NULLS FIRST
     LIMIT $2`,
    [lookbackDays, userBatch]
  );

  return rows;
};

const getCandidatesForTeamAccount = async ({ userId, accountId, twitterUserId }) => {
  const candidateLimit = Number.isFinite(ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT) && ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT > 0
    ? ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT
    : 10;
  const lookbackDays = Number.isFinite(SYNC_LOOKBACK_DAYS) && SYNC_LOOKBACK_DAYS > 0 ? SYNC_LOOKBACK_DAYS : 50;
  const {
    hotWindowHours,
    warmWindowHours,
    coolWindowHours,
    hotStaleMinutes,
    warmStaleMinutes,
    coolStaleMinutes,
    coldStaleMinutes,
  } = getAdaptivePolicy();
  const forceRefreshCount = Math.min(
    candidateLimit,
    Math.max(1, Number.isFinite(ANALYTICS_AUTO_SYNC_FORCE_REFRESH_COUNT) ? ANALYTICS_AUTO_SYNC_FORCE_REFRESH_COUNT : 5)
  );

  // For team accounts, we look for tweets that have a non-null account_id (team tweets)
  // We don't filter by specific account_id to catch all tweets posted under this user's team accounts
  const { rows } = await pool.query(
    `
      WITH scoped_tweets AS (
        SELECT
          id,
          tweet_id,
          created_at,
          external_created_at,
          updated_at,
          impressions,
          COALESCE(external_created_at, created_at) AS sort_ts,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(external_created_at, created_at))) / 3600.0 AS age_hours
        FROM tweets
        WHERE user_id = $1
          AND account_id IS NOT NULL
          AND account_id::text != '0'
          AND (author_id = $2 OR (author_id IS NULL AND user_id = $1))
          AND status = 'posted'
          AND tweet_id IS NOT NULL
          AND COALESCE(external_created_at, created_at) >= NOW() - ($3::int * INTERVAL '1 day')
      ),
      force_candidates AS (
        SELECT id, tweet_id, sort_ts
        FROM scoped_tweets
        ORDER BY sort_ts DESC
        LIMIT $4
      ),
      adaptive_candidates AS (
        SELECT
          id,
          tweet_id,
          sort_ts,
          CASE
            WHEN age_hours <= $5 THEN 1
            WHEN age_hours <= $6 THEN 2
            WHEN age_hours <= $7 THEN 3
            ELSE 4
          END AS priority_bucket
        FROM scoped_tweets
        WHERE
          (
            age_hours <= $5
            AND (updated_at IS NULL OR updated_at < NOW() - ($8::int * INTERVAL '1 minute'))
          )
          OR (
            age_hours > $5
            AND age_hours <= $6
            AND (updated_at IS NULL OR updated_at < NOW() - ($9::int * INTERVAL '1 minute'))
          )
          OR (
            age_hours > $6
            AND age_hours <= $7
            AND (updated_at IS NULL OR updated_at < NOW() - ($10::int * INTERVAL '1 minute'))
          )
          OR (
            age_hours > $7
            AND (
              impressions IS NULL
              OR impressions = 0
              OR updated_at IS NULL
              OR updated_at < NOW() - ($11::int * INTERVAL '1 minute')
            )
          )
      ),
      ordered_adaptive AS (
        SELECT id, tweet_id, sort_ts
        FROM adaptive_candidates
        ORDER BY priority_bucket ASC, sort_ts DESC
        LIMIT $12
      ),
      combined_candidates AS (
        SELECT id, tweet_id, sort_ts FROM force_candidates
        UNION ALL
        SELECT id, tweet_id, sort_ts FROM ordered_adaptive
      )
      SELECT id, tweet_id
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_ts DESC) AS rn
        FROM combined_candidates
      ) deduped
      WHERE rn = 1
      ORDER BY sort_ts DESC
      LIMIT $12
    `,
    [
      userId,
      String(twitterUserId),
      lookbackDays,
      forceRefreshCount,
      hotWindowHours,
      warmWindowHours,
      coolWindowHours,
      hotStaleMinutes,
      warmStaleMinutes,
      coolStaleMinutes,
      coldStaleMinutes,
      candidateLimit,
    ]
  );

  log('team candidate selection', {
    userId,
    accountId,
    total: rows?.length || 0,
    limit: candidateLimit,
    forceRefreshCount,
  });

  return rows || [];
};

const getCandidatesForUser = async ({ userId, twitterUserId }) => {
  const candidateLimit = Number.isFinite(ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT) && ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT > 0
    ? ANALYTICS_AUTO_SYNC_CANDIDATE_LIMIT
    : 10;
  const lookbackDays = Number.isFinite(SYNC_LOOKBACK_DAYS) && SYNC_LOOKBACK_DAYS > 0 ? SYNC_LOOKBACK_DAYS : 50;
  const {
    hotWindowHours,
    warmWindowHours,
    coolWindowHours,
    hotStaleMinutes,
    warmStaleMinutes,
    coolStaleMinutes,
    coldStaleMinutes,
  } = getAdaptivePolicy();
  const forceRefreshCount = Math.min(
    candidateLimit,
    Math.max(1, Number.isFinite(ANALYTICS_AUTO_SYNC_FORCE_REFRESH_COUNT) ? ANALYTICS_AUTO_SYNC_FORCE_REFRESH_COUNT : 5)
  );

  const { rows } = await pool.query(
    `
      WITH scoped_tweets AS (
        SELECT
          id,
          tweet_id,
          created_at,
          external_created_at,
          updated_at,
          impressions,
          COALESCE(external_created_at, created_at) AS sort_ts
          ,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(external_created_at, created_at))) / 3600.0 AS age_hours
        FROM tweets
        WHERE user_id = $1
          AND (account_id IS NULL OR account_id::text = '0')
          AND (author_id = $2 OR (author_id IS NULL AND user_id = $1))
          AND status = 'posted'
          AND tweet_id IS NOT NULL
          AND COALESCE(external_created_at, created_at) >= NOW() - ($3::int * INTERVAL '1 day')
      ),
      force_candidates AS (
        SELECT id, tweet_id, sort_ts
        FROM scoped_tweets
        ORDER BY sort_ts DESC
        LIMIT $4
      ),
      adaptive_candidates AS (
        SELECT
          id,
          tweet_id,
          sort_ts,
          CASE
            WHEN age_hours <= $5 THEN 1
            WHEN age_hours <= $6 THEN 2
            WHEN age_hours <= $7 THEN 3
            ELSE 4
          END AS priority_bucket
        FROM scoped_tweets
        WHERE
          (
            age_hours <= $5
            AND (updated_at IS NULL OR updated_at < NOW() - ($8::int * INTERVAL '1 minute'))
          )
          OR (
            age_hours > $5
            AND age_hours <= $6
            AND (updated_at IS NULL OR updated_at < NOW() - ($9::int * INTERVAL '1 minute'))
          )
          OR (
            age_hours > $6
            AND age_hours <= $7
            AND (updated_at IS NULL OR updated_at < NOW() - ($10::int * INTERVAL '1 minute'))
          )
          OR (
            age_hours > $7
            AND (
              impressions IS NULL
              OR impressions = 0
              OR updated_at IS NULL
              OR updated_at < NOW() - ($11::int * INTERVAL '1 minute')
            )
          )
      ),
      ordered_adaptive AS (
        SELECT id, tweet_id, sort_ts
        FROM adaptive_candidates
        ORDER BY priority_bucket ASC, sort_ts DESC
        LIMIT $12
      ),
      combined_candidates AS (
        SELECT id, tweet_id, sort_ts FROM force_candidates
        UNION ALL
        SELECT id, tweet_id, sort_ts FROM ordered_adaptive
      )
      SELECT id, tweet_id
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_ts DESC) AS rn
        FROM combined_candidates
      ) deduped
      WHERE rn = 1
      ORDER BY sort_ts DESC
      LIMIT $12
    `,
    [
      userId,
      String(twitterUserId),
      lookbackDays,
      forceRefreshCount,
      hotWindowHours,
      warmWindowHours,
      coolWindowHours,
      hotStaleMinutes,
      warmStaleMinutes,
      coolStaleMinutes,
      coldStaleMinutes,
      candidateLimit,
    ]
  );

  log('candidate selection', {
    userId,
    total: rows?.length || 0,
    limit: candidateLimit,
    forceRefreshCount,
    policy: {
      hotWindowHours,
      warmWindowHours,
      coolWindowHours,
      hotStaleMinutes,
      warmStaleMinutes,
      coolStaleMinutes,
      coldStaleMinutes,
    },
  });

  return rows || [];
};

const updateTweetMetrics = async (tweetIdMap, tweetErrors) => {
  let updates = 0;
  let errors = 0;

  for (const [dbId, payload] of tweetIdMap.entries()) {
    await pool.query(
      `UPDATE tweets SET
         impressions = $1,
         likes = $2,
         retweets = $3,
         replies = $4,
         quote_count = $5,
         bookmark_count = $6,
         analytics_fetched_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [
        payload.impression_count || 0,
        payload.like_count || 0,
        payload.retweet_count || 0,
        payload.reply_count || 0,
        payload.quote_count || 0,
        payload.bookmark_count || 0,
        dbId,
      ]
    );
    updates += 1;
  }

  for (const [dbId, errInfo] of tweetErrors.entries()) {
    const isNotFound =
      errInfo?.type?.includes('resource-not-found') ||
      String(errInfo?.title || '').toLowerCase().includes('not found');
    if (isNotFound) {
      await markTweetDeleted(dbId);
    } else {
      errors += 1;
    }
  }

  return { updates, errors };
};

const syncAccountMetrics = async (account, { accountType = 'personal', accountId = null } = {}) => {
  const userId = account.user_id;
  const syncKey = getSyncKey(userId, accountId);
  let lockOwned = false;

  try {
    const lockAcquired = await acquireSyncLock({ syncKey, userId, accountId });
    if (!lockAcquired) {
      return { synced: false, reason: 'lock_unavailable', updates: 0, rateLimited: false };
    }
    lockOwned = true;

    let refreshedAccount = await refreshTwitterTokenIfNeeded(account, { accountType });
    if (!refreshedAccount?.access_token) {
      const completedAt = Date.now();
      await setSyncState(syncKey, {
        userId,
        accountId,
        patch: {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
          lastResult: 'auth_error',
        },
      });
      return { synced: false, reason: 'missing_access_token', updates: 0, rateLimited: false };
    }

    const candidates = accountType === 'team'
      ? await getCandidatesForTeamAccount({ userId, accountId, twitterUserId: refreshedAccount.twitter_user_id })
      : await getCandidatesForUser({ userId, twitterUserId: refreshedAccount.twitter_user_id });

    if (candidates.length === 0) {
      const completedAt = Date.now();
      await setSyncState(syncKey, {
        userId,
        accountId,
        patch: {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
          lastResult: 'noop',
        },
      });
      return { synced: true, reason: 'noop', updates: 0, rateLimited: false };
    }

    const tweetIds = candidates.map((tweet) => String(tweet.tweet_id)).filter(Boolean);
    if (tweetIds.length === 0) {
      const completedAt = Date.now();
      await setSyncState(syncKey, {
        userId,
        accountId,
        patch: {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
          lastResult: 'noop',
        },
      });
      return { synced: true, reason: 'noop', updates: 0, rateLimited: false };
    }

    let twitterClient = createTwitterReadClient(refreshedAccount);
    if (!twitterClient) {
      throw new Error('Twitter auth unavailable for analytics sync');
    }
    let lookup;
    let tokenRefreshedForRetry = false;
    try {
      lookup = await twitterClient.v2.tweets(tweetIds, {
        'tweet.fields': ['public_metrics', 'created_at'],
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        const { resetTimestamp } = getRateLimitResetInfo(error);
        const completedAt = Date.now();
        await setSyncState(syncKey, {
          userId,
          accountId,
          patch: {
            inProgress: false,
            lastSyncAt: completedAt,
            nextAllowedAt: Math.max(resetTimestamp, completedAt + SYNC_COOLDOWN_MS),
            lastResult: 'rate_limited',
          },
        });
        return { synced: false, reason: 'rate_limited', updates: 0, rateLimited: true };
      }

      if (isTwitterAuthError(error) && !tokenRefreshedForRetry) {
        log('Twitter 401 during auto-sync — attempting force token refresh', {
          userId,
          accountId,
          status: error?.code || error?.status,
          message: error?.message,
        });
        try {
          const retryRefreshResult = await refreshTwitterOauth2IfNeeded({
            dbPool: pool,
            account: refreshedAccount,
            accountType,
            force: true,
            reason: 'analytics-auto-sync-401-retry',
            onLog: (...args) => log(...args),
          });
          if (retryRefreshResult.refreshed && retryRefreshResult.account) {
            log('Token force-refresh successful — retrying lookup', { userId, accountId });
            refreshedAccount = retryRefreshResult.account;
            twitterClient = createTwitterReadClient(refreshedAccount);
            tokenRefreshedForRetry = true;
            if (twitterClient) {
              try {
                lookup = await twitterClient.v2.tweets(tweetIds, {
                  'tweet.fields': ['public_metrics', 'created_at'],
                });
              } catch (retryErr) {
                log('Retry after force-refresh also failed', {
                  userId,
                  accountId,
                  message: retryErr?.message,
                });
                throw retryErr;
              }
            } else {
              throw new Error('Could not create Twitter client after force-refresh');
            }
          } else {
            log('Force-refresh did not produce a new token — marking auth_error', { userId, accountId });
            const completedAt = Date.now();
            await setSyncState(syncKey, {
              userId,
              accountId,
              patch: {
                inProgress: false,
                lastSyncAt: completedAt,
                nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
                lastResult: 'auth_error',
              },
            });
            return { synced: false, reason: 'auth_error', updates: 0, rateLimited: false };
          }
        } catch (refreshErr) {
          log('Token force-refresh threw during 401 recovery', {
            userId,
            accountId,
            message: refreshErr?.message,
          });
          throw refreshErr;
        }
      } else {
        throw error;
      }
    }

    const dataRows = Array.isArray(lookup?.data) ? lookup.data : [];
    const lookupErrors = Array.isArray(lookup?.errors) ? lookup.errors : [];
    const byTwitterId = new Map(dataRows.map((row) => [String(row.id), row.public_metrics]));
    const errorByTwitterId = new Map(
      lookupErrors
        .filter((item) => item?.resource_id || item?.value)
        .map((item) => [String(item.resource_id || item.value), item])
    );

    const dbUpdates = new Map();
    const dbErrors = new Map();
    for (const candidate of candidates) {
      const metrics = byTwitterId.get(String(candidate.tweet_id));
      if (metrics) {
        dbUpdates.set(candidate.id, metrics);
      } else if (errorByTwitterId.has(String(candidate.tweet_id))) {
        dbErrors.set(candidate.id, errorByTwitterId.get(String(candidate.tweet_id)));
      }
    }

    const { updates, errors } = await updateTweetMetrics(dbUpdates, dbErrors);
    const completedAt = Date.now();
    await setSyncState(syncKey, {
      userId,
      accountId,
      patch: {
        inProgress: false,
        lastSyncAt: completedAt,
        nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
        lastResult: errors > 0 ? 'completed_with_errors' : 'completed',
      },
    });

    return { synced: true, reason: 'completed', updates, rateLimited: false };
  } catch (error) {
    const completedAt = Date.now();
    try {
      await setSyncState(syncKey, {
        userId,
        accountId,
        patch: {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
          lastResult: 'error',
        },
      });
    } catch {
      // no-op
    }
    log('syncAccountMetrics failed', { userId, accountId, accountType, message: error?.message });
    return { synced: false, reason: 'error', updates: 0, rateLimited: false };
  } finally {
    if (lockOwned) {
      try {
        await setSyncState(syncKey, { userId, accountId, patch: { inProgress: false } });
      } catch {
        // no-op
      }
    }
  }
};

const runAnalyticsAutoSyncTick = async () => {
  if (analyticsAutoSyncInFlight) {
    return;
  }

  analyticsAutoSyncInFlight = true;
  const startedAt = new Date();
  let usersScanned = 0;
  let usersSynced = 0;
  let tweetsUpdated = 0;
  let rateLimited = false;
  let errorMessage = null;

  try {
    // --- Personal accounts ---
    const personalAccounts = await getEligibleAccounts();
    usersScanned = personalAccounts.length;
    log(`eligible personal accounts: ${usersScanned}`);

    for (const account of personalAccounts) {
      const result = await syncAccountMetrics(account, { accountType: 'personal' });
      if (result.synced) {
        usersSynced += 1;
      }
      tweetsUpdated += result.updates || 0;

      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
    }

    // --- Team accounts ---
    if (!rateLimited) {
      try {
        const teamAccounts = await getEligibleTeamAccounts();
        const teamCount = teamAccounts.length;
        log(`eligible team accounts: ${teamCount}`);
        usersScanned += teamCount;

        for (const teamAccount of teamAccounts) {
          const teamAccountId = `${teamAccount.team_id}:${teamAccount.twitter_user_id}`;
          const result = await syncAccountMetrics(teamAccount, {
            accountType: 'team',
            accountId: teamAccountId,
          });
          if (result.synced) {
            usersSynced += 1;
          }
          tweetsUpdated += result.updates || 0;

          if (result.rateLimited) {
            rateLimited = true;
            break;
          }
        }
      } catch (teamError) {
        // If team_accounts table doesn't exist yet, just skip team sync
        const isTableMissing = String(teamError?.message || '').includes('does not exist')
          || String(teamError?.message || '').includes('relation');
        if (isTableMissing) {
          log('team_accounts table not found, skipping team sync');
        } else {
          throw teamError;
        }
      }
    }
  } catch (error) {
    errorMessage = error?.message || 'unknown_error';
    console.error('[AnalyticsAutoSync] Tick failed:', errorMessage);
  } finally {
    analyticsAutoSyncLastRun = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      usersScanned,
      usersSynced,
      tweetsUpdated,
      rateLimited,
      error: errorMessage,
    };
    analyticsAutoSyncInFlight = false;
  }
};

// Exported so that the Vercel Cron endpoint (and tests) can trigger a tick directly
// without going through the setInterval timer (which doesn't survive Vercel serverless sleep).
export async function triggerAnalyticsSyncTick() {
  await runAnalyticsAutoSyncTick();

  // Phase 5: Process any deferred analytics syncs whose time has arrived
  try {
    const { feedbackLoopService } = await import('../services/feedbackLoopService.js');
    await feedbackLoopService.processDeferredSyncs();
  } catch (deferredErr) {
    console.warn('[AnalyticsAutoSync] Deferred sync processing failed (non-fatal):', deferredErr?.message || deferredErr);
  }

  return analyticsAutoSyncLastRun;
}

export function startAnalyticsAutoSyncWorker() {
  if (!ANALYTICS_AUTO_SYNC_ENABLED) {
    console.warn('[AnalyticsAutoSync] Worker disabled by ANALYTICS_AUTO_SYNC_ENABLED=false');
    return;
  }

  if (analyticsAutoSyncInterval || analyticsAutoSyncBootstrapTimer) {
    return;
  }

  const intervalMs =
    Number.isFinite(ANALYTICS_AUTO_SYNC_INTERVAL_MS) && ANALYTICS_AUTO_SYNC_INTERVAL_MS >= 60000
      ? ANALYTICS_AUTO_SYNC_INTERVAL_MS
      : 300000;
  const initialDelayMs =
    Number.isFinite(ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS) && ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS >= 5000
      ? ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS
      : 20000;

  console.log(
    `[AnalyticsAutoSync] Worker started (interval: ${intervalMs}ms, initial delay: ${initialDelayMs}ms)`
  );

  analyticsAutoSyncBootstrapTimer = setTimeout(async () => {
    analyticsAutoSyncBootstrapTimer = null;
    await runAnalyticsAutoSyncTick();
  }, initialDelayMs);

  analyticsAutoSyncInterval = setInterval(() => {
    runAnalyticsAutoSyncTick().catch((error) => {
      console.error('[AnalyticsAutoSync] Interval tick error:', error?.message || error);
    });
  }, intervalMs);

  if (typeof analyticsAutoSyncInterval.unref === 'function') {
    analyticsAutoSyncInterval.unref();
  }
}

export function stopAnalyticsAutoSyncWorker() {
  if (analyticsAutoSyncBootstrapTimer) {
    clearTimeout(analyticsAutoSyncBootstrapTimer);
    analyticsAutoSyncBootstrapTimer = null;
  }
  if (analyticsAutoSyncInterval) {
    clearInterval(analyticsAutoSyncInterval);
    analyticsAutoSyncInterval = null;
  }
}

export function getAnalyticsAutoSyncStatus() {
  const policy = getAdaptivePolicy();
  return {
    enabled: ANALYTICS_AUTO_SYNC_ENABLED,
    running: Boolean(analyticsAutoSyncInterval || analyticsAutoSyncBootstrapTimer),
    inFlight: analyticsAutoSyncInFlight,
    intervalMs: ANALYTICS_AUTO_SYNC_INTERVAL_MS,
    policy,
    lastRun: analyticsAutoSyncLastRun,
  };
}

// ─── Inline metrics fetch (serverless-compatible) ─────────────────────────────
// On Vercel serverless, setTimeout/setInterval die when the function finishes.
// Instead, we expose synchronous (awaitable) helpers that callers can invoke
// inline within the same HTTP request before sending the response.

/**
 * Fetch and persist metrics for a batch of tweet IDs in one Twitter API call.
 * Designed to be awaited inline within a request handler (serverless-safe).
 *
 * @param {Object} opts
 * @param {string[]} opts.tweetIds - Twitter tweet IDs to look up
 * @param {string}   opts.userId   - Owner user
 * @param {Object}   opts.account  - Twitter account object with access_token
 * @param {string}   [opts.accountType] - 'personal' or 'team'
 * @returns {Promise<{ updated: number, errors: number }>}
 */
export async function fetchAndPersistMetricsInline({ tweetIds, userId, account, accountType = 'personal' }) {
  if (!tweetIds?.length || !userId || !account?.access_token) {
    return { updated: 0, errors: 0 };
  }

  let result = { updated: 0, errors: 0 };

  try {
    let refreshedAccount = account;
    const refreshResult = await refreshTwitterOauth2IfNeeded({
      dbPool: pool,
      account: refreshedAccount,
      accountType,
      reason: 'inline-metrics-fetch',
      onLog: (...args) => log(...args),
    });
    if (refreshResult.account) {
      refreshedAccount = refreshResult.account;
    }

    const twitterClient = createTwitterReadClient(refreshedAccount);
    if (!twitterClient) {
      log('inline-fetch: no twitter client', { userId });
      return result;
    }

    // Batch lookup (max 100 per call)
    const batches = [];
    for (let i = 0; i < tweetIds.length; i += 100) {
      batches.push(tweetIds.slice(i, i + 100));
    }

    for (const batch of batches) {
      try {
        const lookup = await twitterClient.v2.tweets(batch, {
          'tweet.fields': ['public_metrics', 'created_at'],
        });

        const dataRows = Array.isArray(lookup?.data) ? lookup.data : [];
        for (const row of dataRows) {
          const metrics = row.public_metrics;
          if (!metrics) continue;

          try {
            await pool.query(
              `UPDATE tweets SET
                 impressions = $1,
                 likes = $2,
                 retweets = $3,
                 replies = $4,
                 quote_count = $5,
                 bookmark_count = $6,
                 analytics_fetched_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
               WHERE tweet_id = $7 AND user_id = $8`,
              [
                metrics.impression_count || 0,
                metrics.like_count || 0,
                metrics.retweet_count || 0,
                metrics.reply_count || 0,
                metrics.quote_count || 0,
                metrics.bookmark_count || 0,
                String(row.id),
                userId,
              ]
            );
            result.updated += 1;
          } catch (updateErr) {
            log('inline-fetch: DB update error', { tweetId: row.id, message: updateErr?.message });
            result.errors += 1;
          }
        }

        // Handle deleted / not-found tweets
        const lookupErrors = Array.isArray(lookup?.errors) ? lookup.errors : [];
        for (const errItem of lookupErrors) {
          const isNotFound =
            errItem?.type?.includes('resource-not-found') ||
            String(errItem?.title || '').toLowerCase().includes('not found');
          if (isNotFound) {
            const errorTweetId = errItem?.resource_id || errItem?.value;
            if (errorTweetId) {
              try {
                const { rows: matchRows } = await pool.query(
                  `SELECT id FROM tweets WHERE tweet_id = $1 AND user_id = $2 LIMIT 1`,
                  [String(errorTweetId), userId]
                );
                if (matchRows.length > 0) {
                  await markTweetDeleted(matchRows[0].id);
                }
              } catch {
                // silent
              }
            }
          }
        }
      } catch (batchErr) {
        log('inline-fetch: batch error', { message: batchErr?.message });
        result.errors += batch.length;
      }
    }

    log('inline-fetch: completed', { userId, updated: result.updated, errors: result.errors });
  } catch (err) {
    log('inline-fetch: error', { userId, message: err?.message });
  }

  return result;
}

/**
 * Inline quick-sync for a user: fetch the N most recent hot tweets and refresh
 * their metrics. Safe for serverless — fully awaitable.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} [opts.accountId] - team account ID if applicable
 * @param {number} [opts.limit=5]   - how many hot tweets to refresh
 * @param {Object} opts.account     - twitter auth object
 * @param {string} [opts.accountType='personal']
 * @returns {Promise<{ updated: number, skipped: boolean }>}
 */
export async function inlineQuickSync({ userId, accountId = null, limit = 5, account, accountType = 'personal' }) {
  if (!userId || !account?.access_token) {
    return { updated: 0, skipped: true };
  }

  try {
    await ensureAnalyticsSyncStateTable();
    const syncKey = getSyncKey(userId, accountId);

    // Don't sync if already running or in cooldown
    const { rows } = await pool.query(
      `SELECT in_progress, next_allowed_at FROM analytics_sync_state WHERE sync_key = $1`,
      [syncKey]
    );
    if (rows.length > 0) {
      const row = rows[0];
      if (row.in_progress) return { updated: 0, skipped: true };
      if (row.next_allowed_at && new Date(row.next_allowed_at) > new Date()) {
        return { updated: 0, skipped: true };
      }
    }

    // Get the N most recent posted tweets that are stale (not refreshed in last 2 min)
    const scopeFilter = accountId
      ? `AND account_id IS NOT NULL AND account_id::text != '0'`
      : `AND (account_id IS NULL OR account_id::text = '0')`;

    const { rows: hotTweets } = await pool.query(
      `SELECT tweet_id FROM tweets
       WHERE user_id = $1
         ${scopeFilter}
         AND status = 'posted'
         AND tweet_id IS NOT NULL
         AND COALESCE(external_created_at, created_at) >= NOW() - INTERVAL '7 days'
         AND (analytics_fetched_at IS NULL OR analytics_fetched_at < NOW() - INTERVAL '2 minutes')
       ORDER BY COALESCE(external_created_at, created_at) DESC
       LIMIT $2`,
      [userId, limit]
    );

    if (hotTweets.length === 0) {
      return { updated: 0, skipped: false };
    }

    const tweetIds = hotTweets.map((t) => String(t.tweet_id)).filter(Boolean);
    const result = await fetchAndPersistMetricsInline({ tweetIds, userId, account, accountType });
    return { updated: result.updated, skipped: false };
  } catch (err) {
    log('inlineQuickSync: error', { userId, message: err?.message });
    return { updated: 0, skipped: true };
  }
}
