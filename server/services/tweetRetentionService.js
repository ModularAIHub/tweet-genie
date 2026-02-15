import pool from '../config/database.js';

const parsedRetentionDays = Number.parseInt(process.env.DELETED_TWEET_RETENTION_DAYS || '15', 10);
export const DELETED_TWEET_RETENTION_DAYS =
  Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0 ? parsedRetentionDays : 15;

const RETENTION_DEBUG = process.env.DELETED_TWEET_RETENTION_DEBUG === 'true';

let schemaReady = false;
let schemaPromise = null;

const retentionLog = (...args) => {
  if (RETENTION_DEBUG) {
    console.log('[TweetRetention]', ...args);
  }
};

export const getTweetDeletionVisibilityClause = ({ alias = 't', retentionDaysParamIndex }) => {
  if (!Number.isFinite(retentionDaysParamIndex) || retentionDaysParamIndex <= 0) {
    throw new Error('retentionDaysParamIndex is required');
  }

  return ` AND (
    ${alias}.status <> 'deleted'
    OR COALESCE(${alias}.deleted_at, ${alias}.updated_at, ${alias}.created_at) >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ($${retentionDaysParamIndex}::int * INTERVAL '1 day')
  )`;
};

export const getTweetDeletionRetentionWindow = () => ({
  days: DELETED_TWEET_RETENTION_DAYS,
  message: `Deleted tweets stay visible for ${DELETED_TWEET_RETENTION_DAYS} days before permanent cleanup.`,
});

export async function ensureTweetDeletionRetentionSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      ALTER TABLE tweets
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tweets_deleted_retention
      ON tweets (deleted_at)
      WHERE status = 'deleted'
    `);

    schemaReady = true;
    retentionLog('Retention schema ensured');
  })()
    .catch((error) => {
      schemaReady = false;
      throw error;
    })
    .finally(() => {
      schemaPromise = null;
    });

  return schemaPromise;
}

export async function markTweetDeleted(tweetId, options = {}) {
  if (!tweetId) {
    throw new Error('tweetId is required');
  }

  await ensureTweetDeletionRetentionSchema();
  const db = options.client && typeof options.client.query === 'function' ? options.client : pool;

  const result = await db.query(
    `UPDATE tweets
     SET status = 'deleted',
         deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, status, deleted_at`,
    [tweetId]
  );

  return result.rows[0] || null;
}

export async function purgeExpiredDeletedTweets(options = {}) {
  await ensureTweetDeletionRetentionSchema();

  const db = options.client && typeof options.client.query === 'function' ? options.client : pool;
  const { userId = null, accountIds = null } = options;

  const params = [DELETED_TWEET_RETENTION_DAYS];
  let whereClause = `
    status = 'deleted'
    AND COALESCE(deleted_at, updated_at, created_at) <
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')
  `;

  if (userId) {
    params.push(userId);
    whereClause += ` AND user_id = $${params.length}`;
  }

  if (Array.isArray(accountIds) && accountIds.length > 0) {
    params.push(accountIds.map((id) => String(id)));
    whereClause += ` AND account_id::text = ANY($${params.length}::text[])`;
  }

  const result = await db.query(
    `DELETE FROM tweets
     WHERE ${whereClause}`,
    params
  );

  return { deletedCount: result.rowCount || 0 };
}

