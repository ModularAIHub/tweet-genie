import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';
import { buildReconnectRequiredPayload } from '../utils/twitterScopeResolver.js';
import { fetchLatestPersonalTwitterAuth, fetchPersonalTwitterAuthById } from '../utils/personalTwitterAuth.js';
import {
  ensureTwitterAccountReady,
  TwitterReconnectRequiredError,
} from '../utils/twitterRuntimeAuth.js';

const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';
const AUTH_PLATFORM_TIMEOUT_MS = Number(process.env.AUTH_PLATFORM_TIMEOUT_MS || 4000);
const AUTH_PLATFORM_CACHE_TTL_MS = Number(process.env.AUTH_PLATFORM_CACHE_TTL_MS || 5 * 60 * 1000);
const AUTH_PLATFORM_CACHE_MAX_ENTRIES = Number(process.env.AUTH_PLATFORM_CACHE_MAX_ENTRIES || 500);
const AUTH_PLATFORM_STALE_FALLBACK_MS = Number(process.env.AUTH_PLATFORM_STALE_FALLBACK_MS || 10 * 60 * 1000);
const AUTH_TEAM_CACHE_TTL_MS = Number(process.env.AUTH_TEAM_CACHE_TTL_MS || 5 * 60 * 1000);
const AUTH_TEAM_CACHE_MAX_ENTRIES = Number(process.env.AUTH_TEAM_CACHE_MAX_ENTRIES || 500);
const AUTH_WARN_LOG_THROTTLE_MS = Number(process.env.AUTH_WARN_LOG_THROTTLE_MS || 30000);
const AUTH_PERF_ENABLED =
  process.env.AUTH_PERF_ENABLED === 'true' ||
  (process.env.AUTH_PERF_ENABLED !== 'false' && process.env.NODE_ENV !== 'production');

const platformUserCache = new Map();
const teamMembershipCache = new Map();
const platformLookupInflight = new Map();
const teamLookupInflight = new Map();
const authWarnLogState = new Map();

const shouldLogWithThrottle = (key) => {
  const now = Date.now();
  const lastLoggedAt = authWarnLogState.get(key) || 0;

  if (now - lastLoggedAt < AUTH_WARN_LOG_THROTTLE_MS) {
    return false;
  }

  authWarnLogState.set(key, now);
  return true;
};

const createTimingBucket = () => ({
  count: 0,
  totalMs: 0,
  minMs: null,
  maxMs: 0,
});

const createAuthPerfState = () => ({
  startedAt: Date.now(),
  lastUpdatedAt: Date.now(),
  counters: {
    requestsTotal: 0,
    shortCircuitReuse: 0,
    noToken: 0,
    redirectToLogin: 0,
    jwtVerified: 0,
    jwtExpired: 0,
    jwtInvalid: 0,
    platformCacheHit: 0,
    platformCacheMiss: 0,
    platformNetworkSuccess: 0,
    platformNetworkError: 0,
    platformStaleFallbackHit: 0,
    platformTimeoutFallback: 0,
    platformApiFallback: 0,
    platformJwtFallback: 0,
    platformAuthRedirects: 0,
    teamFromPlatformPayload: 0,
    teamCacheHit: 0,
    teamCacheMiss: 0,
    teamDbQuerySuccess: 0,
    teamDbQueryError: 0,
    teamStaleFallbackHit: 0,
    unexpectedErrors: 0,
  },
  sourceCounts: {},
  timings: {
    authTotal: createTimingBucket(),
    platformLookup: createTimingBucket(),
    teamLookup: createTimingBucket(),
  },
});

let authPerfStats = createAuthPerfState();

const bumpPerf = (key, amount = 1) => {
  if (!AUTH_PERF_ENABLED) return;
  authPerfStats.counters[key] = (authPerfStats.counters[key] || 0) + amount;
  authPerfStats.lastUpdatedAt = Date.now();
};

const bumpSource = (source) => {
  if (!AUTH_PERF_ENABLED || !source) return;
  authPerfStats.sourceCounts[source] = (authPerfStats.sourceCounts[source] || 0) + 1;
  authPerfStats.lastUpdatedAt = Date.now();
};

const recordPerfDuration = (bucketName, durationMs) => {
  if (!AUTH_PERF_ENABLED || !Number.isFinite(durationMs) || durationMs < 0) return;
  const bucket = authPerfStats.timings[bucketName];
  if (!bucket) return;

  bucket.count += 1;
  bucket.totalMs += durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);
  bucket.minMs = bucket.minMs === null ? durationMs : Math.min(bucket.minMs, durationMs);
  authPerfStats.lastUpdatedAt = Date.now();
};

const roundMetric = (value) => Number(value.toFixed(2));

const formatTimingBucket = (bucket = createTimingBucket()) => ({
  count: bucket.count,
  totalMs: roundMetric(bucket.totalMs),
  avgMs: bucket.count > 0 ? roundMetric(bucket.totalMs / bucket.count) : 0,
  minMs: bucket.minMs === null ? null : roundMetric(bucket.minMs),
  maxMs: roundMetric(bucket.maxMs),
});

export const getAuthPerfStats = () => {
  const now = Date.now();
  return {
    enabled: AUTH_PERF_ENABLED,
    startedAt: new Date(authPerfStats.startedAt).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((now - authPerfStats.startedAt) / 1000)),
    lastUpdatedAt: new Date(authPerfStats.lastUpdatedAt).toISOString(),
    counters: { ...authPerfStats.counters },
    sourceCounts: { ...authPerfStats.sourceCounts },
    timings: {
      authTotal: formatTimingBucket(authPerfStats.timings.authTotal),
      platformLookup: formatTimingBucket(authPerfStats.timings.platformLookup),
      teamLookup: formatTimingBucket(authPerfStats.timings.teamLookup),
    },
    cache: {
      platformUserCacheSize: platformUserCache.size,
      teamMembershipCacheSize: teamMembershipCache.size,
      platformLookupInflightSize: platformLookupInflight.size,
      teamLookupInflightSize: teamLookupInflight.size,
      platformCacheTtlMs: AUTH_PLATFORM_CACHE_TTL_MS,
      teamCacheTtlMs: AUTH_TEAM_CACHE_TTL_MS,
      platformTimeoutMs: AUTH_PLATFORM_TIMEOUT_MS,
      staleFallbackWindowMs: AUTH_PLATFORM_STALE_FALLBACK_MS,
    },
  };
};

export const resetAuthPerfStats = () => {
  authPerfStats = createAuthPerfState();
  return getAuthPerfStats();
};

const authLog = (...args) => {
  if (AUTH_DEBUG) {
    console.log(...args);
  }
};

const authWarn = (key, ...args) => {
  if (AUTH_DEBUG || shouldLogWithThrottle(key)) {
    console.warn(...args);
  }
};

const authError = (key, ...args) => {
  if (AUTH_DEBUG || shouldLogWithThrottle(key)) {
    console.error(...args);
  }
};

const isHtmlRequest = (req) => req.headers.accept && req.headers.accept.includes('text/html');

const getCurrentUrl = (req) => `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;

const getPlatformLoginUrl = (req) =>
  `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(getCurrentUrl(req))}`;

const getPlatformApiBaseUrl = () => process.env.PLATFORM_API_URL || process.env.PLATFORM_URL || 'http://localhost:3000';

const hasFreshCacheEntry = (entry, now = Date.now()) =>
  !!entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > now;

const hasStaleFallbackEntry = (entry, now = Date.now()) =>
  !!entry &&
  Number.isFinite(entry.expiresAt) &&
  entry.expiresAt <= now &&
  now - entry.expiresAt <= AUTH_PLATFORM_STALE_FALLBACK_MS;

const pruneCache = (cache, maxEntries) => {
  const now = Date.now();

  for (const [key, entry] of cache.entries()) {
    if (!hasFreshCacheEntry(entry, now)) {
      cache.delete(key);
    }
  }

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

const setCacheEntry = (cache, key, value, ttlMs, maxEntries) => {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  pruneCache(cache, maxEntries);
};

const getOrCreateInflight = (inflightMap, key, factory) => {
  const existing = inflightMap.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(factory)
    .finally(() => inflightMap.delete(key));

  inflightMap.set(key, promise);
  return promise;
};

const normalizePlatformUserPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  if (payload.user && typeof payload.user === 'object') {
    return payload.user;
  }

  return payload;
};

const buildJwtFallbackUser = (decoded, overrides = {}) => {
  const fallbackPlanType = decoded?.planType || decoded?.plan_type || null;
  const fallbackCredits = Number(decoded?.creditsRemaining || decoded?.credits_remaining || 0);

  return {
    id: decoded?.userId || null,
    email: decoded?.email || '',
    name: decoded?.name || '',
    plan_type: fallbackPlanType,
    planType: fallbackPlanType,
    credits_remaining: fallbackCredits,
    creditsRemaining: fallbackCredits,
    ...overrides,
  };
};

const normalizeTeamMembership = (membership = {}) => ({
  teamId: membership.teamId || membership.team_id,
  role: membership.role || 'member',
  status: membership.status || 'active',
});

const normalizeUserTeamData = (user) => {
  const memberships = Array.isArray(user?.teamMemberships)
    ? user.teamMemberships
        .map(normalizeTeamMembership)
        .filter((membership) => membership.teamId)
    : [];
  const primaryTeamId = user?.teamId || user?.team_id || memberships[0]?.teamId || null;

  return {
    teamId: primaryTeamId,
    team_id: primaryTeamId,
    teamMemberships: memberships,
  };
};

export const authenticateToken = async (req, res, next) => {
  const authStart = Date.now();
  const finish = () => recordPerfDuration('authTotal', Date.now() - authStart);

  bumpPerf('requestsTotal');

  try {
    // Some routes accidentally apply this middleware twice. Avoid repeated work.
    if (req.user?.id || req.user?.userId) {
      bumpPerf('shortCircuitReuse');
      finish();
      return next();
    }

    authLog('[auth] middleware request', { method: req.method, path: req.path });

    // First try to get token from httpOnly cookie (Platform uses 'accessToken')
    let token = req.cookies?.accessToken;

    // Fallback to Authorization header for API compatibility
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    authLog('[auth] token present', !!token);

    if (!token) {
      // No access token - let the client handle refresh via /api/auth/refresh endpoint
      bumpPerf('noToken');

      // For API requests, return 401 and let client-side interceptor handle refresh
      if (!isHtmlRequest(req)) {
        finish();
        return res.status(401).json({ error: 'Access token required', code: 'NO_TOKEN' });
      }

      // For web requests, redirect to platform login
      bumpPerf('redirectToLogin');
      finish();
      return res.redirect(getPlatformLoginUrl(req));
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      bumpPerf('jwtVerified');
      authLog('[auth] token verified for user', decoded.userId);
    } catch (jwtError) {
      authWarn('jwt_verification_failed', '[auth] JWT verification failed:', jwtError.name);

      // If token expired, return 401 and let client-side handle refresh
      if (jwtError.name === 'TokenExpiredError') {
        bumpPerf('jwtExpired');
        finish();
        return res.status(401).json({
          error: 'Token expired',
          code: 'TOKEN_EXPIRED',
        });
      }

      // For other JWT errors (invalid signature, etc.)
      bumpPerf('jwtInvalid');
      finish();
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    const platformCacheEntry = platformUserCache.get(token);
    const now = Date.now();
    let platformSource = 'jwt';

    if (hasFreshCacheEntry(platformCacheEntry, now)) {
      bumpPerf('platformCacheHit');
      req.user = buildJwtFallbackUser(decoded, platformCacheEntry.value);
      platformSource = 'cache';
    } else {
      bumpPerf('platformCacheMiss');
      const platformLookupStart = Date.now();

      try {
        const response = await getOrCreateInflight(platformLookupInflight, token, () =>
          axios.get(`${getPlatformApiBaseUrl()}/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            timeout: AUTH_PLATFORM_TIMEOUT_MS,
          })
        );
        recordPerfDuration('platformLookup', Date.now() - platformLookupStart);
        bumpPerf('platformNetworkSuccess');

        const platformUser = normalizePlatformUserPayload(response.data);
        setCacheEntry(
          platformUserCache,
          token,
          platformUser,
          AUTH_PLATFORM_CACHE_TTL_MS,
          AUTH_PLATFORM_CACHE_MAX_ENTRIES
        );

        req.user = buildJwtFallbackUser(decoded, platformUser);
        platformSource = 'network';
      } catch (platformError) {
        recordPerfDuration('platformLookup', Date.now() - platformLookupStart);
        bumpPerf('platformNetworkError');

        const isTimeout = platformError.code === 'ECONNABORTED' || platformError.code === 'ETIMEDOUT';
        const canUseStaleCache = hasStaleFallbackEntry(platformCacheEntry, now);

        authWarn('platform_auth_me_failed', '[auth] platform /api/auth/me failed', {
          status: platformError.response?.status,
          code: platformError.code,
          isTimeout,
          canUseStaleCache,
        });

        if (canUseStaleCache) {
          bumpPerf('platformStaleFallbackHit');
          req.user = buildJwtFallbackUser(decoded, platformCacheEntry.value);
          platformSource = 'stale-cache';
        } else if (isTimeout) {
          bumpPerf('platformTimeoutFallback');
          req.user = buildJwtFallbackUser(decoded, {
            team_id: null,
            teamMemberships: [],
          });
          platformSource = 'jwt-timeout-fallback';
        } else if (!isHtmlRequest(req)) {
          bumpPerf('platformApiFallback');
          req.user = buildJwtFallbackUser(decoded);
          platformSource = 'jwt-api-fallback';
        } else if (platformError.response?.status === 401 || platformError.response?.status === 403) {
          bumpPerf('platformAuthRedirects');
          bumpPerf('redirectToLogin');
          finish();
          return res.redirect(getPlatformLoginUrl(req));
        } else {
          bumpPerf('platformJwtFallback');
          req.user = buildJwtFallbackUser(decoded);
          platformSource = 'jwt-fallback';
        }
      }
    }

    bumpSource(platformSource);

    const normalizedExistingTeamData = normalizeUserTeamData(req.user);
    const hasPlatformTeamData =
      normalizedExistingTeamData.teamMemberships.length > 0 || !!normalizedExistingTeamData.teamId;

    if (hasPlatformTeamData) {
      bumpPerf('teamFromPlatformPayload');
      req.user.teamId = normalizedExistingTeamData.teamId;
      req.user.team_id = normalizedExistingTeamData.team_id;
      req.user.teamMemberships = normalizedExistingTeamData.teamMemberships;
    } else {
      const teamCacheEntry = teamMembershipCache.get(req.user.id);

      if (hasFreshCacheEntry(teamCacheEntry, now)) {
        bumpPerf('teamCacheHit');
        req.user.teamId = teamCacheEntry.value.teamId;
        req.user.team_id = teamCacheEntry.value.team_id;
        req.user.teamMemberships = teamCacheEntry.value.teamMemberships;
      } else {
        bumpPerf('teamCacheMiss');
        const teamLookupStart = Date.now();

        try {
          const teamMembershipResult = await getOrCreateInflight(
            teamLookupInflight,
            req.user.id,
            () => pool.query(
              `SELECT team_id, role, status FROM team_members WHERE user_id = $1 AND status = 'active'`,
              [req.user.id]
            )
          );
          recordPerfDuration('teamLookup', Date.now() - teamLookupStart);
          bumpPerf('teamDbQuerySuccess');

          const teamMemberships = teamMembershipResult.rows
            .map((row) => ({
              teamId: row.team_id,
              role: row.role,
              status: row.status,
            }))
            .filter((row) => row.teamId);
          const primaryTeamId = teamMemberships[0]?.teamId || null;

          const teamData = {
            teamId: primaryTeamId,
            team_id: primaryTeamId,
            teamMemberships,
          };

          setCacheEntry(
            teamMembershipCache,
            req.user.id,
            teamData,
            AUTH_TEAM_CACHE_TTL_MS,
            AUTH_TEAM_CACHE_MAX_ENTRIES
          );

          req.user.teamId = teamData.teamId;
          req.user.team_id = teamData.team_id;
          req.user.teamMemberships = teamData.teamMemberships;
        } catch (teamErr) {
          recordPerfDuration('teamLookup', Date.now() - teamLookupStart);
          bumpPerf('teamDbQueryError');
          const canUseStaleTeamCache = hasStaleFallbackEntry(teamCacheEntry, Date.now());
          if (canUseStaleTeamCache) {
            bumpPerf('teamStaleFallbackHit');
            req.user.teamId = teamCacheEntry.value.teamId;
            req.user.team_id = teamCacheEntry.value.team_id;
            req.user.teamMemberships = teamCacheEntry.value.teamMemberships;
            authWarn(
              'team_membership_query_failed_stale_fallback',
              '[auth] team membership lookup failed, using stale cache fallback:',
              teamErr.message
            );
          } else {
            authWarn('team_membership_query_failed', '[auth] error querying team memberships:', teamErr.message);
            req.user.teamId = null;
            req.user.team_id = null;
            req.user.teamMemberships = [];
          }
        }
      }
    }

    authLog('[auth] completed', {
      userId: req.user.id,
      path: req.path,
      platformSource,
      elapsedMs: Date.now() - authStart,
    });

    finish();
    return next();
  } catch (error) {
    bumpPerf('unexpectedErrors');

    if (error.name === 'TokenExpiredError') {
      // For web requests, redirect to platform for re-authentication
      if (isHtmlRequest(req)) {
        bumpPerf('redirectToLogin');
        finish();
        return res.redirect(getPlatformLoginUrl(req));
      }
      finish();
      return res.status(401).json({ error: 'Token expired' });
    }

    // For invalid tokens, redirect to platform
    if (isHtmlRequest(req)) {
      bumpPerf('redirectToLogin');
      finish();
      return res.redirect(getPlatformLoginUrl(req));
    }

    finish();
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export const validateTwitterConnection = async (req, res, next) => {
  try {
    let twitterAuthData;
    let isTeamAccount = false;
    const sendReconnectRequired = (reason, details = null) =>
      res.status(401).json(
        buildReconnectRequiredPayload({
          reason,
          details: details || undefined,
        })
      );
    
    // Check for selected team account first (from headers)
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestedTeamId = String(req.headers['x-team-id'] || '').trim() || null;
    const userId = req.user?.id || req.user?.userId;
    let requestTeamId = null;

    if (requestedTeamId) {
      const membershipResult = await pool.query(
        `SELECT 1
         FROM team_members
         WHERE team_id = $1
           AND user_id = $2
           AND status = 'active'
         LIMIT 1`,
        [requestedTeamId, userId]
      );

      if (membershipResult.rows.length > 0) {
        requestTeamId = requestedTeamId;
      } else {
        return res.status(403).json({
          error: 'Team scope is no longer valid for this user.',
          code: 'TEAM_SCOPE_INVALID',
        });
      }
    }

    // Team scope applies when header is present or authenticated user belongs to a team.
    if (requestTeamId && !selectedAccountId) {
      return res.status(400).json({
        error: 'Team account selection required. Please select a team Twitter account.',
        code: 'TEAM_ACCOUNT_SELECTION_REQUIRED',
      });
    }

    if (selectedAccountId && requestTeamId) {
      try {
        const { rows } = await pool.query(
          `SELECT ta.*
           FROM team_accounts ta
           INNER JOIN team_members tm
             ON tm.team_id = ta.team_id
            AND tm.user_id = $3
            AND tm.status = 'active'
           WHERE ta.id::text = $1::text
             AND ta.team_id::text = $2::text
             AND ta.active = true
           LIMIT 1`,
          [selectedAccountId, requestTeamId, userId]
        );
        if (rows.length > 0) {
          twitterAuthData = rows[0];
          isTeamAccount = true;
        } else {
          return res.status(403).json({
            error: 'Selected team account is not available for this team member. Please reselect your team account.',
            code: 'TEAM_ACCOUNT_NOT_USABLE',
          });
        }
      } catch (teamQueryErr) {
        // Team-scoped requests must not fall back to personal credentials.
        authLog(
          '[validateTwitterConnection] Team account query failed:',
          teamQueryErr.message
        );
        return res.status(400).json({
          error: 'Failed to resolve selected team account. Please reselect your team account and retry.',
          code: 'TEAM_ACCOUNT_LOOKUP_FAILED',
        });
      }
    }

    if (requestTeamId && !twitterAuthData) {
      return sendReconnectRequired('team_account_not_connected');
    }
    
    // Personal scope only.
    if (!twitterAuthData) {
      let personalAccount = null;

      if (selectedAccountId) {
        personalAccount = await fetchPersonalTwitterAuthById(pool, userId, selectedAccountId);
      }

      if (!personalAccount) {
        personalAccount = await fetchLatestPersonalTwitterAuth(pool, userId);
      }

      if (!personalAccount) {
        return sendReconnectRequired('not_connected');
      }

      twitterAuthData = personalAccount;
    }
    
    try {
      const readyResult = await ensureTwitterAccountReady({
        dbPool: pool,
        account: twitterAuthData,
        accountType: isTeamAccount ? 'team' : 'personal',
        reason: 'validateTwitterConnection',
        onLog: (...args) => authLog(...args),
      });

      twitterAuthData = readyResult.account;
      authLog('[Twitter Token Status]', {
        accountType: isTeamAccount ? 'team' : 'personal',
        expiresAt: readyResult.status.expiresAtIso,
        minutesUntilExpiry: readyResult.status.minutesUntilExpiry,
        isExpired: readyResult.status.isExpired,
        needsRefresh: readyResult.status.needsRefresh,
        hasOauth1: readyResult.status.hasOauth1,
        hasOauth2: readyResult.status.hasOauth2,
        postingCapable: readyResult.status.postingCapable,
      });
    } catch (error) {
      if (error instanceof TwitterReconnectRequiredError) {
        authWarn(
          `twitter_reconnect_required_${error.reason}`,
          'Twitter account requires reconnect:',
          error.reason,
          error.details || ''
        );
        return sendReconnectRequired(error.reason, error.details);
      }
      throw error;
    }

    // Map the account data to the expected format for tweet posting
    req.twitterAccount = {
      id: twitterAuthData.id,
      twitter_user_id: twitterAuthData.twitter_user_id,
      username: twitterAuthData.twitter_username,
      display_name: twitterAuthData.twitter_display_name || twitterAuthData.twitter_username,
      access_token: twitterAuthData.access_token,
      token_expires_at: twitterAuthData.token_expires_at,
      access_token_secret: twitterAuthData.access_token_secret,
      refresh_token: twitterAuthData.refresh_token,
      oauth1_access_token: twitterAuthData.oauth1_access_token,
      oauth1_access_token_secret: twitterAuthData.oauth1_access_token_secret,
      isTeamAccount: isTeamAccount
    };
    authLog('[validateTwitterConnection] twitterAccount mapped', {
      accountId: req.twitterAccount.id,
      twitterUserId: req.twitterAccount.twitter_user_id,
      hasAccessToken: !!req.twitterAccount.access_token,
      hasRefreshToken: !!req.twitterAccount.refresh_token,
      hasOauth1: !!(req.twitterAccount.oauth1_access_token && req.twitterAccount.oauth1_access_token_secret),
      tokenExpiresAt: req.twitterAccount.token_expires_at ? new Date(req.twitterAccount.token_expires_at).toISOString() : null,
      isTeamAccount
    });
    
    next();
  } catch (error) {
    authError('twitter_validation_error', 'Twitter validation error:', error?.message || error);
    res.status(500).json({ error: 'Failed to validate Twitter connection' });
  }
};
