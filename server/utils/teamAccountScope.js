export const resolveTeamAccountScope = async (pool, userId, selectedAccountId) => {
  if (!userId || !selectedAccountId) {
    return null;
  }

  const { rows: selectedRows } = await pool.query(
    `SELECT ta.id, ta.team_id, ta.twitter_user_id
     FROM team_accounts ta
     INNER JOIN team_members tm
       ON tm.team_id = ta.team_id
      AND tm.user_id = $2
      AND tm.status = 'active'
     WHERE ta.id::TEXT = $1::TEXT
       AND ta.active = true
      LIMIT 1`,
    [selectedAccountId, userId]
  );

  if (selectedRows.length === 0) {
    return null;
  }

  const selected = selectedRows[0];

  const [relatedIdsResult, activeCountResult] = await Promise.all([
    pool.query(
      `SELECT id
       FROM team_accounts
       WHERE team_id = $1 AND twitter_user_id = $2`,
      [selected.team_id, selected.twitter_user_id]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS active_count
       FROM team_accounts
       WHERE team_id = $1 AND active = true`,
      [selected.team_id]
    ),
  ]);

  const relatedAccountIds = Array.from(
    new Set(
      relatedIdsResult.rows
        .map((row) => Number(row.id))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );

  const selectedId = Number(selected.id);
  if (Number.isInteger(selectedId) && selectedId > 0 && !relatedAccountIds.includes(selectedId)) {
    relatedAccountIds.push(selectedId);
  }

  if (relatedAccountIds.length === 0) {
    return null;
  }

  const activeAccountCount = activeCountResult.rows[0]?.active_count ?? 0;

  return {
    selectedAccountId: String(selected.id),
    teamId: String(selected.team_id),
    twitterUserId: String(selected.twitter_user_id),
    relatedAccountIds,
    allowOrphanFallback: activeAccountCount <= 1,
    activeAccountCount,
  };
};

const qualify = (alias, column) => (alias ? `${alias}.${column}` : column);

export const buildTeamAccountFilter = ({
  scope,
  alias = '',
  startIndex = 1,
  includeAuthorFallback = true,
  includeOrphanFallback = false,
  orphanUserId = null,
}) => {
  if (!scope || !Array.isArray(scope.relatedAccountIds) || scope.relatedAccountIds.length === 0) {
    return { clause: '', params: [], nextIndex: startIndex };
  }

  const conditions = [];
  const params = [];

  const relatedAccountIdsIndex = startIndex + params.length;
  params.push(scope.relatedAccountIds);
  conditions.push(`${qualify(alias, 'account_id')} = ANY($${relatedAccountIdsIndex}::int[])`);

  if (includeAuthorFallback && scope.twitterUserId) {
    const authorIdIndex = startIndex + params.length;
    params.push(scope.twitterUserId);
    conditions.push(`${qualify(alias, 'author_id')} = $${authorIdIndex}`);
  }

  if (includeOrphanFallback) {
    const includeOrphans = Boolean(scope.allowOrphanFallback && orphanUserId);
    const includeOrphansIndex = startIndex + params.length;
    params.push(includeOrphans);

    const orphanUserIdIndex = startIndex + params.length;
    params.push(orphanUserId || '');

    conditions.push(`(
      $${includeOrphansIndex}::boolean = true
      AND ${qualify(alias, 'user_id')} = $${orphanUserIdIndex}
      AND ${qualify(alias, 'account_id')} IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM team_accounts ta_scope
        WHERE ta_scope.id = ${qualify(alias, 'account_id')}
      )
    )`);
  }

  return {
    clause: ` AND (${conditions.join(' OR ')})`,
    params,
    nextIndex: startIndex + params.length,
  };
};
