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
    const { rows } = await pool.query(
      'SELECT linkedin_user_id, linkedin_display_name FROM linkedin_auth WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    // rows found indicates whether a linked account exists

    res.json({
      connected: rows.length > 0,
      account: rows[0] || null,
    });
  } catch (err) {
    logger.error('[linkedin/status] DB error', { error: err.message });
    res.json({ connected: false, account: null });
  }
});

export default router;