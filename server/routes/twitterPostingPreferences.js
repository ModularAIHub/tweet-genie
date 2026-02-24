import express from 'express';
import {
  getTwitterPostingPreferences,
  upsertTwitterPostingPreferences,
} from '../utils/twitterPostingPreferences.js';

const router = express.Router();

// GET /api/twitter/preferences
// Optional query: accountId, isTeamAccount=true|false
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const accountId = req.query.accountId ? String(req.query.accountId).trim() : null;
    const isTeamAccount = String(req.query.isTeamAccount || 'false').toLowerCase() === 'true';

    const prefs = await getTwitterPostingPreferences({ userId, accountId, isTeamAccount });
    // Return shape expected by frontend: top-level x_char_limit / x_long_post_enabled
    return res.json({
      success: true,
      x_char_limit: prefs.x_char_limit,
      x_long_post_enabled: prefs.x_long_post_enabled,
      preferences: prefs,
    });
  } catch (err) {
    return res.status(500).json({ error: 'failed_to_read_preferences', details: err?.message || String(err) });
  }
});

// PUT /api/twitter/preferences
// Body: { accountId, isTeamAccount, xLongPostEnabled, xCharLimit }
router.put('/', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const accountId = req.body.accountId ? String(req.body.accountId).trim() : null;
    const isTeamAccount = Boolean(req.body.isTeamAccount);
    const xLongPostEnabled = Boolean(req.body.xLongPostEnabled);
    const xCharLimit = req.body.xCharLimit === undefined || req.body.xCharLimit === null ? null : Number(req.body.xCharLimit);

    const result = await upsertTwitterPostingPreferences({
      userId,
      accountId,
      isTeamAccount,
      xLongPostEnabled,
      xCharLimit,
      updatedBy: userId,
    });

    return res.json({ success: true, x_char_limit: result.x_char_limit, x_long_post_enabled: result.x_long_post_enabled, preferences: result });
  } catch (err) {
    return res.status(500).json({ error: 'failed_to_update_preferences', details: err?.message || String(err) });
  }
});

// Support PATCH verb used by frontend Settings page
router.patch('/', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const accountId = req.body.accountId ? String(req.body.accountId).trim() : null;
    const isTeamAccount = Boolean(req.body.isTeamAccount);
    const xLongPostEnabled = Boolean(req.body.xLongPostEnabled);
    const xCharLimit = req.body.xCharLimit === undefined || req.body.xCharLimit === null ? null : Number(req.body.xCharLimit);

    const result = await upsertTwitterPostingPreferences({
      userId,
      accountId,
      isTeamAccount,
      xLongPostEnabled,
      xCharLimit,
      updatedBy: userId,
    });

    return res.json({ success: true, x_char_limit: result.x_char_limit, x_long_post_enabled: result.x_long_post_enabled, preferences: result });
  } catch (err) {
    return res.status(500).json({ error: 'failed_to_update_preferences', details: err?.message || String(err) });
  }
});

export default router;
