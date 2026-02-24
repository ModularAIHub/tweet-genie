import pool from '../config/database.js';
import { logger } from './logger.js';

export const DEFAULT_X_CHAR_LIMIT = 280;
export const EXTENDED_X_CHAR_LIMIT = (() => {
  const parsed = Number.parseInt(process.env.X_EXTENDED_CHAR_LIMIT || '2000', 10);
  if (!Number.isFinite(parsed)) return 2000;
  return Math.min(2000, Math.max(DEFAULT_X_CHAR_LIMIT + 1, parsed));
})();
export const MAX_X_CHAR_LIMIT = EXTENDED_X_CHAR_LIMIT;

const TABLE_NAME = 'twitter_account_posting_preferences';
let ensureTablePromise = null;

const toCompositeKey = (scopeType, scopeKey) => `${scopeType}:${scopeKey}`;

const normalizeCharLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_X_CHAR_LIMIT;
  if (parsed <= DEFAULT_X_CHAR_LIMIT) return DEFAULT_X_CHAR_LIMIT;
  return Math.min(MAX_X_CHAR_LIMIT, parsed);
};

const normalizeStoredPreferences = (row = null) => {
  if (!row) {
    return {
      x_char_limit: DEFAULT_X_CHAR_LIMIT,
      x_long_post_enabled: false,
    };
  }

  const xCharLimit = normalizeCharLimit(row.x_char_limit);
  const xLongPostEnabled = Boolean(row.x_long_post_enabled) || xCharLimit > DEFAULT_X_CHAR_LIMIT;

  return {
    x_char_limit: xLongPostEnabled ? xCharLimit : DEFAULT_X_CHAR_LIMIT,
    x_long_post_enabled: xLongPostEnabled,
  };
};

export const buildTwitterPostingPreferenceScope = ({
  userId = null,
  accountId = null,
  isTeamAccount = false,
} = {}) => {
  if (isTeamAccount) {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) return null;
    return { scopeType: 'team_account', scopeKey: normalizedAccountId };
  }

  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;
  return { scopeType: 'personal_user', scopeKey: normalizedUserId };
};

export const ensureTwitterPostingPreferencesTable = async () => {
  if (!ensureTablePromise) {
    ensureTablePromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
           scope_type TEXT NOT NULL,
           scope_key TEXT NOT NULL,
           x_char_limit INTEGER NOT NULL DEFAULT ${DEFAULT_X_CHAR_LIMIT},
           x_long_post_enabled BOOLEAN NOT NULL DEFAULT false,
           updated_by TEXT NULL,
           created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (scope_type, scope_key)
         )`
      )
      .catch((error) => {
        ensureTablePromise = null;
        throw error;
      });
  }

  await ensureTablePromise;
};

export const getTwitterPostingPreferences = async ({
  userId = null,
  accountId = null,
  isTeamAccount = false,
} = {}) => {
  const scope = buildTwitterPostingPreferenceScope({ userId, accountId, isTeamAccount });
  if (!scope) {
    return normalizeStoredPreferences(null);
  }

  try {
    await ensureTwitterPostingPreferencesTable();
    const { rows } = await pool.query(
      `SELECT x_char_limit, x_long_post_enabled
       FROM ${TABLE_NAME}
       WHERE scope_type = $1 AND scope_key = $2
       LIMIT 1`,
      [scope.scopeType, scope.scopeKey]
    );
    return normalizeStoredPreferences(rows[0] || null);
  } catch (error) {
    logger.warn('[twitter-posting-prefs] Failed to read posting preferences. Falling back to defaults.', {
      error: error?.message || String(error),
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
    });
    return normalizeStoredPreferences(null);
  }
};

export const getTwitterPostingPreferencesMap = async (scopes = []) => {
  const normalizedScopes = Array.isArray(scopes)
    ? scopes
        .map((scope) =>
          buildTwitterPostingPreferenceScope({
            userId: scope?.userId,
            accountId: scope?.accountId,
            isTeamAccount: Boolean(scope?.isTeamAccount),
          })
        )
        .filter(Boolean)
    : [];

  const uniqueScopes = [];
  const seenKeys = new Set();
  for (const scope of normalizedScopes) {
    const compositeKey = toCompositeKey(scope.scopeType, scope.scopeKey);
    if (seenKeys.has(compositeKey)) continue;
    seenKeys.add(compositeKey);
    uniqueScopes.push(scope);
  }

  const results = new Map();
  for (const scope of uniqueScopes) {
    results.set(toCompositeKey(scope.scopeType, scope.scopeKey), normalizeStoredPreferences(null));
  }

  if (uniqueScopes.length === 0) {
    return results;
  }

  try {
    await ensureTwitterPostingPreferencesTable();
    const compositeKeys = uniqueScopes.map((scope) => toCompositeKey(scope.scopeType, scope.scopeKey));
    const { rows } = await pool.query(
      `SELECT scope_type, scope_key, x_char_limit, x_long_post_enabled
       FROM ${TABLE_NAME}
       WHERE (scope_type || ':' || scope_key) = ANY($1::text[])`,
      [compositeKeys]
    );

    for (const row of rows) {
      results.set(toCompositeKey(row.scope_type, row.scope_key), normalizeStoredPreferences(row));
    }
  } catch (error) {
    logger.warn('[twitter-posting-prefs] Failed to read posting preferences map. Falling back to defaults.', {
      error: error?.message || String(error),
      requestedScopes: uniqueScopes.length,
    });
  }

  return results;
};

export const attachTwitterPostingPreferencesToAccount = async (account, options = {}) => {
  if (!account || typeof account !== 'object') return account;

  const prefs = await getTwitterPostingPreferences({
    userId: options.userId || account.user_id || null,
    accountId: options.accountId || account.id || null,
    isTeamAccount:
      typeof options.isTeamAccount === 'boolean'
        ? options.isTeamAccount
        : Boolean(account.isTeamAccount || account.team_id),
  });

  return {
    ...account,
    ...prefs,
  };
};

export const resolveTwitterCharLimit = (account) => {
  if (!account || typeof account !== 'object') return DEFAULT_X_CHAR_LIMIT;
  return normalizeCharLimit(account.x_char_limit);
};

export const upsertTwitterPostingPreferences = async ({
  userId = null,
  accountId = null,
  isTeamAccount = false,
  xLongPostEnabled = false,
  xCharLimit = null,
  updatedBy = null,
} = {}) => {
  const scope = buildTwitterPostingPreferenceScope({ userId, accountId, isTeamAccount });
  if (!scope) {
    throw new Error('Unable to resolve Twitter posting preference scope');
  }

  const longPostEnabled = Boolean(xLongPostEnabled) || Number(xCharLimit) > DEFAULT_X_CHAR_LIMIT;
  const effectiveLimit = longPostEnabled
    ? normalizeCharLimit(xCharLimit || EXTENDED_X_CHAR_LIMIT)
    : DEFAULT_X_CHAR_LIMIT;

  await ensureTwitterPostingPreferencesTable();

  const { rows } = await pool.query(
    `INSERT INTO ${TABLE_NAME} (scope_type, scope_key, x_char_limit, x_long_post_enabled, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (scope_type, scope_key)
     DO UPDATE SET
       x_char_limit = EXCLUDED.x_char_limit,
       x_long_post_enabled = EXCLUDED.x_long_post_enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP
     RETURNING scope_type, scope_key, x_char_limit, x_long_post_enabled, updated_at`,
    [scope.scopeType, scope.scopeKey, effectiveLimit, longPostEnabled, updatedBy ? String(updatedBy) : null]
  );

  return {
    scopeType: scope.scopeType,
    scopeKey: scope.scopeKey,
    ...normalizeStoredPreferences(rows[0] || null),
    updated_at: rows[0]?.updated_at || null,
  };
};
