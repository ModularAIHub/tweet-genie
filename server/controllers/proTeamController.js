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

    // Query user_social_accounts for team Twitter accounts
    console.log('[proTeamController] Querying user_social_accounts with:', {
      teamId,
      platform: 'twitter',
      is_active: true
    });
    const result = await db.query(`
      SELECT 
        id,
        platform,
        account_username,
        account_display_name,
        account_id,
        profile_image_url,
        created_at
      FROM user_social_accounts 
      WHERE team_id = $1 
        AND platform = 'twitter' 
        AND is_active = true
      ORDER BY created_at ASC
    `, [teamId]);
    console.log('[proTeamController] Raw DB result:', result);
    if (result.rows.length === 0) {
        console.log('[proTeamController] NO ROWS FOUND');
    } else {
        console.log('[proTeamController] Returned first row:', result.rows[0]);
    }
    console.log('[proTeamController] Query result:', result.rows);
    const accounts = result.rows.map(account => ({
      ...account,
      nickname: account.account_display_name || account.account_username,
      isTeamAccount: true
    }));
    return res.json({ accounts });
  } catch (err) {
    console.error('[proTeamController] Error fetching team social accounts:', err);
    res.status(500).json({ error: 'Failed to fetch team social accounts.' });
  }
}
