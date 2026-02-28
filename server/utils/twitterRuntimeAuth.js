import { TwitterApi } from 'twitter-api-v2';

const TWITTER_OAUTH1_APP_KEY = process.env.TWITTER_API_KEY || process.env.TWITTER_CONSUMER_KEY || null;
const TWITTER_OAUTH1_APP_SECRET = process.env.TWITTER_API_SECRET || process.env.TWITTER_CONSUMER_SECRET || null;
const TWITTER_REFRESH_THRESHOLD_MS = Number.parseInt(
  process.env.TWITTER_TOKEN_REFRESH_THRESHOLD_MS || String(10 * 60 * 1000),
  10
);

const refreshInflight = new Map();

export class TwitterReconnectRequiredError extends Error {
  constructor(reason, details = null) {
    super(details || 'Twitter account requires reconnection');
    this.name = 'TwitterReconnectRequiredError';
    this.code = 'TWITTER_RECONNECT_REQUIRED';
    this.reason = reason || 'not_connected';
    this.details = details || null;
  }
}

const isDateValue = (value) => {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
};

const getSafeDate = (value) => {
  if (!isDateValue(value)) return null;
  return value instanceof Date ? value : new Date(value);
};

const hasOauth1AppConfig = () => Boolean(TWITTER_OAUTH1_APP_KEY && TWITTER_OAUTH1_APP_SECRET);
const hasOauth2RefreshConfig = () =>
  Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);

const getRefreshLockKey = (account, accountType = 'personal') => {
  const accountId = String(account?.id || account?.user_id || account?.twitter_user_id || 'unknown');
  return `${accountType}:${accountId}`;
};

const withRefreshLock = async (lockKey, task) => {
  const existing = refreshInflight.get(lockKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => task())();
  refreshInflight.set(lockKey, promise);

  try {
    return await promise;
  } finally {
    if (refreshInflight.get(lockKey) === promise) {
      refreshInflight.delete(lockKey);
    }
  }
};

const getTableName = (accountType) => (accountType === 'team' ? 'team_accounts' : 'twitter_auth');

const getReadableAccountLabel = (accountType) => (accountType === 'team' ? 'team' : 'personal');

export const hasTwitterOauth1Credentials = (account) =>
  Boolean(account?.oauth1_access_token && account?.oauth1_access_token_secret);

export const hasTwitterOauth2Access = (account) => Boolean(account?.access_token);

export const getTwitterConnectionStatus = (
  account,
  { now = Date.now(), thresholdMs = TWITTER_REFRESH_THRESHOLD_MS } = {}
) => {
  const hasOauth1 = hasTwitterOauth1Credentials(account);
  const hasOauth2 = hasTwitterOauth2Access(account);
  const expiresAt = getSafeDate(account?.token_expires_at);
  const expiresAtMs = expiresAt ? expiresAt.getTime() : null;
  const hasKnownExpiry = Number.isFinite(expiresAtMs);
  const isExpired = hasKnownExpiry ? expiresAtMs <= now : false;
  const needsRefresh = hasKnownExpiry ? expiresAtMs <= now + thresholdMs : false;
  const minutesUntilExpiry = hasKnownExpiry
    ? Math.floor((expiresAtMs - now) / (60 * 1000))
    : (hasOauth1 ? Number.POSITIVE_INFINITY : null);
  const canRefreshOauth2 = Boolean(account?.refresh_token) && hasOauth2RefreshConfig();
  const postingCapable = hasOauth1 || (hasOauth2 && (!hasKnownExpiry || !isExpired));
  const mediaCapable = hasOauth1;
  const readCapable = postingCapable;

  return {
    hasOauth1,
    hasOauth2,
    expiresAt,
    expiresAtIso: expiresAt ? expiresAt.toISOString() : null,
    hasKnownExpiry,
    isExpired,
    needsRefresh,
    minutesUntilExpiry,
    canRefreshOauth2,
    postingCapable,
    mediaCapable,
    readCapable,
  };
};

const loadCurrentAccountRow = async (dbPool, account, accountType) => {
  if (!dbPool || !account?.id) return account;

  const tableName = getTableName(accountType);
  const { rows } = await dbPool.query(
    `SELECT *
     FROM ${tableName}
     WHERE id = $1
     LIMIT 1`,
    [account.id]
  );

  return rows[0] || account;
};

const persistOauth2Refresh = async (dbPool, account, accountType, payload) => {
  const tableName = getTableName(accountType);
  const expiresInSeconds = Number(payload?.expires_in);
  const tokenExpiresAt = new Date(
    Date.now() + ((Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 7200) * 1000)
  );

  const refreshToken = payload?.refresh_token || account?.refresh_token || null;
  const { rows } = await dbPool.query(
    `UPDATE ${tableName}
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [payload.access_token, refreshToken, tokenExpiresAt, account.id]
  );

  return rows[0] || {
    ...account,
    access_token: payload.access_token,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
  };
};

export const refreshTwitterOauth2IfNeeded = async ({
  dbPool,
  account,
  accountType = 'personal',
  force = false,
  thresholdMs = TWITTER_REFRESH_THRESHOLD_MS,
  reason = 'unknown',
  onLog = null,
} = {}) => {
  if (!account) {
    return {
      account: null,
      refreshed: false,
      attempted: false,
      status: getTwitterConnectionStatus(null, { thresholdMs }),
      error: null,
    };
  }

  const log = typeof onLog === 'function' ? onLog : () => {};
  const initialStatus = getTwitterConnectionStatus(account, { thresholdMs });

  const shouldAttemptRefreshInitially =
    force || initialStatus.needsRefresh || (!initialStatus.postingCapable && Boolean(account?.refresh_token));

  if (!shouldAttemptRefreshInitially) {
    return {
      account,
      refreshed: false,
      attempted: false,
      status: initialStatus,
      error: null,
    };
  }

  if (!account.refresh_token) {
    return {
      account,
      refreshed: false,
      attempted: false,
      status: initialStatus,
      error: initialStatus.isExpired
        ? {
            reason: 'token_expired_no_refresh',
            details: 'Twitter access token expired and no refresh token is available.',
          }
        : null,
    };
  }

  if (!hasOauth2RefreshConfig()) {
    return {
      account,
      refreshed: false,
      attempted: false,
      status: initialStatus,
      error: initialStatus.isExpired
        ? {
            reason: 'token_refresh_not_configured',
            details: 'TWITTER_CLIENT_ID/TWITTER_CLIENT_SECRET are not configured.',
          }
        : null,
    };
  }

  const lockKey = getRefreshLockKey(account, accountType);

  return withRefreshLock(lockKey, async () => {
    let currentAccount = await loadCurrentAccountRow(dbPool, account, accountType);
    let currentStatus = getTwitterConnectionStatus(currentAccount, { thresholdMs });

    const shouldAttemptRefreshNow =
      force || currentStatus.needsRefresh || (!currentStatus.postingCapable && Boolean(currentAccount?.refresh_token));

    if (!shouldAttemptRefreshNow) {
      return {
        account: currentAccount,
        refreshed: false,
        attempted: false,
        status: currentStatus,
        error: null,
      };
    }

    if (!currentAccount.refresh_token) {
      return {
        account: currentAccount,
        refreshed: false,
        attempted: false,
        status: currentStatus,
        error: currentStatus.isExpired
          ? {
              reason: 'token_expired_no_refresh',
              details: 'Twitter access token expired and no refresh token is available.',
            }
          : null,
      };
    }

    log('[twitterRuntimeAuth] refreshing OAuth2 token', {
      accountType,
      accountId: currentAccount.id,
      twitterUserId: currentAccount.twitter_user_id,
      reason,
      expiresAt: currentStatus.expiresAtIso,
      minutesUntilExpiry: currentStatus.minutesUntilExpiry,
    });

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
          refresh_token: currentAccount.refresh_token,
          client_id: process.env.TWITTER_CLIENT_ID,
        }),
      });

      const payload = await refreshResponse.json().catch(() => ({}));
      if (!refreshResponse.ok || !payload?.access_token) {
        return {
          account: currentAccount,
          refreshed: false,
          attempted: true,
          status: currentStatus,
          error: {
            reason: 'token_refresh_failed',
            details:
              payload?.error_description ||
              payload?.error ||
              `Twitter refresh failed with HTTP ${refreshResponse.status}`,
          },
        };
      }

      currentAccount = await persistOauth2Refresh(dbPool, currentAccount, accountType, payload);
      currentStatus = getTwitterConnectionStatus(currentAccount, { thresholdMs });

      log('[twitterRuntimeAuth] OAuth2 token refreshed', {
        accountType,
        accountId: currentAccount.id,
        twitterUserId: currentAccount.twitter_user_id,
        expiresAt: currentStatus.expiresAtIso,
      });

      return {
        account: currentAccount,
        refreshed: true,
        attempted: true,
        status: currentStatus,
        error: null,
      };
    } catch (error) {
      return {
        account: currentAccount,
        refreshed: false,
        attempted: true,
        status: currentStatus,
        error: {
          reason: 'token_refresh_error',
          details: error?.message || 'Twitter token refresh failed.',
        },
      };
    }
  });
};

export const ensureTwitterAccountReady = async ({
  dbPool,
  account,
  accountType = 'personal',
  thresholdMs = TWITTER_REFRESH_THRESHOLD_MS,
  reason = 'unknown',
  onLog = null,
} = {}) => {
  if (!account) {
    throw new TwitterReconnectRequiredError('not_connected', 'Twitter account not connected.');
  }

  const log = typeof onLog === 'function' ? onLog : () => {};
  let currentAccount = account;
  let status = getTwitterConnectionStatus(currentAccount, { thresholdMs });

  if ((status.needsRefresh || (!status.postingCapable && status.canRefreshOauth2)) && status.canRefreshOauth2) {
    const refreshResult = await refreshTwitterOauth2IfNeeded({
      dbPool,
      account: currentAccount,
      accountType,
      thresholdMs,
      reason,
      force: !status.postingCapable,
      onLog,
    });

    currentAccount = refreshResult.account || currentAccount;
    status = refreshResult.status || getTwitterConnectionStatus(currentAccount, { thresholdMs });

    if (refreshResult.error) {
      log('[twitterRuntimeAuth] OAuth2 refresh did not complete cleanly', {
        accountType,
        accountId: currentAccount?.id,
        reason: refreshResult.error.reason,
        details: refreshResult.error.details,
      });
    }
  }

  status = getTwitterConnectionStatus(currentAccount, { thresholdMs });

  if (status.postingCapable) {
    return { account: currentAccount, status };
  }

  const accountLabel = getReadableAccountLabel(accountType);
  const reconnectReason = status.isExpired ? 'token_expired' : 'not_connected';
  const reconnectDetails = status.isExpired
    ? `Twitter ${accountLabel} access token expired and could not be refreshed.`
    : `Twitter ${accountLabel} account is not connected.`;

  throw new TwitterReconnectRequiredError(reconnectReason, reconnectDetails);
};

export const createTwitterApiClient = (
  account,
  { preferOAuth1 = false, allowOAuth1Fallback = true } = {}
) => {
  const hasOauth1 = hasTwitterOauth1Credentials(account) && hasOauth1AppConfig();
  const status = getTwitterConnectionStatus(account);

  if (preferOAuth1 && hasOauth1) {
    return new TwitterApi({
      appKey: TWITTER_OAUTH1_APP_KEY,
      appSecret: TWITTER_OAUTH1_APP_SECRET,
      accessToken: account.oauth1_access_token,
      accessSecret: account.oauth1_access_token_secret,
    });
  }

  if (account?.access_token && !(status.isExpired && hasOauth1 && allowOAuth1Fallback)) {
    return new TwitterApi(account.access_token);
  }

  if (allowOAuth1Fallback && hasOauth1) {
    return new TwitterApi({
      appKey: TWITTER_OAUTH1_APP_KEY,
      appSecret: TWITTER_OAUTH1_APP_SECRET,
      accessToken: account.oauth1_access_token,
      accessSecret: account.oauth1_access_token_secret,
    });
  }

  return null;
};

export const createTwitterPostingClient = (account, { preferOAuth1 = false } = {}) =>
  createTwitterApiClient(account, { preferOAuth1, allowOAuth1Fallback: true });

export const createTwitterReadClient = (account) =>
  createTwitterApiClient(account, { preferOAuth1: false, allowOAuth1Fallback: true });
