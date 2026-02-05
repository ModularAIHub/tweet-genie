// cleanupController.js
// Handles cleanup of Twitter data when users/teams are deleted from main platform

import pool from '../config/database.js';

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

                // 3. Delete personal Twitter OAuth1 accounts
                const oauth1AccountsResult = await client.query(
                    'DELETE FROM twitter_oauth1_tokens WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${oauth1AccountsResult.rowCount} OAuth1 Twitter accounts`);

                await client.query('COMMIT');
                console.log(`✅ [Twitter] User data cleanup completed`);

                res.json({
                    success: true,
                    message: 'Twitter data cleaned up successfully',
                    deletedCounts: {
                        scheduledTweets: scheduledTweetsResult.rowCount,
                        teamAccounts: teamAccountsResult.rowCount,
                        oauth1Accounts: oauth1AccountsResult.rowCount
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
    }
};
