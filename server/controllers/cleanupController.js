// cleanupController.js
// Handles cleanup of Twitter data when users/teams are deleted from main platform

import pool from '../config/database.js';

const tableExists = async (client, tableName) => {
    const { rows } = await client.query('SELECT to_regclass($1) AS table_name', [tableName]);
    return !!rows[0]?.table_name;
};

export const cleanupController = {
    // Clean up all Twitter data for a deleted user
    async cleanupUserData(req, res) {
        try {
            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({
                    error: 'userId is required',
                    code: 'MISSING_USER_ID'
                });
            }

            console.log(`🗑️ [Twitter] Starting cleanup for user: ${userId}`);

            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // 1. Delete scheduled tweets created by this user
                const scheduledTweetsResult = await client.query(
                    'DELETE FROM scheduled_tweets WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${scheduledTweetsResult.rowCount} scheduled tweets`);

                // 2. Delete team Twitter accounts (OAuth2) connected by this user
                const teamAccountsResult = await client.query(
                    'DELETE FROM team_accounts WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${teamAccountsResult.rowCount} team Twitter accounts`);

                // 3. Delete personal Twitter auth data (current table)
                const personalAuthResult = await client.query(
                    'DELETE FROM twitter_auth WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${personalAuthResult.rowCount} personal Twitter auth records`);

                // 4. Best-effort cleanup for legacy table if it still exists
                let legacyOauth1Deleted = 0;
                const hasLegacyOauth1Table = await tableExists(client, 'twitter_oauth1_tokens');
                if (hasLegacyOauth1Table) {
                    const legacyResult = await client.query(
                        'DELETE FROM twitter_oauth1_tokens WHERE user_id = $1',
                        [userId]
                    );
                    legacyOauth1Deleted = legacyResult.rowCount;
                    console.log(`   ✓ Deleted ${legacyOauth1Deleted} legacy OAuth1 Twitter records`);
                } else {
                    console.log('   ↷ Skipped legacy cleanup: twitter_oauth1_tokens table does not exist');
                }

                await client.query('COMMIT');
                console.log(`✅ [Twitter] User data cleanup completed`);

                res.json({
                    success: true,
                    message: 'Twitter data cleaned up successfully',
                    deletedCounts: {
                        scheduledTweets: scheduledTweetsResult.rowCount,
                        teamAccounts: teamAccountsResult.rowCount,
                        personalAuth: personalAuthResult.rowCount,
                        oauth1Accounts: legacyOauth1Deleted
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ [Twitter] Cleanup error:', error);
            res.status(500).json({
                error: 'Failed to cleanup Twitter data',
                code: 'CLEANUP_ERROR',
                message: error.message
            });
        }
    },

    // Clean up all Twitter data for a deleted team
    async cleanupTeamData(req, res) {
        try {
            const { teamId } = req.body;

            if (!teamId) {
                return res.status(400).json({
                    error: 'teamId is required',
                    code: 'MISSING_TEAM_ID'
                });
            }

            console.log(`🗑️ [Twitter] Starting cleanup for team: ${teamId}`);

            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // 1. Delete team Twitter accounts (OAuth2)
                const teamAccountsResult = await client.query(
                    'DELETE FROM team_accounts WHERE team_id = $1',
                    [teamId]
                );
                console.log(`   ✓ Deleted ${teamAccountsResult.rowCount} team Twitter accounts`);

                // 2. Delete scheduled tweets for this team
                const scheduledTweetsResult = await client.query(
                    'DELETE FROM scheduled_tweets WHERE team_id = $1',
                    [teamId]
                );
                console.log(`   ✓ Deleted ${scheduledTweetsResult.rowCount} team scheduled tweets`);

                await client.query('COMMIT');
                console.log(`✅ [Twitter] Team data cleanup completed`);

                res.json({
                    success: true,
                    message: 'Twitter team data cleaned up successfully',
                    deletedCounts: {
                        teamAccounts: teamAccountsResult.rowCount,
                        scheduledTweets: scheduledTweetsResult.rowCount
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ [Twitter] Team cleanup error:', error);
            res.status(500).json({
                error: 'Failed to cleanup Twitter team data',
                code: 'CLEANUP_ERROR',
                message: error.message
            });
        }
    },

    // Clean up Twitter data when a member leaves/is removed from a team
    async cleanupMemberData(req, res) {
        try {
            const { teamId, userId } = req.body;

            if (!teamId || !userId) {
                return res.status(400).json({
                    error: 'teamId and userId are required',
                    code: 'MISSING_PARAMS'
                });
            }

            console.log(`🗑️ [Twitter] Starting cleanup for member ${userId} leaving team ${teamId}`);

            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Delete Twitter team accounts connected by this user for this team
                const teamAccountsResult = await client.query(
                    'DELETE FROM team_accounts WHERE team_id = $1 AND user_id = $2',
                    [teamId, userId]
                );
                console.log(`   ✓ Deleted ${teamAccountsResult.rowCount} Twitter accounts for member`);

                // Delete scheduled tweets created by this user for this team
                const scheduledTweetsResult = await client.query(
                    'DELETE FROM scheduled_tweets WHERE team_id = $1 AND user_id = $2',
                    [teamId, userId]
                );
                console.log(`   ✓ Deleted ${scheduledTweetsResult.rowCount} scheduled tweets for member`);

                await client.query('COMMIT');
                console.log(`✅ [Twitter] Member cleanup completed`);

                res.json({
                    success: true,
                    message: 'Twitter member data cleaned up successfully',
                    deletedCounts: {
                        teamAccounts: teamAccountsResult.rowCount,
                        scheduledTweets: scheduledTweetsResult.rowCount
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ [Twitter] Member cleanup error:', error);
            res.status(500).json({
                error: 'Failed to cleanup Twitter member data',
                code: 'CLEANUP_ERROR',
                message: error.message
            });
        }
    }
};
