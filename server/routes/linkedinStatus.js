import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// GET /api/linkedin/status
// Direct DB lookup on linkedin_auth table (same Postgres instance as LinkedIn Genie)
router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;

  if (!userId) {
    return res.status(401).json({ connected: false });
  }

  try {
    const socialResult = await pool.query(
      `SELECT account_id, account_username, account_display_name, profile_image_url
       FROM social_connected_accounts
       WHERE user_id = $1
         AND team_id IS NULL
         AND platform = 'linkedin'
         AND is_active = true
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId]
    );

    const account = socialResult.rows[0] || null;
    if (account) {
      return res.json({
        connected: true,
        account: {
          linkedin_user_id: account.account_id || null,
          linkedin_display_name: account.account_display_name || null,
          linkedin_username: account.account_username || null,
          account_display_name: account.account_display_name || null,
          account_username: account.account_username || null,
          profile_image_url: account.profile_image_url || null,
        },
      });
    }

    const legacyResult = await pool.query(
      'SELECT linkedin_user_id, linkedin_display_name FROM linkedin_auth WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    if (legacyResult.rows.length > 0) {
      return res.json({
        connected: true,
        account: legacyResult.rows[0],
      });
    }

    return res.json({ connected: false, account: null });
  } catch (err) {
    logger.error('[linkedin/status] DB error', { error: err.message });
    res.json({ connected: false, account: null });
  }
});

export default router;
