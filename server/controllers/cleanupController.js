// Handles cleanup of Twitter data when users/teams are deleted from the main platform.
// This is a hard-delete path for privacy/account-removal flows.

import pool from '../config/database.js';

const tableExists = async (client, tableName) => {
  const { rows } = await client.query('SELECT to_regclass($1) AS table_name', [tableName]);
  return Boolean(rows[0]?.table_name);
};

const deleteFromTable = async (client, tableName, whereSql, params, label, counts, countKey) => {
  if (!(await tableExists(client, tableName))) {
    counts[countKey] = 0;
    return 0;
  }

  const result = await client.query(`DELETE FROM ${tableName} ${whereSql}`, params);
  const deleted = result.rowCount || 0;
  counts[countKey] = deleted;
  console.log(`   Deleted ${deleted} ${label}`);
  return deleted;
};

const listAccountIds = async (client, whereSql, params) => {
  if (!(await tableExists(client, 'team_accounts'))) {
    return [];
  }

  const result = await client.query(`SELECT id::text AS id FROM team_accounts ${whereSql}`, params);
  return result.rows.map((row) => row.id).filter(Boolean);
};

const deleteTweetsByAccountIds = async (client, accountIds, counts, countKey) => {
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    counts[countKey] = 0;
    return 0;
  }

  return deleteFromTable(
    client,
    'tweets',
    'WHERE account_id::text = ANY($1::text[])',
    [accountIds],
    'tweets linked to deleted accounts',
    counts,
    countKey
  );
};

export const cleanupController = {
  async cleanupUserData(req, res) {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({
          error: 'userId is required',
          code: 'MISSING_USER_ID',
        });
      }

      console.log(`[Twitter Cleanup] Starting full user cleanup for ${userId}`);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const deletedCounts = {};

        const memberTeamAccountIds = await listAccountIds(client, 'WHERE user_id = $1', [userId]);

        await deleteFromTable(
          client,
          'scheduled_tweets',
          'WHERE user_id = $1',
          [userId],
          'scheduled tweets',
          deletedCounts,
          'scheduledTweets'
        );

        if (memberTeamAccountIds.length > 0) {
          await deleteFromTable(
            client,
            'tweets',
            'WHERE user_id = $1 OR account_id::text = ANY($2::text[])',
            [userId, memberTeamAccountIds],
            'tweets',
            deletedCounts,
            'tweets'
          );
        } else {
          await deleteFromTable(
            client,
            'tweets',
            'WHERE user_id = $1',
            [userId],
            'tweets',
            deletedCounts,
            'tweets'
          );
        }

        await deleteFromTable(
          client,
          'ai_generations',
          'WHERE user_id = $1',
          [userId],
          'AI generations',
          deletedCounts,
          'aiGenerations'
        );

        await deleteFromTable(
          client,
          'user_strategies',
          'WHERE user_id = $1',
          [userId],
          'strategy records',
          deletedCounts,
          'strategies'
        );

        await deleteFromTable(
          client,
          'analytics_sync_state',
          'WHERE user_id = $1',
          [userId],
          'analytics sync state records',
          deletedCounts,
          'analyticsSyncState'
        );

        await deleteFromTable(
          client,
          'analytics_precompute_cache',
          'WHERE user_id = $1',
          [userId],
          'analytics cache records',
          deletedCounts,
          'analyticsCache'
        );

        await deleteFromTable(
          client,
          'team_accounts',
          'WHERE user_id = $1',
          [userId],
          'team Twitter accounts',
          deletedCounts,
          'teamAccounts'
        );

        await deleteFromTable(
          client,
          'twitter_auth',
          'WHERE user_id = $1',
          [userId],
          'personal Twitter auth records',
          deletedCounts,
          'personalAuth'
        );

        await deleteFromTable(
          client,
          'twitter_oauth1_tokens',
          'WHERE user_id = $1',
          [userId],
          'legacy OAuth1 records',
          deletedCounts,
          'legacyOauth1'
        );

        await client.query('COMMIT');
        console.log('[Twitter Cleanup] User cleanup completed');

        return res.json({
          success: true,
          message: 'Twitter user data wiped successfully',
          deletedCounts,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[Twitter Cleanup] User cleanup error:', error);
      return res.status(500).json({
        error: 'Failed to cleanup Twitter data',
        code: 'CLEANUP_ERROR',
        message: error.message,
      });
    }
  },

  async cleanupTeamData(req, res) {
    try {
      const { teamId } = req.body;
      if (!teamId) {
        return res.status(400).json({
          error: 'teamId is required',
          code: 'MISSING_TEAM_ID',
        });
      }

      console.log(`[Twitter Cleanup] Starting full team cleanup for ${teamId}`);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const deletedCounts = {};

        const teamAccountIds = await listAccountIds(client, 'WHERE team_id = $1', [teamId]);
        await deleteTweetsByAccountIds(client, teamAccountIds, deletedCounts, 'tweets');

        await deleteFromTable(
          client,
          'scheduled_tweets',
          'WHERE team_id = $1',
          [teamId],
          'team scheduled tweets',
          deletedCounts,
          'scheduledTweets'
        );

        await deleteFromTable(
          client,
          'user_strategies',
          'WHERE team_id = $1',
          [teamId],
          'team strategies',
          deletedCounts,
          'strategies'
        );

        if (teamAccountIds.length > 0) {
          await deleteFromTable(
            client,
            'analytics_sync_state',
            'WHERE account_id = ANY($1::text[])',
            [teamAccountIds],
            'analytics sync state records for team accounts',
            deletedCounts,
            'analyticsSyncState'
          );

          await deleteFromTable(
            client,
            'analytics_precompute_cache',
            'WHERE account_id = ANY($1::text[])',
            [teamAccountIds],
            'analytics cache records for team accounts',
            deletedCounts,
            'analyticsCache'
          );
        } else {
          deletedCounts.analyticsSyncState = 0;
          deletedCounts.analyticsCache = 0;
        }

        await deleteFromTable(
          client,
          'team_accounts',
          'WHERE team_id = $1',
          [teamId],
          'team Twitter accounts',
          deletedCounts,
          'teamAccounts'
        );

        await client.query('COMMIT');
        console.log('[Twitter Cleanup] Team cleanup completed');

        return res.json({
          success: true,
          message: 'Twitter team data wiped successfully',
          deletedCounts,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[Twitter Cleanup] Team cleanup error:', error);
      return res.status(500).json({
        error: 'Failed to cleanup Twitter team data',
        code: 'CLEANUP_ERROR',
        message: error.message,
      });
    }
  },

  async cleanupMemberData(req, res) {
    try {
      const { teamId, userId } = req.body;
      if (!teamId || !userId) {
        return res.status(400).json({
          error: 'teamId and userId are required',
          code: 'MISSING_PARAMS',
        });
      }

      console.log(`[Twitter Cleanup] Starting member cleanup for user ${userId} in team ${teamId}`);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const deletedCounts = {};

        const memberAccountIds = await listAccountIds(
          client,
          'WHERE team_id = $1 AND user_id = $2',
          [teamId, userId]
        );

        await deleteTweetsByAccountIds(client, memberAccountIds, deletedCounts, 'tweets');

        await deleteFromTable(
          client,
          'scheduled_tweets',
          'WHERE team_id = $1 AND user_id = $2',
          [teamId, userId],
          'member scheduled tweets',
          deletedCounts,
          'scheduledTweets'
        );

        await deleteFromTable(
          client,
          'user_strategies',
          'WHERE team_id = $1 AND user_id = $2',
          [teamId, userId],
          'member team strategies',
          deletedCounts,
          'strategies'
        );

        if (memberAccountIds.length > 0) {
          await deleteFromTable(
            client,
            'analytics_sync_state',
            'WHERE account_id = ANY($1::text[])',
            [memberAccountIds],
            'analytics sync records for member accounts',
            deletedCounts,
            'analyticsSyncState'
          );

          await deleteFromTable(
            client,
            'analytics_precompute_cache',
            'WHERE account_id = ANY($1::text[])',
            [memberAccountIds],
            'analytics cache records for member accounts',
            deletedCounts,
            'analyticsCache'
          );
        } else {
          deletedCounts.analyticsSyncState = 0;
          deletedCounts.analyticsCache = 0;
        }

        await deleteFromTable(
          client,
          'team_accounts',
          'WHERE team_id = $1 AND user_id = $2',
          [teamId, userId],
          'member team accounts',
          deletedCounts,
          'teamAccounts'
        );

        await client.query('COMMIT');
        console.log('[Twitter Cleanup] Member cleanup completed');

        return res.json({
          success: true,
          message: 'Twitter member data wiped successfully',
          deletedCounts,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[Twitter Cleanup] Member cleanup error:', error);
      return res.status(500).json({
        error: 'Failed to cleanup Twitter member data',
        code: 'CLEANUP_ERROR',
        message: error.message,
      });
    }
  },
};
