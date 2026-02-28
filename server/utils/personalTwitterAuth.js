const PERSONAL_TWITTER_AUTH_ORDER_BY = `
  updated_at DESC NULLS LAST,
  created_at DESC NULLS LAST,
  id DESC
`;

export const fetchLatestPersonalTwitterAuth = async (dbPool, userId, { columns = '*' } = {}) => {
  if (!userId) return null;

  const { rows } = await dbPool.query(
    `SELECT ${columns}
     FROM twitter_auth
     WHERE user_id = $1
     ORDER BY ${PERSONAL_TWITTER_AUTH_ORDER_BY}
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
};

export const fetchPersonalTwitterAuthById = async (dbPool, userId, targetAccountId, { columns = '*' } = {}) => {
  if (!userId || !targetAccountId) return null;

  const { rows } = await dbPool.query(
    `SELECT ${columns}
     FROM twitter_auth
     WHERE user_id = $1
       AND (
         id::text = $2::text
         OR twitter_user_id::text = $2::text
       )
     ORDER BY ${PERSONAL_TWITTER_AUTH_ORDER_BY}
     LIMIT 1`,
    [userId, String(targetAccountId)]
  );

  return rows[0] || null;
};

export const listLatestPersonalTwitterAuth = async (dbPool, userId, { columns = '*' } = {}) => {
  const latest = await fetchLatestPersonalTwitterAuth(dbPool, userId, { columns });
  return latest ? [latest] : [];
};

export const cleanupDuplicatePersonalTwitterAuth = async (dbPool, userId) => {
  if (!userId) return 0;

  const { rows } = await dbPool.query(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY ${PERSONAL_TWITTER_AUTH_ORDER_BY}
         ) AS rn
       FROM twitter_auth
       WHERE user_id = $1
     ),
     deleted AS (
       DELETE FROM twitter_auth ta
       USING ranked r
       WHERE ta.id = r.id
         AND r.rn > 1
       RETURNING ta.id
     )
     SELECT COUNT(*)::int AS deleted_count
     FROM deleted`,
    [userId]
  );

  return rows[0]?.deleted_count || 0;
};
