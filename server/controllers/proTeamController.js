// // tweet-genie/server/controllers/proTeamController.js
// import db from '../config/database.js';

// // Fetch team social accounts for the authenticated user
// export async function getTeamSocialAccounts(req, res) {
//   try {
//     const user = req.user;
//     console.log('[proTeamController] Incoming user object:', user);
//     const teamId = user.team_id || user.teamId || (user.teamMemberships && user.teamMemberships[0]?.teamId);
//     console.log('[proTeamController] Using teamId for query:', teamId);
//     if (!teamId) {
//       return res.status(400).json({ error: 'No team ID found for user.' });
//     }

//     // Query user_social_accounts for team Twitter accounts
//     console.log('[proTeamController] Querying user_social_accounts with:', {
//       teamId,
//       platform: 'twitter',
//       is_active: true
//     });
//     const result = await db.query(`
//       SELECT 
//         id,
//         platform,
//         account_username,
//         account_display_name,
//         account_id,
//         profile_image_url,
//         created_at
//       FROM user_social_accounts 
//       WHERE team_id = $1 
//         AND platform = 'twitter' 
//         AND is_active = true
//       ORDER BY created_at ASC
//     `, [teamId]);
//     console.log('[proTeamController] Raw DB result:', result);
//     if (result.rows.length === 0) {
//         console.log('[proTeamController] NO ROWS FOUND');
//     } else {
//         console.log('[proTeamController] Returned first row:', result.rows[0]);
//     }
//     console.log('[proTeamController] Query result:', result.rows);
//     const accounts = result.rows.map(account => ({
//       ...account,
//       nickname: account.account_display_name || account.account_username,
//       isTeamAccount: true
//     }));
//     return res.json({ accounts });
//   } catch (err) {
//     console.error('[proTeamController] Error fetching team social accounts:', err);
//     res.status(500).json({ error: 'Failed to fetch team social accounts.' });
//   }
// }

// tweet-genie/server/controllers/proTeamController.js
import db from '../config/database.js';

// Fetch team social accounts for the authenticated user
export async function getTeamSocialAccounts(req, res) {
  try {
    const user = req.user;
    console.log('[proTeamController] Incoming user object:', user);
    const teamId = user.team_id || user.teamId || (user.teamMemberships && user.teamMemberships[0]?.teamId);
    console.log('[proTeamController] Using teamId for query:', teamId);
    
    if (!teamId) {
      return res.status(400).json({ error: 'No team ID found for user.' });
    }

    // First, verify user is a member of this team
    const { rows: memberRows } = await db.query(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
      [teamId, user.id, 'active']
    );
    
    if (memberRows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    console.log('[proTeamController] Querying team_accounts with:', {
      teamId,
      active: true
    });

    // Query team_accounts table for Twitter accounts with OAuth credentials
    const result = await db.query(`
      SELECT 
        id,
        team_id,
        twitter_username as account_username,
        username as account_display_name,
        twitter_user_id as account_id,
        profile_image_url,
        access_token,
        oauth1_access_token,
        oauth1_access_token_secret,
        active,
        created_at,
        updated_at
      FROM team_accounts 
      WHERE team_id = $1 
        AND active = true
      ORDER BY created_at ASC
    `, [teamId]);

    console.log('[proTeamController] Raw DB result from team_accounts:', result);
    
    if (result.rows.length === 0) {
      console.log('[proTeamController] NO TEAM ACCOUNTS FOUND');
      // Check if there are any team accounts at all (even inactive)
      const { rows: allAccounts } = await db.query(
        'SELECT id, active FROM team_accounts WHERE team_id = $1',
        [teamId]
      );
      console.log('[proTeamController] All team accounts (including inactive):', allAccounts);
    } else {
      console.log('[proTeamController] Returned first row:', result.rows[0]);
      console.log('[proTeamController] Has OAuth 1.0a tokens:', {
        hasOAuth1Token: !!result.rows[0].oauth1_access_token,
        hasOAuth1Secret: !!result.rows[0].oauth1_access_token_secret,
        hasOAuth2Token: !!result.rows[0].access_token
      });
    }

    const accounts = result.rows.map(account => ({
      id: account.id,
      platform: 'twitter',
      account_username: account.account_username,
      account_display_name: account.account_display_name || account.account_username,
      account_id: account.account_id,
      profile_image_url: account.profile_image_url,
      nickname: account.account_display_name || account.account_username,
      isTeamAccount: true,
      team_id: account.team_id,
      // Include credential info (without exposing the actual tokens)
      hasOAuth1: !!(account.oauth1_access_token && account.oauth1_access_token_secret),
      hasOAuth2: !!account.access_token,
      created_at: account.created_at,
      updated_at: account.updated_at
    }));

    console.log('[proTeamController] Returning accounts:', accounts);
    return res.json({ accounts });
    
  } catch (err) {
    console.error('[proTeamController] Error fetching team social accounts:', err);
    res.status(500).json({ error: 'Failed to fetch team social accounts.' });
  }
}

// Get team account credentials (for internal use - do not expose tokens to frontend)
export async function getTeamAccountCredentials(req, res) {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    // Get the account with credentials
    const { rows } = await db.query(
      `SELECT ta.*, tm.role
       FROM team_accounts ta
       JOIN team_members tm ON ta.team_id = tm.team_id
       WHERE ta.id = $1 AND tm.user_id = $2 AND tm.status = 'active' AND ta.active = true`,
      [accountId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Team account not found or access denied' });
    }

    const account = rows[0];
    
    // Return account info with credential availability
    return res.json({
      id: account.id,
      team_id: account.team_id,
      twitter_username: account.twitter_username,
      hasOAuth1: !!(account.oauth1_access_token && account.oauth1_access_token_secret),
      hasOAuth2: !!account.access_token,
      active: account.active
    });

  } catch (err) {
    console.error('[proTeamController] Error fetching team account credentials:', err);
    res.status(500).json({ error: 'Failed to fetch account credentials' });
  }
}

// Disconnect a Twitter account from a team
export async function disconnectTeamTwitterAccount(req, res) {
  try {
    const user = req.user;
    const { accountId } = req.params;
    const teamId = user.team_id || user.teamId || (user.teamMemberships && user.teamMemberships[0]?.teamId);
    console.log('[disconnectTeamTwitterAccount] accountId:', accountId, 'teamId:', teamId);
    if (!teamId) {
      console.log('[disconnectTeamTwitterAccount] No team ID found for user:', user);
      return res.status(400).json({ error: 'No team ID found for user.' });
    }

    // Verify user is owner or admin
    const { rows: memberRows } = await db.query(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
      [teamId, user.id, 'active']
    );
    console.log('[disconnectTeamTwitterAccount] memberRows:', memberRows);
    if (memberRows.length === 0) {
      console.log('[disconnectTeamTwitterAccount] Not a member of this team:', teamId, user.id);
      return res.status(403).json({ error: 'Not a member of this team' });
    }
    const role = memberRows[0].role;
    console.log('[disconnectTeamTwitterAccount] user role:', role);
    if (role !== 'owner' && role !== 'admin') {
      console.log('[disconnectTeamTwitterAccount] User not authorized to disconnect:', role);
      return res.status(403).json({ error: 'Only team owners and admins can disconnect social accounts' });
    }

    // Check if account exists before delete
    const { rows: accountRows } = await db.query(
      'SELECT * FROM team_accounts WHERE id = $1 AND team_id = $2',
      [accountId, teamId]
    );
    console.log('[disconnectTeamTwitterAccount] accountRows:', accountRows);
    if (accountRows.length === 0) {
      console.log('[disconnectTeamTwitterAccount] Account not found for id/team:', accountId, teamId);
      return res.status(404).json({ error: 'Account not found or already disconnected' });
    }

    // Delete the Twitter account from team_accounts
    const { rowCount } = await db.query(
      'DELETE FROM team_accounts WHERE id = $1 AND team_id = $2',
      [accountId, teamId]
    );
    console.log('[disconnectTeamTwitterAccount] delete rowCount:', rowCount);
    if (rowCount === 0) {
      console.log('[disconnectTeamTwitterAccount] Delete failed, account not found:', accountId, teamId);
      return res.status(404).json({ error: 'Account not found or already disconnected' });
    }
    return res.json({ success: true, message: 'Twitter account disconnected successfully' });
  } catch (err) {
    console.error('[proTeamController] Error disconnecting team Twitter account:', err);
    res.status(500).json({ error: 'Failed to disconnect team Twitter account.' });
  }
}