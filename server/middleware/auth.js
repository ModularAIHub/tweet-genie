import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';

const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';
const AUTH_PLATFORM_TIMEOUT_MS = Number(process.env.AUTH_PLATFORM_TIMEOUT_MS || 2000);
const AUTH_PLATFORM_CACHE_TTL_MS = Number(process.env.AUTH_PLATFORM_CACHE_TTL_MS || 60 * 1000);
const AUTH_PLATFORM_CACHE_MAX_ENTRIES = Number(process.env.AUTH_PLATFORM_CACHE_MAX_ENTRIES || 500);
const AUTH_PLATFORM_STALE_FALLBACK_MS = Number(process.env.AUTH_PLATFORM_STALE_FALLBACK_MS || 10 * 60 * 1000);
const AUTH_TEAM_CACHE_TTL_MS = Number(process.env.AUTH_TEAM_CACHE_TTL_MS || 60 * 1000);
const AUTH_TEAM_CACHE_MAX_ENTRIES = Number(process.env.AUTH_TEAM_CACHE_MAX_ENTRIES || 500);
const AUTH_PERF_ENABLED =
  process.env.AUTH_PERF_ENABLED === 'true' ||
  (process.env.AUTH_PERF_ENABLED !== 'false' && process.env.NODE_ENV !== 'production');

const platformUserCache = new Map();
const teamMembershipCache = new Map();

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

const isHtmlRequest = (req) => req.headers.accept && req.headers.accept.includes('text/html');

const getCurrentUrl = (req) => `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;

const getPlatformLoginUrl = (req) =>
  `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(getCurrentUrl(req))}`;

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
      console.warn('[auth] JWT verification failed:', jwtError.name);

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
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        ...platformCacheEntry.value,
      };
      platformSource = 'cache';
    } else {
      bumpPerf('platformCacheMiss');
      const platformLookupStart = Date.now();

      try {
        const response = await axios.get(`${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: AUTH_PLATFORM_TIMEOUT_MS,
        });
        recordPerfDuration('platformLookup', Date.now() - platformLookupStart);
        bumpPerf('platformNetworkSuccess');

        const platformUser = response.data || {};
        setCacheEntry(
          platformUserCache,
          token,
          platformUser,
          AUTH_PLATFORM_CACHE_TTL_MS,
          AUTH_PLATFORM_CACHE_MAX_ENTRIES
        );

        req.user = {
          id: decoded.userId,
          email: decoded.email,
          ...platformUser,
        };
        platformSource = 'network';
      } catch (platformError) {
        recordPerfDuration('platformLookup', Date.now() - platformLookupStart);
        bumpPerf('platformNetworkError');

        const isTimeout = platformError.code === 'ECONNABORTED' || platformError.code === 'ETIMEDOUT';
        const canUseStaleCache = hasStaleFallbackEntry(platformCacheEntry, now);

        console.warn('[auth] platform /api/auth/me failed', {
          status: platformError.response?.status,
          code: platformError.code,
          isTimeout,
          canUseStaleCache,
        });

        if (canUseStaleCache) {
          bumpPerf('platformStaleFallbackHit');
          req.user = {
            id: decoded.userId,
            email: decoded.email,
            ...platformCacheEntry.value,
          };
          platformSource = 'stale-cache';
        } else if (isTimeout) {
          bumpPerf('platformTimeoutFallback');
          req.user = {
            id: decoded.userId,
            email: decoded.email,
            name: decoded.name || '',
            team_id: null,
            teamMemberships: [],
          };
          platformSource = 'jwt-timeout-fallback';
        } else if (!isHtmlRequest(req)) {
          bumpPerf('platformApiFallback');
          req.user = {
            id: decoded.userId,
            email: decoded.email,
          };
          platformSource = 'jwt-api-fallback';
        } else if (platformError.response?.status === 401 || platformError.response?.status === 403) {
          bumpPerf('platformAuthRedirects');
          bumpPerf('redirectToLogin');
          finish();
          return res.redirect(getPlatformLoginUrl(req));
        } else {
          bumpPerf('platformJwtFallback');
          req.user = {
            id: decoded.userId,
            email: decoded.email,
          };
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
          const teamMembershipResult = await pool.query(
            `SELECT team_id, role, status FROM team_members WHERE user_id = $1 AND status = 'active'`,
            [req.user.id]
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
          console.error('[auth] error querying team memberships:', teamErr.message);
          req.user.teamId = null;
          req.user.team_id = null;
          req.user.teamMemberships = [];
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
    
    // Check for selected team account first (from header)
    const selectedAccountId = req.headers['x-selected-account-id'];
    const userId = req.user?.id || req.user?.userId;
    const teamId = req.user?.teamId || req.user?.team_id || req.ssoUser?.teamId;

    // Only try team account lookup if user is actually in a team AND has selected account ID
    if (selectedAccountId && teamId) {
      try {
        // Try to get team account credentials (OAuth2)
        const { rows } = await pool.query(
          'SELECT * FROM team_accounts WHERE id = $1 AND team_id = $2 AND active = true',
          [selectedAccountId, teamId]
        );
        if (rows.length > 0) {
          twitterAuthData = rows[0];
          isTeamAccount = true;
        }
      } catch (teamQueryErr) {
        // If team account query fails (e.g., invalid UUID format), ignore and fall back to personal account
        console.log('[validateTwitterConnection] Team account query failed, falling back to personal account:', teamQueryErr.message);
      }
    }
    
    // Fall back to personal twitter_auth if no team account
    if (!twitterAuthData) {
      const { rows } = await pool.query(
        'SELECT * FROM twitter_auth WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Twitter account not connected' });
      }

      twitterAuthData = rows[0];
    }
    
    // Check if token is expired or expiring soon (refresh 10 minutes before expiry)
    const now = new Date();
    const tokenExpiry = new Date(twitterAuthData.token_expires_at);
    const refreshThreshold = new Date(tokenExpiry.getTime() - (10 * 60 * 1000)); // 10 minutes before expiry
    const minutesUntilExpiry = Math.floor((tokenExpiry - now) / (60 * 1000));
    
    console.log('[Twitter Token Status]', {
      accountType: isTeamAccount ? 'team' : 'personal',
      expiresAt: tokenExpiry.toISOString(),
      minutesUntilExpiry,
      isExpired: tokenExpiry <= now,
      needsRefresh: now >= refreshThreshold
    });
    
    if (tokenExpiry <= now || now >= refreshThreshold) {
      const isExpired = tokenExpiry <= now;
      console.log(`[Twitter Token] ${isExpired ? '⚠️ Token EXPIRED' : '⏰ Token expiring soon, attempting refresh...'} (${minutesUntilExpiry} minutes until expiry)`);
      
      // Try to refresh the token if we have a refresh token
      if (twitterAuthData.refresh_token) {
        try {
          const credentials = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
          
          const refreshResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${credentials}`
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: twitterAuthData.refresh_token,
              client_id: process.env.TWITTER_CLIENT_ID,
            }),
          });

          const tokens = await refreshResponse.json();
          
          if (tokens.access_token) {
            console.log('✅ Twitter token refreshed successfully');
            // Update tokens in database
            const newExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
            console.log('[Twitter Token] New expiry:', newExpiresAt.toISOString());
            
            if (isTeamAccount) {
              // Update team_accounts table
              await pool.query(
                'UPDATE team_accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
                [tokens.access_token, tokens.refresh_token || twitterAuthData.refresh_token, newExpiresAt, twitterAuthData.id]
              );
            } else {
              // Update twitter_auth table
              await pool.query(
                'UPDATE twitter_auth SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4',
                [tokens.access_token, tokens.refresh_token || twitterAuthData.refresh_token, newExpiresAt, userId]
              );
            }
            
            // Use the new token
            twitterAuthData.access_token = tokens.access_token;
            twitterAuthData.refresh_token = tokens.refresh_token || twitterAuthData.refresh_token;
            twitterAuthData.token_expires_at = newExpiresAt;
          } else {
            console.warn('⚠️ Twitter token refresh returned no access token:', tokens);
            // Only return error if token is actually expired, not just expiring soon
            if (isExpired) {
              console.error('❌ Token expired and cannot be refreshed. User must reconnect.');
              return res.status(401).json({ 
                error: 'Twitter token expired and refresh failed. Please reconnect your Twitter account.',
                code: 'TWITTER_TOKEN_EXPIRED',
                action: 'reconnect_twitter',
                details: tokens.error_description || tokens.error,
                minutesUntilExpiry: 0
              });
            } else {
              console.warn(`⚠️ Token refresh failed but token still valid for ${minutesUntilExpiry} minutes. Continuing...`);
            }
          }
        } catch (refreshError) {
          console.error('❌ Twitter token refresh error:', refreshError.message);
          // Only return error if token is actually expired, not just expiring soon
          if (isExpired) {
            console.error('❌ Token expired and refresh failed. User must reconnect their Twitter account.');
            return res.status(401).json({ 
              error: 'Twitter token expired and refresh failed. Please reconnect your Twitter account.',
              code: 'TWITTER_TOKEN_EXPIRED',
              action: 'reconnect_twitter',
              details: refreshError.message,
              minutesUntilExpiry: 0
            });
          } else {
            console.warn(`⚠️ Token refresh failed but token still valid for ${minutesUntilExpiry} minutes. Continuing...`);
          }
        }
      } else {
        console.warn('⚠️ No refresh token available for this account');
        // Only return error if token is actually expired, not just expiring soon
        if (isExpired) {
          console.error('❌ Token expired and no refresh token. User must reconnect their Twitter account.');
          return res.status(401).json({ 
            error: 'Twitter token expired. Please reconnect your Twitter account.',
            code: 'TWITTER_TOKEN_EXPIRED',
            action: 'reconnect_twitter',
            minutesUntilExpiry: 0
          });
        } else {
          console.warn(`⚠️ No refresh token but token still valid for ${minutesUntilExpiry} minutes. Continuing...`);
        }
      }
    } else {
      console.log(`✅ Twitter token valid for ${minutesUntilExpiry} minutes`);
    }

    // Map the account data to the expected format for tweet posting
    req.twitterAccount = {
      id: twitterAuthData.id,
      twitter_user_id: twitterAuthData.twitter_user_id,
      username: twitterAuthData.twitter_username,
      display_name: twitterAuthData.twitter_display_name || twitterAuthData.twitter_username,
      access_token: twitterAuthData.access_token,
      access_token_secret: twitterAuthData.access_token_secret,
      refresh_token: twitterAuthData.refresh_token,
      oauth1_access_token: twitterAuthData.oauth1_access_token,
      oauth1_access_token_secret: twitterAuthData.oauth1_access_token_secret,
      isTeamAccount: isTeamAccount
    };
    
    next();
  } catch (error) {
    console.error('Twitter validation error:', error);
    res.status(500).json({ error: 'Failed to validate Twitter connection' });
  }
};

