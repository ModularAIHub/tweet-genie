// Team-related routes for TweetGenie
import express from 'express';
import { pool } from '../config/database.js';

const router = express.Router();

// GET /api/team/accounts - Get all connected Twitter accounts for the authenticated user's team
router.get('/accounts', async (req, res) => {
    try {
        // Get user info from SSO session or regular auth
    const userId = req.user?.userId || req.ssoUser?.userId || req.user?.id;
    const teamId = req.ssoUser?.teamId || req.user?.teamId || req.user?.team_id;
    console.log('[DEBUG /api/team/accounts] userId:', userId, 'teamId:', teamId);
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not authenticated' 
            });
        }

        let accounts = [];

        if (teamId) {
            // SSO or patched user - get team accounts
            console.log(`[DEBUG /api/team/accounts] Fetching team accounts for teamId: ${teamId}`);
            const result = await pool.query(`
                SELECT 
                    id,
                    platform,
                    account_username,
                    account_display_name,
                    account_id,
                    profile_image_url,
                    created_at,
                    last_used_at
                FROM user_social_accounts 
                WHERE team_id = $1 
                AND platform = 'twitter' 
                AND is_active = true
                ORDER BY connection_order ASC, created_at ASC
            `, [teamId]);
            accounts = result.rows;
            console.log(`[DEBUG /api/team/accounts] Query result:`, accounts);
            console.log(`✅ Found ${accounts.length} team Twitter accounts`);
        } else {
            // Regular user - get individual accounts from twitter_auth table
            console.log(`[DEBUG /api/team/accounts] Fetching individual accounts for userId: ${userId}`);
            const result = await pool.query(`
                SELECT 
                    id,
                    username as account_username,
                    display_name as account_display_name,
                    twitter_user_id as account_id,
                    profile_image_url,
                    created_at
                FROM twitter_auth 
                WHERE user_id = $1
                ORDER BY created_at ASC
            `, [userId]);
            // Transform to match team accounts format
            accounts = result.rows.map(account => ({
                ...account,
                platform: 'twitter'
            }));
            console.log(`[DEBUG /api/team/accounts] Query result:`, accounts);
            console.log(`✅ Found ${accounts.length} individual Twitter accounts`);
        }

        // Add account nicknames if available
        const accountsWithNicknames = accounts.map(account => ({
            ...account,
            nickname: account.account_display_name || account.account_username,
            isTeamAccount: !!teamId
        }));

        res.json({
            success: true,
            accounts: accountsWithNicknames,
            totalAccounts: accounts.length,
            teamId: teamId || null,
            context: teamId ? 'team' : 'individual'
        });

    } catch (error) {
        console.error('❌ Error fetching team accounts:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch team accounts',
            error: error.message 
        });
    }
});

// GET /api/team/current-account - Get currently selected account
router.get('/current-account', async (req, res) => {
    try {
        const selectedAccountId = req.session?.selectedAccountId;
        
        if (!selectedAccountId) {
            return res.json({
                success: true,
                currentAccount: null,
                message: 'No account currently selected'
            });
        }

        // Fetch the selected account details
        const teamId = req.ssoUser?.teamId;
        let result;

        if (teamId) {
            // Team account
            result = await pool.query(`
                SELECT 
                    id,
                    platform,
                    account_username,
                    account_display_name,
                    account_id,
                    profile_image_url
                FROM user_social_accounts 
                WHERE id = $1 AND team_id = $2 AND is_active = true
            `, [selectedAccountId, teamId]);
        } else {
            // Individual account
            result = await pool.query(`
                SELECT 
                    id,
                    username as account_username,
                    display_name as account_display_name,
                    twitter_user_id as account_id,
                    profile_image_url
                FROM twitter_auth 
                WHERE id = $1 AND user_id = $2
            `, [selectedAccountId, req.user.userId]);
        }

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                currentAccount: null,
                message: 'Selected account not found'
            });
        }

        const account = result.rows[0];
        res.json({
            success: true,
            currentAccount: {
                ...account,
                nickname: account.account_display_name || account.account_username,
                isTeamAccount: !!teamId
            }
        });

    } catch (error) {
        console.error('❌ Error fetching current account:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch current account',
            error: error.message 
        });
    }
});

// POST /api/team/select-account - Select an account to work with
router.post('/select-account', async (req, res) => {
    try {
        const { accountId } = req.body;
        
        if (!accountId) {
            return res.status(400).json({
                success: false,
                message: 'Account ID is required'
            });
        }

        // Verify the account belongs to the user/team
        const userId = req.user?.userId || req.ssoUser?.userId;
        const teamId = req.ssoUser?.teamId;
        let result;

        if (teamId) {
            // Verify team account
            result = await pool.query(`
                SELECT id FROM user_social_accounts 
                WHERE id = $1 AND team_id = $2 AND is_active = true
            `, [accountId, teamId]);
        } else {
            // Verify individual account
            result = await pool.query(`
                SELECT id FROM twitter_auth 
                WHERE id = $1 AND user_id = $2
            `, [accountId, userId]);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Account not found or access denied'
            });
        }

        // Store selection in session
        req.session.selectedAccountId = accountId;
        
        // Update last_used_at for team accounts
        if (teamId) {
            await pool.query(`
                UPDATE user_social_accounts 
                SET last_used_at = CURRENT_TIMESTAMP 
                WHERE id = $1
            `, [accountId]);
        }

        console.log(`✅ Account selected: ${accountId} for ${teamId ? 'team' : 'user'}: ${teamId || userId}`);

        res.json({
            success: true,
            selectedAccountId: accountId,
            message: 'Account selected successfully'
        });

    } catch (error) {
        console.error('❌ Error selecting account:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to select account',
            error: error.message 
        });
    }
});

export default router;