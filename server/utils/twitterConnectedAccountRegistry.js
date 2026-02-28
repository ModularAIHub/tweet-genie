import crypto from 'crypto';

const TWITTER_PLATFORM = 'twitter';
const LOOKUP_ORDER_BY = `
  updated_at DESC NULLS LAST,
  created_at DESC NULLS LAST,
  id DESC
`;

const normalizeString = (value, maxLen = null) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (Number.isFinite(maxLen) && maxLen > 0) {
    return normalized.slice(0, maxLen);
  }
  return normalized;
};

const normalizeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeMetadataObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const buildScopeWhereClause = (teamId) =>
  teamId
    ? `team_id::text = $1::text`
    : `user_id = $1 AND team_id IS NULL`;

const buildTwitterRegistryMetadata = ({
  sourceTable,
  sourceId,
  teamId = null,
  twitterUserId,
  hasOAuth1,
  verified = false,
  metadata = {},
}) => ({
  ...normalizeMetadataObject(metadata),
  source_table: sourceTable,
  source_id: sourceId ?? null,
  legacy_row_id: sourceId ?? null,
  scope: teamId ? 'team' : 'personal',
  twitter_user_id: twitterUserId,
  has_oauth1: Boolean(hasOAuth1),
  verified: Boolean(verified),
});

export const mapTwitterRegistryInputFromSourceRow = (sourceTable, row = {}) => ({
  userId: normalizeString(row.user_id, 128),
  teamId: normalizeString(row.team_id, 128),
  sourceTable,
  sourceId: row.id ?? null,
  twitterUserId: normalizeString(row.twitter_user_id, 255),
  twitterUsername: normalizeString(row.twitter_username, 255),
  displayName: normalizeString(row.twitter_display_name, 255),
  profileImageUrl: normalizeString(row.twitter_profile_image_url, 2048),
  accessToken: normalizeString(row.access_token),
  refreshToken: normalizeString(row.refresh_token),
  tokenExpiresAt: row.token_expires_at || null,
  followersCount: normalizeCount(row.followers_count),
  hasOAuth1: Boolean(row.oauth1_access_token && row.oauth1_access_token_secret),
  verified: Boolean(row.verified),
  metadata: {},
});

export const findMatchingTwitterConnectedAccounts = async (
  db,
  { userId, teamId = null, twitterUserId, sourceTable = null, sourceId = null }
) => {
  const normalizedUserId = normalizeString(userId, 128);
  const normalizedTeamId = normalizeString(teamId, 128);
  const normalizedTwitterUserId = normalizeString(twitterUserId, 255);
  const normalizedSourceTable = normalizeString(sourceTable, 128);
  const normalizedSourceId =
    sourceId === undefined || sourceId === null ? null : normalizeString(sourceId, 255);

  if (!normalizedUserId) return [];
  if (!normalizedTwitterUserId && !(normalizedSourceTable && normalizedSourceId)) return [];

  const scopeValue = normalizedTeamId || normalizedUserId;
  const params = [scopeValue];
  let paramIndex = params.length;
  const predicates = [];

  if (normalizedTwitterUserId) {
    paramIndex += 1;
    params.push(normalizedTwitterUserId);
    predicates.push(`account_id = $${paramIndex}`);
  }

  if (normalizedSourceTable && normalizedSourceId) {
    paramIndex += 1;
    params.push(normalizedSourceTable);
    const sourceTableIndex = paramIndex;
    paramIndex += 1;
    params.push(normalizedSourceId);
    predicates.push(
      `(metadata->>'source_table' = $${sourceTableIndex} AND metadata->>'source_id' = $${paramIndex})`
    );
  }

  const { rows } = await db.query(
    `SELECT id, metadata, is_active
     FROM social_connected_accounts
     WHERE ${buildScopeWhereClause(normalizedTeamId)}
       AND platform = '${TWITTER_PLATFORM}'
       AND (${predicates.join(' OR ')})
     ORDER BY ${LOOKUP_ORDER_BY}`,
    params
  );

  return rows;
};

export const listTwitterConnectedAccounts = async (db, { userId, teamId = null }) => {
  const normalizedUserId = normalizeString(userId, 128);
  const normalizedTeamId = normalizeString(teamId, 128);
  if (!normalizedUserId) return [];

  const { rows } = await db.query(
    normalizedTeamId
      ? `SELECT
           id::text,
           COALESCE(NULLIF(metadata->>'source_id', ''), id::text) AS source_id,
           metadata->>'source_table' AS source_table,
           account_id AS twitter_user_id,
           account_username AS twitter_username,
           account_display_name AS twitter_display_name,
           profile_image_url AS twitter_profile_image_url,
           COALESCE((metadata->>'has_oauth1')::boolean, false) AS has_oauth1
         FROM social_connected_accounts
         WHERE team_id::text = $1::text
           AND platform = '${TWITTER_PLATFORM}'
           AND is_active = true
         ORDER BY
           CASE WHEN COALESCE((metadata->>'has_oauth1')::boolean, false) THEN 0 ELSE 1 END,
           updated_at DESC NULLS LAST,
           created_at DESC NULLS LAST,
           id DESC`
      : `SELECT
           id::text,
           COALESCE(NULLIF(metadata->>'source_id', ''), id::text) AS source_id,
           metadata->>'source_table' AS source_table,
           account_id AS twitter_user_id,
           account_username AS twitter_username,
           account_display_name AS twitter_display_name,
           profile_image_url AS twitter_profile_image_url,
           COALESCE((metadata->>'has_oauth1')::boolean, false) AS has_oauth1
         FROM social_connected_accounts
         WHERE user_id = $1
           AND team_id IS NULL
           AND platform = '${TWITTER_PLATFORM}'
           AND is_active = true
         ORDER BY
           CASE WHEN COALESCE((metadata->>'has_oauth1')::boolean, false) THEN 0 ELSE 1 END,
           updated_at DESC NULLS LAST,
           created_at DESC NULLS LAST,
           id DESC`,
    [normalizedTeamId || normalizedUserId]
  );

  return rows;
};

export const upsertTwitterConnectedAccount = async (db, input = {}) => {
  const normalizedUserId = normalizeString(input.userId, 128);
  const normalizedTeamId = normalizeString(input.teamId, 128);
  const normalizedSourceTable = normalizeString(input.sourceTable, 128);
  const normalizedSourceId =
    input.sourceId === undefined || input.sourceId === null
      ? null
      : normalizeString(input.sourceId, 255);
  const normalizedTwitterUserId = normalizeString(input.twitterUserId, 255);

  if (!normalizedUserId || !normalizedSourceTable || !normalizedTwitterUserId) {
    throw new Error('Twitter connected account upsert requires userId, sourceTable, and twitterUserId');
  }

  const accountUsername = normalizeString(input.twitterUsername, 255);
  const accountDisplayName = normalizeString(input.displayName, 255) || accountUsername;
  const accessToken = normalizeString(input.accessToken);
  const refreshToken = normalizeString(input.refreshToken);
  const tokenExpiresAt = input.tokenExpiresAt || null;
  const profileImageUrl = normalizeString(input.profileImageUrl, 2048);
  const followersCount = normalizeCount(input.followersCount);
  const connectedBy = normalizeString(input.connectedBy, 128) || normalizedUserId;
  const lookupRows = await findMatchingTwitterConnectedAccounts(db, {
    userId: normalizedUserId,
    teamId: normalizedTeamId,
    twitterUserId: normalizedTwitterUserId,
    sourceTable: normalizedSourceTable,
    sourceId: normalizedSourceId,
  });

  const [canonicalRow, ...duplicateRows] = lookupRows;
  if (duplicateRows.length > 0) {
    await db.query(
      `UPDATE social_connected_accounts
       SET is_active = false,
           updated_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'deduped_by', 'twitter_registry_upsert',
             'deduped_at', NOW()::text
           )
       WHERE id = ANY($1::uuid[])`,
      [duplicateRows.map((row) => row.id)]
    );
  }

  const mergedMetadata = buildTwitterRegistryMetadata({
    sourceTable: normalizedSourceTable,
    sourceId: normalizedSourceId,
    teamId: normalizedTeamId,
    twitterUserId: normalizedTwitterUserId,
    hasOAuth1: input.hasOAuth1,
    verified: input.verified,
    metadata: {
      ...normalizeMetadataObject(canonicalRow?.metadata),
      ...normalizeMetadataObject(input.metadata),
    },
  });

  if (canonicalRow?.id) {
    await db.query(
      `UPDATE social_connected_accounts
       SET user_id = $1,
           team_id = $2,
           account_id = $3,
           account_username = $4,
           account_display_name = $5,
           access_token = $6,
           refresh_token = $7,
           token_expires_at = $8,
           profile_image_url = $9,
           followers_count = $10,
           metadata = $11::jsonb,
           connected_by = $12,
           is_active = true,
           updated_at = NOW()
       WHERE id = $13`,
      [
        normalizedUserId,
        normalizedTeamId,
        normalizedTwitterUserId,
        accountUsername,
        accountDisplayName,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        profileImageUrl,
        followersCount,
        JSON.stringify(mergedMetadata),
        connectedBy,
        canonicalRow.id,
      ]
    );

    return {
      id: canonicalRow.id,
      action: 'updated',
      dedupedCount: duplicateRows.length,
    };
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO social_connected_accounts (
      id, user_id, team_id, platform, account_id, account_username, account_display_name,
      access_token, refresh_token, token_expires_at, profile_image_url, followers_count,
      metadata, connected_by, is_active
    ) VALUES (
      $1, $2, $3, '${TWITTER_PLATFORM}', $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12::jsonb, $13, true
    )`,
    [
      id,
      normalizedUserId,
      normalizedTeamId,
      normalizedTwitterUserId,
      accountUsername,
      accountDisplayName,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      profileImageUrl,
      followersCount,
      JSON.stringify(mergedMetadata),
      connectedBy,
    ]
  );

  return {
    id,
    action: 'inserted',
    dedupedCount: duplicateRows.length,
  };
};

export const deactivateTwitterConnectedAccount = async (
  db,
  { userId, teamId = null, twitterUserId = null, sourceTable = null, sourceId = null }
) => {
  const rows = await findMatchingTwitterConnectedAccounts(db, {
    userId,
    teamId,
    twitterUserId,
    sourceTable,
    sourceId,
  });

  if (!rows.length) {
    return 0;
  }

  await db.query(
    `UPDATE social_connected_accounts
     SET is_active = false,
         access_token = NULL,
         refresh_token = NULL,
         token_expires_at = NULL,
         updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'deactivated_at', NOW()::text,
           'deactivated_by', 'twitter_disconnect'
         )
     WHERE id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)]
  );

  return rows.length;
};
