import express from 'express';
import pool from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { authenticateToken, validateTwitterConnection } from '../middleware/auth.js';
import { buildTeamAccountFilter, resolveTeamAccountScope } from '../utils/teamAccountScope.js';

const router = express.Router();
const SYNC_COOLDOWN_MS = Number(process.env.ANALYTICS_SYNC_COOLDOWN_MS || 3 * 60 * 1000);
const SYNC_CANDIDATE_LIMIT = Number(process.env.ANALYTICS_SYNC_CANDIDATE_LIMIT || 20);
const SYNC_LOOKBACK_DAYS = Number(process.env.ANALYTICS_SYNC_LOOKBACK_DAYS || 30);
const SYNC_STALE_AFTER_MINUTES = Number(process.env.ANALYTICS_SYNC_STALE_AFTER_MINUTES || 360);
const SYNC_FORCE_REFRESH_COUNT = Number(process.env.ANALYTICS_SYNC_FORCE_REFRESH_COUNT || 0);
const syncState = new Map();

const getSyncKey = (userId, accountId) => `${userId}:${accountId || 'personal'}`;

const getSyncStatusPayload = (key, now = Date.now()) => {
  const state = syncState.get(key) || {};
  const nextAllowedAt = Number.isFinite(state.nextAllowedAt) ? state.nextAllowedAt : null;
  const lastSyncAt = Number.isFinite(state.lastSyncAt) ? state.lastSyncAt : null;

  return {
    inProgress: !!state.inProgress,
    cooldownMs: SYNC_COOLDOWN_MS,
    nextAllowedAt: nextAllowedAt ? new Date(nextAllowedAt).toISOString() : null,
    cooldownRemainingMs: nextAllowedAt && nextAllowedAt > now ? nextAllowedAt - now : 0,
    lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
    lastResult: state.lastResult || null,
  };
};

const setSyncState = (key, patch) => {
  const existing = syncState.get(key) || {};
  syncState.set(key, { ...existing, ...patch });
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

// Get analytics overview
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
    const teamAccountScope = await resolveTeamAccountScope(pool, userId, selectedAccountId);

    if (selectedAccountId && !teamAccountScope) {
      console.warn('[analytics/overview] Selected account not accessible, using default user scope', {
        userId,
        selectedAccountId,
      });
    }

    console.log('📊 Fetching analytics overview for user:', userId, 'account:', selectedAccountId, 'days:', days, 'scopeIds:', teamAccountScope?.relatedAccountIds || null);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const buildScopedStatement = (baseSql, baseParams, alias = '') => {
      const { clause, params } = buildTeamAccountFilter({
        scope: teamAccountScope,
        alias,
        startIndex: baseParams.length + 1,
        includeOrphanFallback: true,
        orphanUserId: userId,
      });

      return {
        sql: `${baseSql}${clause}`,
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
        COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0) as total_engagement,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN
          ROUND((COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0)::DECIMAL / COALESCE(SUM(impressions), 1)::DECIMAL) * 100, 2)
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
       AND (created_at >= $2 OR external_created_at >= $2)
       AND status = 'posted'`,
      [userId, startDate]
    );
    const { rows: tweetMetrics } = await pool.query(tweetMetricsStatement.sql, tweetMetricsStatement.params);

    // Get daily metrics for chart
    const dailyMetricsStatement = buildScopedStatement(
      `SELECT
        DATE(COALESCE(external_created_at, created_at)) as date,
        COUNT(*) as tweets_count,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(likes), 0) as likes,
        COALESCE(SUM(retweets), 0) as retweets,
        COALESCE(SUM(replies), 0) as replies,
        COALESCE(SUM(quote_count), 0) as quotes,
        COALESCE(SUM(bookmark_count), 0) as bookmarks,
        COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0) as total_engagement,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN
          ROUND((COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0)::DECIMAL / COALESCE(SUM(impressions), 1)::DECIMAL) * 100, 2)
        ELSE 0 END as engagement_rate,
        COALESCE(AVG(impressions), 0) as avg_impressions_per_tweet,
        COALESCE(AVG(likes), 0) as avg_likes_per_tweet
       FROM tweets
       WHERE user_id = $1
       AND (created_at >= $2 OR external_created_at >= $2)
       AND status = 'posted'
       GROUP BY DATE(COALESCE(external_created_at, created_at))
       ORDER BY date DESC
       LIMIT 30`,
      [userId, startDate]
    );
    const { rows: dailyMetrics } = await pool.query(dailyMetricsStatement.sql, dailyMetricsStatement.params);

    // Get all tweets for analytics (not just top performing)
    const tweetsStatement = buildScopedStatement(
      `SELECT
        id, content,
        COALESCE(impressions, 0) as impressions,
        COALESCE(likes, 0) as likes,
        COALESCE(retweets, 0) as retweets,
        COALESCE(replies, 0) as replies,
        COALESCE(quote_count, 0) as quote_count,
        COALESCE(bookmark_count, 0) as bookmark_count,
        source, COALESCE(external_created_at, created_at) as created_at,
        (COALESCE(impressions, 0) + COALESCE(likes, 0) * 2 + COALESCE(retweets, 0) * 3 + COALESCE(replies, 0) * 2 + COALESCE(quote_count, 0) * 2 + COALESCE(bookmark_count, 0)) as engagement_score,
        CASE WHEN COALESCE(impressions, 0) > 0 THEN
          ROUND(((COALESCE(likes, 0) + COALESCE(retweets, 0) + COALESCE(replies, 0) + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0))::DECIMAL / impressions::DECIMAL) * 100, 2)
        ELSE 0 END as tweet_engagement_rate
       FROM tweets
       WHERE user_id = $1
       AND (created_at >= $2 OR external_created_at >= $2)
       AND status = 'posted'
       ORDER BY created_at DESC`,
      [userId, startDate]
    );
    const { rows: tweets } = await pool.query(tweetsStatement.sql, tweetsStatement.params);

    // Get hourly engagement patterns
    const hourlyEngagementStatement = buildScopedStatement(
      `SELECT
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as tweets_count,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(AVG(likes + retweets + replies), 0) as avg_engagement
       FROM tweets
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY avg_engagement DESC`,
      [userId, startDate]
    );
    const { rows: hourlyEngagement } = await pool.query(hourlyEngagementStatement.sql, hourlyEngagementStatement.params);

    // Get content type performance
    const contentTypeStatement = buildScopedStatement(
      `SELECT
        CASE WHEN content IS NOT NULL AND array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread' ELSE 'single' END as content_type,
        COUNT(*) as tweets_count,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(AVG(likes + retweets + replies), 0) as avg_total_engagement
       FROM tweets
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted' AND content IS NOT NULL
       GROUP BY CASE WHEN content IS NOT NULL AND array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread' ELSE 'single' END`,
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
        COALESCE(SUM(replies), 0) as prev_total_replies
       FROM tweets
       WHERE user_id = $1 AND created_at >= $2 AND created_at < $3 AND status = 'posted'`,
      [userId, previousStartDate, startDate]
    );
    const { rows: previousMetrics } = await pool.query(previousMetricsStatement.sql, previousMetricsStatement.params);

    console.log('✅ Analytics overview data fetched successfully');

    res.json({
      overview: tweetMetrics[0] || {},
      daily_metrics: dailyMetrics || [],
      tweets: tweets || [],
      hourly_engagement: hourlyEngagement || [],
      content_type_metrics: contentTypeMetrics || [],
      growth: {
        current: tweetMetrics[0] || {},
        previous: previousMetrics[0] || {},
      },
    });

  } catch (error) {
    console.error('❌ Analytics overview error:', error);
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
    const key = getSyncKey(userId, selectedAccountId);

    return res.json({
      success: true,
      syncStatus: getSyncStatusPayload(key),
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
    rate_limited: 0,
  };
  let syncKey = null;
  let ownsSyncLock = false;
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
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const teamAccountScope = twitterAccount?.isTeamAccount
      ? await resolveTeamAccountScope(pool, userId, selectedAccountId)
      : null;
    const effectiveAccountId = teamAccountScope?.selectedAccountId || null;
    syncKey = getSyncKey(userId, effectiveAccountId);

    log('Sync requested', {
      userId,
      selectedAccountId,
      effectiveAccountId,
      isTeamAccount: !!twitterAccount?.isTeamAccount,
      scopeAccountIds: teamAccountScope?.relatedAccountIds || null,
      allowOrphanFallback: !!teamAccountScope?.allowOrphanFallback,
    });

    if (selectedAccountId && twitterAccount?.isTeamAccount && !teamAccountScope) {
      log('Selected team account not accessible for sync, falling back to default user scope', { selectedAccountId });
    } else if (selectedAccountId && !effectiveAccountId) {
      log('Ignoring x-selected-account-id for personal sync', { selectedAccountId });
    }

    const now = Date.now();
    const currentSyncStatus = getSyncStatusPayload(syncKey, now);

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
      return res.status(429).json({
        success: false,
        error: 'Sync cooldown active',
        message: `Please wait about ${waitMinutes} minutes before syncing again.`,
        type: 'sync_cooldown',
        waitMinutes,
        syncStatus: currentSyncStatus,
      });
    }

    setSyncState(syncKey, {
      inProgress: true,
      startedAt: now,
      lastResult: 'running',
    });
    ownsSyncLock = true;

    log('Sync lock acquired', { syncKey });

    let twitterClient;
    if (twitterAccount.access_token) {
      try {
        twitterClient = new TwitterApi(twitterAccount.access_token);
      } catch (oauth2Error) {
        console.error('OAuth 2.0 initialization failed:', oauth2Error);
        setSyncState(syncKey, { inProgress: false, lastResult: 'auth_error' });
        return res.status(401).json({
          error: 'Twitter authentication failed',
          message: 'Please reconnect your Twitter account.',
          type: 'twitter_auth_error',
          syncStatus: getSyncStatusPayload(syncKey),
        });
      }
    } else {
      throw new Error('No OAuth 2.0 access token found');
    }

    const syncScopeParams = [userId];
    const { clause: syncScopeClause, params: syncScopeFilterParams } = buildTeamAccountFilter({
      scope: teamAccountScope,
      startIndex: syncScopeParams.length + 1,
      includeOrphanFallback: true,
      orphanUserId: userId,
    });
    syncScopeParams.push(...syncScopeFilterParams);
    const lookbackDaysIndex = syncScopeParams.push(SYNC_LOOKBACK_DAYS);
    const forceRefreshCountIndex = syncScopeParams.push(SYNC_FORCE_REFRESH_COUNT);
    const staleAfterMinutesIndex = syncScopeParams.push(SYNC_STALE_AFTER_MINUTES);
    const candidateLimitIndex = syncScopeParams.push(SYNC_CANDIDATE_LIMIT);

    log('Sync candidate config', {
      lookbackDays: SYNC_LOOKBACK_DAYS,
      staleAfterMinutes: SYNC_STALE_AFTER_MINUTES,
      forceRefreshCount: SYNC_FORCE_REFRESH_COUNT,
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
          COALESCE(external_created_at, created_at) AS sort_ts
        FROM tweets
        WHERE user_id = $1
        ${syncScopeClause}
        AND status = 'posted'
        AND source IN ('platform', 'external')
        AND tweet_id IS NOT NULL
        AND COALESCE(external_created_at, created_at) >= NOW() - ($${lookbackDaysIndex}::int * INTERVAL '1 day')
      ),
      force_candidates AS (
        SELECT id, tweet_id, content, created_at, sort_ts
        FROM scoped_tweets
        ORDER BY sort_ts DESC
        LIMIT $${forceRefreshCountIndex}
      ),
      stale_candidates AS (
        SELECT id, tweet_id, content, created_at, sort_ts
        FROM scoped_tweets
        WHERE
          impressions IS NULL
          OR impressions = 0
          OR updated_at IS NULL
          OR updated_at < NOW() - ($${staleAfterMinutesIndex}::int * INTERVAL '1 minute')
        ORDER BY sort_ts DESC
        LIMIT $${candidateLimitIndex}
      )
      SELECT id, tweet_id, content, created_at
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
      const { clause: diagScopeClause, params: diagScopeFilterParams } = buildTeamAccountFilter({
        scope: teamAccountScope,
        startIndex: diagParams.length + 1,
        includeOrphanFallback: true,
        orphanUserId: userId,
      });
      diagParams.push(...diagScopeFilterParams);
      const diagLookbackDaysIndex = diagParams.push(SYNC_LOOKBACK_DAYS);
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
         WHERE user_id = $1
         ${diagScopeClause}
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
      setSyncState(syncKey, {
        inProgress: false,
        lastSyncAt: completedAt,
        nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
        lastResult: 'noop',
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
        syncStatus: getSyncStatusPayload(syncKey),
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
          setSyncState(syncKey, {
            inProgress: false,
            lastSyncAt: completedAt,
            nextAllowedAt: Math.max(resetTimestamp, completedAt + SYNC_COOLDOWN_MS),
            lastResult: 'rate_limited',
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
            syncStatus: getSyncStatusPayload(syncKey),
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
              publicMetrics.impression_count || 0,
              publicMetrics.like_count || 0,
              publicMetrics.retweet_count || 0,
              publicMetrics.reply_count || 0,
              publicMetrics.quote_count || 0,
              publicMetrics.bookmark_count || 0,
              tweet.id
            ]
          );
          updatedCount++;
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
          await pool.query(
            `UPDATE tweets SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [tweet.id]
          );
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
    setSyncState(syncKey, {
      inProgress: false,
      lastSyncAt: completedAt,
      nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
      lastResult: errorCount > 0 ? 'completed_with_errors' : 'completed',
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
      syncStatus: getSyncStatusPayload(syncKey),
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
        setSyncState(syncKey, {
          inProgress: false,
          lastSyncAt: completedAt,
          nextAllowedAt: Math.max(resetTimestamp, completedAt + SYNC_COOLDOWN_MS),
          lastResult: 'rate_limited',
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
        syncStatus: syncKey ? getSyncStatusPayload(syncKey) : null,
      };

      return updatedCount > 0 ? res.status(200).json(payload) : res.status(429).json(payload);
    }

    if (syncKey) {
      const completedAt = Date.now();
      setSyncState(syncKey, {
        inProgress: false,
        lastSyncAt: completedAt,
        nextAllowedAt: completedAt + SYNC_COOLDOWN_MS,
        lastResult: 'error',
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
      syncStatus: syncKey ? getSyncStatusPayload(syncKey) : null,
    });
  } finally {
    if (syncKey && ownsSyncLock) {
      setSyncState(syncKey, { inProgress: false });
    }
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
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
    const teamAccountScope = await resolveTeamAccountScope(pool, userId, selectedAccountId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const buildScopedStatement = (baseSql, baseParams, alias = '') => {
      const { clause, params } = buildTeamAccountFilter({
        scope: teamAccountScope,
        alias,
        startIndex: baseParams.length + 1,
        includeOrphanFallback: true,
        orphanUserId: userId,
      });

      return {
        sql: `${baseSql}${clause}`,
        params: [...baseParams, ...params],
      };
    };

    // Get engagement patterns by content type
    const engagementPatternsStatement = buildScopedStatement(
      `SELECT 
        CASE 
          WHEN content LIKE '%#%' THEN 'with_hashtags'
          ELSE 'no_hashtags'
        END as hashtag_usage,
        CASE 
          WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread'
          ELSE 'single'
        END as content_type,
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
        AVG(likes + retweets + replies) as avg_total_engagement,
        CASE WHEN AVG(impressions) > 0 THEN 
          ROUND((AVG(likes + retweets + replies) / AVG(impressions)) * 100, 2) 
        ELSE 0 END as avg_engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY hashtag_usage, content_type, content_length
       ORDER BY avg_total_engagement DESC`,
      [userId, startDate]
    );
    const { rows: engagementPatterns } = await pool.query(engagementPatternsStatement.sql, engagementPatternsStatement.params);

    // Get best performing times
    const timeAnalysisStatement = buildScopedStatement(
      `SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        EXTRACT(HOUR FROM created_at) as hour_of_day,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes + retweets + replies) as avg_engagement,
        CASE WHEN AVG(impressions) > 0 THEN 
          ROUND((AVG(likes + retweets + replies) / AVG(impressions)) * 100, 2) 
        ELSE 0 END as avg_engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
       HAVING COUNT(*) >= 2
       ORDER BY avg_engagement DESC
       LIMIT 20`,
      [userId, startDate]
    );
    const { rows: timeAnalysis } = await pool.query(timeAnalysisStatement.sql, timeAnalysisStatement.params);

    // Get content performance insights
    const contentInsightsStatement = buildScopedStatement(
      `SELECT 
        'hashtag_performance' as insight_type,
        CASE WHEN content LIKE '%#%' THEN 'with_hashtags' ELSE 'without_hashtags' END as category,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes + retweets + replies) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY CASE WHEN content LIKE '%#%' THEN 'with_hashtags' ELSE 'without_hashtags' END
        
       UNION ALL
       
       SELECT 
        'thread_performance' as insight_type,
        CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'threads' ELSE 'single_tweets' END as category,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes + retweets + replies) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'threads' ELSE 'single_tweets' END`,
      [userId, startDate]
    );
    const { rows: contentInsights } = await pool.query(contentInsightsStatement.sql, contentInsightsStatement.params);

    res.json({
      engagement_patterns: engagementPatterns,
      optimal_times: timeAnalysis,
      content_insights: contentInsights
    });

  } catch (error) {
    console.error('Engagement analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch engagement analytics' });
  }
});

// Get follower and reach analytics
router.get('/audience', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
    const teamAccountScope = await resolveTeamAccountScope(pool, userId, selectedAccountId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const buildScopedStatement = (baseSql, baseParams, alias = '') => {
      const { clause, params } = buildTeamAccountFilter({
        scope: teamAccountScope,
        alias,
        startIndex: baseParams.length + 1,
        includeOrphanFallback: true,
        orphanUserId: userId,
      });

      return {
        sql: `${baseSql}${clause}`,
        params: [...baseParams, ...params],
      };
    };

    // Get reach and impression distribution
    const reachMetricsStatement = buildScopedStatement(
      `SELECT 
        DATE(created_at) as date,
        SUM(impressions) as total_impressions,
        SUM(likes + retweets + replies) as total_engagement,
        COUNT(DISTINCT CASE WHEN impressions > 0 THEN id END) as tweets_with_impressions,
        AVG(impressions) as avg_impressions_per_tweet,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY impressions) as median_impressions,
        MAX(impressions) as max_impressions,
        MIN(impressions) as min_impressions
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [userId, startDate]
    );
    const { rows: reachMetrics } = await pool.query(reachMetricsStatement.sql, reachMetricsStatement.params);

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
        AVG(impressions) as avg_impressions
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY reach_category
       ORDER BY avg_impressions DESC`,
      [userId, startDate]
    );
    const { rows: engagementDistribution } = await pool.query(engagementDistributionStatement.sql, engagementDistributionStatement.params);

    res.json({
      reach_metrics: reachMetrics,
      engagement_distribution: engagementDistribution
    });

  } catch (error) {
    console.error('Audience analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch audience analytics' });
  }
});

export default router;


