// Team-related routes for TweetGenie
import express from 'express';
import { pool } from '../config/database.js';
import { listLatestPersonalTwitterAuth } from '../utils/personalTwitterAuth.js';

const router = express.Router();

const getActiveTeamIdsFromUserPayload = (user = {}) => {
  const memberships = Array.isArray(user?.teamMemberships) ? user.teamMemberships : null;
  if (!memberships) return null;

  return Array.from(
    new Set(
      memberships
        .filter((row) => String(row?.status || 'active').toLowerCase() === 'active')
        .map((row) => String(row?.teamId || row?.team_id || '').trim())
        .filter(Boolean)
    )
  );
};

const resolveValidatedTeamId = async ({ userId, hintedTeamId = null, authActiveTeamIds = null }) => {
  if (!userId) return null;

  if (Array.isArray(authActiveTeamIds)) {
    if (authActiveTeamIds.length === 0) {
      return null;
    }
    const normalizedHintedTeamId = hintedTeamId ? String(hintedTeamId).trim() : null;
    const normalizedAuthTeamIds = Array.from(
      new Set(
        authActiveTeamIds
          .map((teamId) => String(teamId || '').trim())
          .filter(Boolean)
      )
    );

    const scopedResult = await pool.query(
      `SELECT team_id
       FROM team_members
       WHERE user_id = $1
         AND status = 'active'
         AND team_id::text = ANY($2::text[])
       ORDER BY
         CASE
           WHEN $3::text IS NOT NULL AND team_id::text = $3::text THEN 0
           ELSE 1
         END,
         team_id ASC
       LIMIT 1`,
      [userId, normalizedAuthTeamIds, normalizedHintedTeamId]
    );

    return scopedResult.rows[0]?.team_id || null;
  }

  if (hintedTeamId) {
    const scopedResult = await pool.query(
      `SELECT team_id
       FROM team_members
       WHERE user_id = $1
         AND team_id = $2
         AND status = 'active'
       LIMIT 1`,
      [userId, hintedTeamId]
    );
    return scopedResult.rows[0]?.team_id || null;
  }

  const fallbackResult = await pool.query(
    `SELECT team_id
     FROM team_members
     WHERE user_id = $1
       AND status = 'active'
     ORDER BY team_id ASC
     LIMIT 1`,
    [userId]
  );

  return fallbackResult.rows[0]?.team_id || null;
};

// GET /api/team/accounts - Get all connected Twitter accounts for the authenticated user's team
router.get('/accounts', async (req, res) => {
  try {
    const userId = req.user?.userId || req.ssoUser?.userId || req.user?.id;
    const hintedTeamId = req.ssoUser?.teamId || req.user?.teamId || req.user?.team_id || null;
    const authActiveTeamIds = getActiveTeamIdsFromUserPayload(req.user);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const validatedTeamId = await resolveValidatedTeamId({ userId, hintedTeamId, authActiveTeamIds });
    const isTeamContext = Boolean(validatedTeamId);
    let accounts = [];

    if (isTeamContext) {
      const result = await pool.query(
        `SELECT
           ta.id,
           ta.team_id,
           'twitter' as platform,
           ta.twitter_username as account_username,
           ta.twitter_display_name as account_display_name,
           ta.twitter_user_id as account_id,
           ta.twitter_profile_image_url as profile_image_url,
           ta.updated_at as created_at,
           ta.updated_at as last_used_at
         FROM team_accounts ta
         INNER JOIN team_members tm
           ON tm.team_id = ta.team_id
          AND tm.user_id = $2
          AND tm.status = 'active'
         WHERE ta.team_id = $1
           AND ta.active = true
         ORDER BY
           CASE WHEN ta.user_id = $2 THEN 0 ELSE 1 END,
           ta.updated_at DESC`,
        [validatedTeamId, userId]
      );
      accounts = result.rows;
    } else {
      const personalAccounts = await listLatestPersonalTwitterAuth(pool, userId, {
        columns: `id,
                  twitter_username as account_username,
                  twitter_display_name as account_display_name,
                  twitter_user_id as account_id,
                  twitter_profile_image_url as profile_image_url,
                  created_at`,
      });

      accounts = personalAccounts.map((account) => ({
        ...account,
        platform: 'twitter',
      }));
    }

    const accountsWithNicknames = accounts.map((account) => ({
      ...account,
      nickname: account.account_display_name || account.account_username,
      isTeamAccount: isTeamContext,
      team_id: isTeamContext ? (account.team_id || validatedTeamId) : null,
    }));

    return res.json({
      success: true,
      accounts: accountsWithNicknames,
      totalAccounts: accountsWithNicknames.length,
      teamId: validatedTeamId || null,
      context: isTeamContext ? 'team' : 'individual',
    });
  } catch (error) {
    console.error('Error fetching team accounts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch team accounts',
      error: error.message,
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
        message: 'No account currently selected',
      });
    }

    const userId = req.user?.userId || req.ssoUser?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const hintedTeamId = req.ssoUser?.teamId || req.user?.teamId || req.user?.team_id || null;
    const authActiveTeamIds = getActiveTeamIdsFromUserPayload(req.user);
    const validatedTeamId = await resolveValidatedTeamId({ userId, hintedTeamId, authActiveTeamIds });

    let result;
    if (validatedTeamId) {
      result = await pool.query(
        `SELECT
           id,
           team_id,
           'twitter' as platform,
           twitter_username as account_username,
           twitter_display_name as account_display_name,
           twitter_user_id as account_id,
           twitter_profile_image_url as profile_image_url
         FROM team_accounts
         WHERE id::text = $1::text
           AND team_id::text = $2::text
           AND active = true
         LIMIT 1`,
        [selectedAccountId, validatedTeamId]
      );
    } else {
      result = await pool.query(
        `SELECT
           id,
           twitter_username as account_username,
           twitter_display_name as account_display_name,
           twitter_user_id as account_id,
           twitter_profile_image_url as profile_image_url
         FROM twitter_auth
         WHERE id = $1
           AND user_id = $2
         LIMIT 1`,
        [selectedAccountId, userId]
      );
    }

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        currentAccount: null,
        message: 'Selected account not found',
      });
    }

    const account = result.rows[0];
    return res.json({
      success: true,
      currentAccount: {
        ...account,
        nickname: account.account_display_name || account.account_username,
        isTeamAccount: Boolean(validatedTeamId),
      },
    });
  } catch (error) {
    console.error('Error fetching current account:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch current account',
      error: error.message,
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
        message: 'Account ID is required',
      });
    }

    const userId = req.user?.userId || req.ssoUser?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const hintedTeamId = req.ssoUser?.teamId || req.user?.teamId || req.user?.team_id || null;
    const authActiveTeamIds = getActiveTeamIdsFromUserPayload(req.user);
    const validatedTeamId = await resolveValidatedTeamId({ userId, hintedTeamId, authActiveTeamIds });

    let result;
    if (validatedTeamId) {
      result = await pool.query(
        `SELECT id
         FROM team_accounts
         WHERE id::text = $1::text
           AND team_id::text = $2::text
           AND active = true`,
        [accountId, validatedTeamId]
      );
    } else {
      result = await pool.query(
        `SELECT id
         FROM twitter_auth
         WHERE id = $1
           AND user_id = $2`,
        [accountId, userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Account not found or access denied',
      });
    }

    req.session.selectedAccountId = accountId;

    if (validatedTeamId) {
      await pool.query(
        `UPDATE team_accounts
         SET updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [accountId]
      );
    }

    return res.json({
      success: true,
      selectedAccountId: accountId,
      message: 'Account selected successfully',
    });
  } catch (error) {
    console.error('Error selecting account:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to select account',
      error: error.message,
    });
  }
});

export default router;
