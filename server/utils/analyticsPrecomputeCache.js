export const clearAnalyticsPrecomputeCache = async (dbPool, { userId, accountId = null } = {}) => {
  if (!userId) return;

  const normalizedAccountId = accountId === null || accountId === undefined ? null : String(accountId);

  try {
    if (normalizedAccountId) {
      await dbPool.query(
        `DELETE FROM analytics_precompute_cache
         WHERE user_id = $1
           AND account_id = $2`,
        [userId, normalizedAccountId]
      );
      return;
    }

    await dbPool.query(
      `DELETE FROM analytics_precompute_cache
       WHERE user_id = $1`,
      [userId]
    );
  } catch (error) {
    if (error?.code === '42P01') {
      return;
    }
    throw error;
  }
};
