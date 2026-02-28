import pool from '../config/database.js';
import { clearAnalyticsPrecomputeCache } from './analyticsPrecomputeCache.js';
import { fetchLatestPersonalTwitterAuth, fetchPersonalTwitterAuthById } from './personalTwitterAuth.js';

const trimText = (value, maxLength = 5000) => String(value || '').trim().slice(0, maxLength);

const normalizeCrossPostMediaInputs = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
};

const normalizeTweetHistorySource = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'external') return 'external';
  if (normalized === 'platform') return 'platform';
  return 'platform';
};

const getTeamTwitterAccountForMember = async (dbPool, platformUserId, platformTeamId) => {
  if (!platformUserId || !platformTeamId) return null;

  const { rows } = await dbPool.query(
    `SELECT ta.id, ta.team_id, ta.user_id, ta.twitter_user_id, ta.twitter_username
     FROM team_accounts ta
     INNER JOIN team_members tm
       ON tm.team_id = ta.team_id
      AND tm.user_id = $1
      AND tm.status = 'active'
     WHERE ta.team_id::text = $2::text
       AND ta.active = true
     ORDER BY
       CASE WHEN ta.user_id = $1 THEN 0 ELSE 1 END,
       ta.updated_at DESC NULLS LAST,
       ta.id DESC
     LIMIT 1`,
    [platformUserId, platformTeamId]
  );

  return rows[0] || null;
};

const getTeamTwitterAccountForMemberById = async (dbPool, platformUserId, platformTeamId, targetAccountId) => {
  if (!platformUserId || !platformTeamId || !targetAccountId) return null;

  const { rows } = await dbPool.query(
    `SELECT ta.id, ta.team_id, ta.user_id, ta.twitter_user_id, ta.twitter_username
     FROM team_accounts ta
     INNER JOIN team_members tm
       ON tm.team_id = ta.team_id
      AND tm.user_id = $1
      AND tm.status = 'active'
     WHERE ta.team_id::text = $2::text
       AND ta.id::text = $3::text
       AND ta.active = true
     LIMIT 1`,
    [platformUserId, platformTeamId, String(targetAccountId)]
  );

  return rows[0] || null;
};

export async function saveTwitterHistoryRow({
  dbPool = pool,
  userId,
  teamId = null,
  targetAccountId = null,
  content = '',
  tweetId = null,
  sourcePlatform = 'platform',
  media = [],
  postMode = 'single',
  threadParts = [],
}) {
  const platformUserId = String(userId || '').trim();
  const platformTeamId = String(teamId || '').trim() || null;
  const normalizedTargetAccountId =
    targetAccountId === undefined || targetAccountId === null
      ? null
      : String(targetAccountId).trim() || null;

  if (!platformUserId) {
    return { success: false, status: 'invalid_user' };
  }

  let account = null;
  if (normalizedTargetAccountId) {
    account = platformTeamId
      ? await getTeamTwitterAccountForMemberById(dbPool, platformUserId, platformTeamId, normalizedTargetAccountId)
      : await fetchPersonalTwitterAuthById(dbPool, platformUserId, normalizedTargetAccountId, {
          columns: 'id, user_id, twitter_user_id, twitter_username',
        });
  } else {
    account =
      (platformTeamId ? await getTeamTwitterAccountForMember(dbPool, platformUserId, platformTeamId) : null) ||
      await fetchLatestPersonalTwitterAuth(dbPool, platformUserId, {
        columns: 'id, user_id, twitter_user_id, twitter_username',
      });
  }

  if (!account) {
    return { success: false, status: 'target_not_found' };
  }

  const normalizedTweetId = String(tweetId || '').trim() || null;
  if (normalizedTweetId) {
    const { rows: existingRows } = await dbPool.query(
      `SELECT id
       FROM tweets
       WHERE user_id = $1
         AND tweet_id = $2
       LIMIT 1`,
      [platformUserId, normalizedTweetId]
    );
    if (existingRows.length > 0) {
      return {
        success: true,
        status: 'already_exists',
        historyId: existingRows[0].id,
      };
    }
  }

  const normalizedThreadParts = Array.isArray(threadParts)
    ? threadParts.map((part) => trimText(part, 280)).filter(Boolean)
    : [];
  const isThreadMode =
    String(postMode || 'single').trim().toLowerCase() === 'thread' &&
    normalizedThreadParts.length > 0;
  const historyContent = isThreadMode
    ? normalizedThreadParts.join('\n---\n')
    : trimText(content, 5000);

  if (!historyContent) {
    return { success: false, status: 'content_required' };
  }

  const safeSource = normalizeTweetHistorySource(sourcePlatform);
  const historyAccountId = platformTeamId ? account?.id || null : null;
  const threadHistoryRows = isThreadMode ? normalizedThreadParts.slice(1) : [];
  const normalizedMedia = normalizeCrossPostMediaInputs(media);

  const { rows } = await dbPool.query(
    `INSERT INTO tweets (
      user_id,
      account_id,
      author_id,
      tweet_id,
      content,
      media_urls,
      thread_tweets,
      credits_used,
      is_thread,
      thread_count,
      impressions,
      likes,
      retweets,
      replies,
      status,
      source,
      posted_at,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 0, 0, 0, 0, 'posted', $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING id`,
    [
      platformUserId,
      historyAccountId,
      account?.twitter_user_id || null,
      normalizedTweetId,
      historyContent,
      JSON.stringify(normalizedMedia),
      JSON.stringify(threadHistoryRows),
      Boolean(isThreadMode),
      isThreadMode ? normalizedThreadParts.length : 1,
      safeSource,
    ]
  );

  await clearAnalyticsPrecomputeCache(dbPool, { userId: platformUserId }).catch(() => {});

  return {
    success: true,
    status: 'saved',
    historyId: rows[0]?.id || null,
    source: safeSource,
  };
}
