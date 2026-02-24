import express from 'express';
import pool from '../config/database.js';
import { buildTwitterScopeFilter, resolveTwitterScope } from '../utils/twitterScopeResolver.js';

const router = express.Router();

const DASHBOARD_LOOKBACK_DAYS = Number.parseInt(process.env.DASHBOARD_LOOKBACK_DAYS || '50', 10);
const DASHBOARD_RECENT_LIMIT = Number.parseInt(process.env.DASHBOARD_RECENT_LIMIT || '5', 10);

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildTokenStatus = async ({ userId, requestTeamId, scope }) => {
  let tokenData = null;

  if (scope.mode === 'team' && requestTeamId && scope.effectiveAccountId) {
    const { rows } = await pool.query(
      `SELECT ta.token_expires_at, ta.oauth1_access_token
       FROM team_accounts ta
       INNER JOIN team_members tm
         ON tm.team_id = ta.team_id
        AND tm.user_id = $3
        AND tm.status = 'active'
       WHERE ta.id::text = $1::text
         AND ta.team_id = $2
       LIMIT 1`,
      [scope.effectiveAccountId, requestTeamId, userId]
    );
    if (rows.length > 0) tokenData = rows[0];
  }

  if (!tokenData) {
    const { rows } = await pool.query(
      `SELECT token_expires_at, oauth1_access_token
       FROM twitter_auth
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (rows.length > 0) tokenData = rows[0];
  }

  if (!tokenData) {
    return {
      connected: false,
      isOAuth1: false,
      expiresAt: null,
      minutesUntilExpiry: null,
      isExpired: false,
      needsRefresh: false,
    };
  }

  if (tokenData.oauth1_access_token) {
    return {
      connected: true,
      isOAuth1: true,
      expiresAt: null,
      minutesUntilExpiry: Infinity,
      isExpired: false,
      needsRefresh: false,
    };
  }

  if (!tokenData.token_expires_at) {
    return {
      connected: false,
      isOAuth1: false,
      expiresAt: null,
      minutesUntilExpiry: null,
      isExpired: false,
      needsRefresh: false,
    };
  }

  const now = new Date();
  const expiresAt = new Date(tokenData.token_expires_at);
  const minutesUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 60000);

  return {
    connected: true,
    isOAuth1: false,
    expiresAt: expiresAt.toISOString(),
    minutesUntilExpiry,
    isExpired: expiresAt <= now,
    needsRefresh: minutesUntilExpiry < 10,
  };
};

router.get('/bootstrap', async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const parsedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : DASHBOARD_LOOKBACK_DAYS;
    const recentLimit = Number.isFinite(DASHBOARD_RECENT_LIMIT) && DASHBOARD_RECENT_LIMIT > 0 ? DASHBOARD_RECENT_LIMIT : 5;

    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metricsScopeParams = [userId, startDate];
    const { clause: metricsScopeClause, params: metricsScopeFilterParams } = buildTwitterScopeFilter({
      scope: twitterScope,
      alias: 't',
      startIndex: metricsScopeParams.length + 1,
      includeLegacyPersonalFallback: true,
      includeTeamOrphanFallback: true,
      orphanUserId: userId,
    });
    metricsScopeParams.push(...metricsScopeFilterParams);

    const metricsQuery = `
      SELECT
        COUNT(*)::int AS total_tweets,
        COALESCE(SUM(t.impressions), 0)::bigint AS total_impressions,
        COALESCE(SUM(t.likes), 0)::bigint AS total_likes,
        COALESCE(SUM(t.retweets), 0)::bigint AS total_retweets,
        COALESCE(SUM(t.replies), 0)::bigint AS total_replies,
        COALESCE(SUM(t.likes + t.retweets + t.replies + COALESCE(t.quote_count, 0) + COALESCE(t.bookmark_count, 0)), 0)::bigint AS total_engagement
      FROM tweets t
      WHERE t.user_id = $1
        AND COALESCE(t.external_created_at, t.created_at) >= $2
        AND t.status = 'posted'
        ${metricsScopeClause}
    `;

    const recentScopeParams = [userId];
    const { clause: recentScopeClause, params: recentScopeFilterParams } = buildTwitterScopeFilter({
      scope: twitterScope,
      alias: 't',
      startIndex: recentScopeParams.length + 1,
      includeLegacyPersonalFallback: true,
      includeTeamOrphanFallback: true,
      orphanUserId: userId,
    });
    recentScopeParams.push(...recentScopeFilterParams);

    const recentLimitIndex = recentScopeParams.length + 1;
    const recentTweetsQuery = `
      SELECT
        t.id,
        t.content,
        t.status,
        t.source,
        t.tweet_id,
        COALESCE(t.likes, 0) AS likes,
        COALESCE(t.retweets, 0) AS retweets,
        COALESCE(t.replies, 0) AS replies,
        COALESCE(t.external_created_at, t.created_at) AS created_at,
        COALESCE(ta.twitter_username, pa.twitter_username) AS username
      FROM tweets t
      LEFT JOIN team_accounts ta ON t.account_id::text = ta.id::text
      LEFT JOIN twitter_auth pa ON t.user_id = pa.user_id
      WHERE t.user_id = $1
        ${recentScopeClause}
      ORDER BY COALESCE(t.external_created_at, t.created_at) DESC
      LIMIT $${recentLimitIndex}
    `;

    const recentTweetsParams = [...recentScopeParams, recentLimit];

    const creditsPromise = pool.query(
      `SELECT credits_remaining FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const tokenStatusPromise = buildTokenStatus({
      userId,
      requestTeamId,
      scope: twitterScope,
    });

    if (!twitterScope.connected && twitterScope.mode === 'personal') {
      const [creditsResult, tokenStatus] = await Promise.all([creditsPromise, tokenStatusPromise]);
      const creditBalance = toSafeNumber(creditsResult.rows[0]?.credits_remaining, 0);

      return res.json({
        success: true,
        disconnected: true,
        mode: twitterScope.mode,
        overview: {
          total_tweets: 0,
          total_impressions: 0,
          total_likes: 0,
          total_retweets: 0,
          total_replies: 0,
          total_engagement: 0,
        },
        recent_tweets: [],
        credits: {
          balance: creditBalance,
          creditsRemaining: creditBalance,
        },
        tokenStatus,
      });
    }

    const [metricsResult, recentTweetsResult, creditsResult, tokenStatus] = await Promise.all([
      pool.query(metricsQuery, metricsScopeParams),
      pool.query(recentTweetsQuery, recentTweetsParams),
      creditsPromise,
      tokenStatusPromise,
    ]);

    const metrics = metricsResult.rows[0] || {};
    const creditBalance = toSafeNumber(creditsResult.rows[0]?.credits_remaining, 0);

    return res.json({
      success: true,
      disconnected: false,
      mode: twitterScope.mode,
      overview: {
        total_tweets: toSafeNumber(metrics.total_tweets),
        total_impressions: toSafeNumber(metrics.total_impressions),
        total_likes: toSafeNumber(metrics.total_likes),
        total_retweets: toSafeNumber(metrics.total_retweets),
        total_replies: toSafeNumber(metrics.total_replies),
        total_engagement: toSafeNumber(metrics.total_engagement),
      },
      recent_tweets: recentTweetsResult.rows || [],
      credits: {
        balance: creditBalance,
        creditsRemaining: creditBalance,
      },
      tokenStatus,
    });
  } catch (error) {
    console.error('Dashboard bootstrap error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard bootstrap',
      message: error.message,
    });
  }
});

export default router;
