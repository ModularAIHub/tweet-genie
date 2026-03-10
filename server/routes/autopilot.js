// Auto-Pilot Routes for Strategy Builder
import express from 'express';
import pool from '../config/database.js';
import * as autopilotService from '../services/autopilotService.js';
import { getNotificationPrefsForUser, updateNotificationPrefs } from '../services/emailNotificationService.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('Autopilot'));

// ─── Undo window constant (must match weeklyContentService) ──────────────
const UNDO_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};
const AUTOPILOT_FEATURE_ENABLED = parseBooleanEnv(process.env.AUTOPILOT_FEATURE_ENABLED, false);

const rejectWhenAutopilotDisabled = (res) =>
  res.status(403).json({
    error: 'Autopilot mode currently turned off. Contact admin for it.',
    code: 'AUTOPILOT_DISABLED_BY_ADMIN',
  });

/**
 * GET /api/strategy/autopilot/activity-log
 * Get autopilot activity log for the authenticated user (across all strategies)
 */
router.get('/activity-log', async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const { rows } = await pool.query(
      `SELECT ah.*, us.niche, us.target_audience
       FROM autopilot_history ah
       JOIN user_strategies us ON ah.strategy_id = us.id
       WHERE us.user_id = $1
       ORDER BY ah.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM autopilot_history ah
       JOIN user_strategies us ON ah.strategy_id = us.id
       WHERE us.user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: rows,
      total: parseInt(count),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

/**
 * POST /api/strategy/autopilot/undo/:scheduledTweetId
 * Undo an autopilot-scheduled tweet (within the 1-hour window)
 */
router.post('/undo/:scheduledTweetId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { scheduledTweetId } = req.params;

    // Find the scheduled tweet and verify it belongs to the user + is within undo window
    const { rows: [tweet] } = await pool.query(
      `SELECT * FROM scheduled_tweets 
       WHERE id = $1 AND user_id = $2 AND source = 'autopilot' AND status = 'pending'`,
      [scheduledTweetId, userId]
    );

    if (!tweet) {
      return res.status(404).json({ error: 'Autopilot tweet not found or already processed' });
    }

    if (tweet.undo_deadline && new Date(tweet.undo_deadline) < new Date()) {
      return res.status(400).json({ error: 'Undo window has expired (1 hour limit)' });
    }

    // Delete the scheduled tweet
    await pool.query('DELETE FROM scheduled_tweets WHERE id = $1', [scheduledTweetId]);

    // Update content_review_queue item back to pending if it exists
    await pool.query(
      `UPDATE content_review_queue 
       SET status = 'pending', scheduled_tweet_id = NULL, updated_at = NOW()
       WHERE scheduled_tweet_id = $1 AND user_id = $2`,
      [scheduledTweetId, userId]
    );

    // Log the undo action
    if (tweet.autopilot_strategy_id) {
      await pool.query(
        `INSERT INTO autopilot_history 
           (strategy_id, action, actor, success, details)
         VALUES ($1, 'undo', $2, true, $3)`,
        [tweet.autopilot_strategy_id, userId, JSON.stringify({
          scheduled_tweet_id: scheduledTweetId,
          content_preview: (tweet.content || '').slice(0, 100),
          originally_scheduled_for: tweet.scheduled_for,
        })]
      );
    }

    res.json({
      success: true,
      message: 'Autopilot tweet undone — moved back to review queue',
    });
  } catch (error) {
    console.error('Error undoing autopilot tweet:', error);
    res.status(500).json({ error: 'Failed to undo tweet' });
  }
});

/**
 * GET /api/strategy/autopilot/pending-undo
 * Get all autopilot-scheduled tweets still within their undo window
 */
router.get('/pending-undo', async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT id, content, scheduled_for, timezone, undo_deadline, autopilot_strategy_id, created_at
       FROM scheduled_tweets
       WHERE user_id = $1 
         AND source = 'autopilot' 
         AND status = 'pending'
         AND undo_deadline > NOW()
       ORDER BY scheduled_for ASC`,
      [userId]
    );

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error('Error fetching pending undo tweets:', error);
    res.status(500).json({ error: 'Failed to fetch pending tweets' });
  }
});

/**
 * GET /api/strategy/autopilot/:strategyId/config
 * Get autopilot configuration
 */
router.get('/:strategyId/config', async (req, res) => {
  try {
    const { strategyId } = req.params;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const config = await autopilotService.getAutopilotConfig(strategyId);
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('Error fetching autopilot config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

/**
 * PUT /api/strategy/autopilot/:strategyId/config
 * Update autopilot configuration
 */
router.put('/:strategyId/config', async (req, res) => {
  try {
    const { strategyId } = req.params;
    const updates = req.body;

    if (!AUTOPILOT_FEATURE_ENABLED && updates?.is_enabled === true) {
      return rejectWhenAutopilotDisabled(res);
    }
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const config = await autopilotService.updateAutopilotConfig(strategyId, updates);
    let disableCleanup = null;
    
    // If autopilot was just enabled, clear any paused reason and fill the queue
    if (updates.is_enabled === true) {
      await pool.query(
        `UPDATE autopilot_config SET paused_reason = NULL WHERE strategy_id = $1`,
        [strategyId]
      );
      autopilotService.fillQueue(strategyId).catch(err => {
        console.error('Error filling queue after enabling autopilot:', err);
      });
    }

    // If autopilot was disabled, cancel pending autopilot schedules so they cannot
    // continue posting in the background.
    if (updates.is_enabled === false) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: cancelledRows } = await client.query(
          `UPDATE scheduled_tweets st
           SET status = 'cancelled',
               error_message = CASE
                 WHEN COALESCE(st.error_message, '') = '' THEN 'Cancelled automatically because autopilot was disabled.'
                 ELSE st.error_message || ' | Cancelled automatically because autopilot was disabled.'
               END,
               processing_started_at = NULL,
               updated_at = NOW()
           WHERE st.user_id = $1
             AND st.autopilot_strategy_id = $2
             AND st.source = 'autopilot'
             AND st.status = 'pending'
             AND st.scheduled_for > NOW()
           RETURNING st.id`,
          [req.user.id, strategyId]
        );

        const cancelledIds = cancelledRows.map((row) => String(row.id));
        let restoredQueueItems = 0;

        if (cancelledIds.length > 0) {
          const restoreResult = await client.query(
            `UPDATE content_review_queue crq
             SET status = 'pending',
                 scheduled_tweet_id = NULL,
                 updated_at = NOW()
             FROM (SELECT unnest($3::text[]) AS scheduled_id) cancelled
             WHERE crq.user_id = $1
               AND crq.strategy_id = $2
               AND crq.source = 'autopilot'
               AND crq.status = 'scheduled'
               AND crq.scheduled_tweet_id::text = cancelled.scheduled_id`,
            [req.user.id, strategyId, cancelledIds]
          );
          restoredQueueItems = restoreResult.rowCount || 0;
        }

        await client.query('COMMIT');
        disableCleanup = {
          cancelledScheduledTweets: cancelledIds.length,
          restoredQueueItems,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error during autopilot disable cleanup transaction:', err);
        return res.status(500).json({ error: 'Failed to update configuration (transaction error)' });
      } finally {
        client.release();
      }
    }
    
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      data: config,
      ...(disableCleanup ? { disableCleanup } : {})
    });
  } catch (error) {
    console.error('Error updating autopilot config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * GET /api/strategy/autopilot/:strategyId/queue
 * Get content queue
 */
router.get('/:strategyId/queue', async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { status, limit } = req.query;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const filters = {};
    if (status) filters.status = status;
    if (limit) filters.limit = parseInt(limit);
    
    const queue = await autopilotService.getQueue(strategyId, filters);
    
    res.json({
      success: true,
      data: queue
    });
  } catch (error) {
    console.error('Error fetching queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

/**
 * POST /api/strategy/autopilot/:strategyId/generate
 * Generate new content and add to queue
 */
router.post('/:strategyId/generate', async (req, res) => {
  try {
    if (!AUTOPILOT_FEATURE_ENABLED) {
      return rejectWhenAutopilotDisabled(res);
    }

    const { strategyId } = req.params;
    const { promptId, scheduledFor, count } = req.body;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const generated = [];
    const generateCount = count || 1;
    
    for (let i = 0; i < generateCount; i++) {
      try {
        const queued = await autopilotService.generateAndQueueContent(strategyId, {
          promptId,
          scheduledFor,
          generationMode: 'manual'
        });
        generated.push(queued);
      } catch (error) {
        console.error(`Error generating content ${i + 1}/${generateCount}:`, error);
      }
    }
    
    res.json({
      success: true,
      message: `Generated ${generated.length} content item(s)`,
      data: generated
    });
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

/**
 * POST /api/strategy/autopilot/:strategyId/fill-queue
 * Fill queue to max capacity
 */
router.post('/:strategyId/fill-queue', async (req, res) => {
  try {
    if (!AUTOPILOT_FEATURE_ENABLED) {
      return rejectWhenAutopilotDisabled(res);
    }

    const { strategyId } = req.params;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const generated = await autopilotService.fillQueue(strategyId);
    
    res.json({
      success: true,
      message: `Queue filled with ${generated.length} new posts`,
      data: generated
    });
  } catch (error) {
    console.error('Error filling queue:', error);
    res.status(500).json({ error: 'Failed to fill queue' });
  }
});

/**
 * POST /api/strategy/autopilot/queue/:queueId/approve
 * Approve queued content
 */
router.post('/queue/:queueId/approve', async (req, res) => {
  try {
    if (!AUTOPILOT_FEATURE_ENABLED) {
      return rejectWhenAutopilotDisabled(res);
    }

    const { queueId } = req.params;
    
    // Verify queue item belongs to user's strategy
    const { rows } = await pool.query(
      `SELECT us.user_id 
       FROM content_review_queue crq
       JOIN user_strategies us ON crq.strategy_id = us.id
       WHERE crq.id = $1 AND crq.source = 'autopilot'`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    const updated = await autopilotService.approveQueuedContent(queueId, req.user.id);
    
    res.json({
      success: true,
      message: 'Content approved',
      data: updated
    });
  } catch (error) {
    console.error('Error approving content:', error);
    res.status(500).json({ error: 'Failed to approve content' });
  }
});

/**
 * POST /api/strategy/autopilot/queue/:queueId/reject
 * Reject queued content
 */
router.post('/queue/:queueId/reject', async (req, res) => {
  try {
    const { queueId } = req.params;
    const { reason } = req.body;
    
    // Verify queue item belongs to user's strategy
    const { rows } = await pool.query(
      `SELECT us.user_id 
       FROM content_review_queue crq
       JOIN user_strategies us ON crq.strategy_id = us.id
       WHERE crq.id = $1 AND crq.source = 'autopilot'`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    const updated = await autopilotService.rejectQueuedContent(queueId, req.user.id, reason);
    
    res.json({
      success: true,
      message: 'Content rejected',
      data: updated
    });
  } catch (error) {
    console.error('Error rejecting content:', error);
    res.status(500).json({ error: 'Failed to reject content' });
  }
});

/**
 * PUT /api/strategy/autopilot/queue/:queueId
 * Edit queued content
 */
router.put('/queue/:queueId', async (req, res) => {
  try {
    const { queueId } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Verify queue item belongs to user's strategy
    const { rows } = await pool.query(
      `SELECT us.user_id 
       FROM content_review_queue crq
       JOIN user_strategies us ON crq.strategy_id = us.id
       WHERE crq.id = $1 AND crq.source = 'autopilot'`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    const updated = await autopilotService.editQueuedContent(queueId, content);
    
    res.json({
      success: true,
      message: 'Content updated',
      data: updated
    });
  } catch (error) {
    console.error('Error editing content:', error);
    res.status(500).json({ error: 'Failed to edit content' });
  }
});

/**
 * DELETE /api/strategy/autopilot/queue/:queueId
 * Delete queued content
 */
router.delete('/queue/:queueId', async (req, res) => {
  try {
    const { queueId } = req.params;
    
    // Verify queue item belongs to user's strategy
    const { rows } = await pool.query(
      `SELECT us.user_id 
       FROM content_review_queue crq
       JOIN user_strategies us ON crq.strategy_id = us.id
       WHERE crq.id = $1 AND crq.source = 'autopilot'`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    await pool.query(
      'DELETE FROM content_review_queue WHERE id = $1',
      [queueId]
    );
    
    res.json({
      success: true,
      message: 'Content deleted'
    });
  } catch (error) {
    console.error('Error deleting content:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// ─── Email Notification Preferences ───────────────────────────────────────

/**
 * GET /api/autopilot/notification-prefs
 * Get email notification preferences for the authenticated user
 */
router.get('/notification-prefs', async (req, res) => {
  try {
    const prefs = await getNotificationPrefsForUser(req.user.id);
    res.json({ success: true, data: prefs });
  } catch (error) {
    console.error('Error fetching notification prefs:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

/**
 * PUT /api/autopilot/notification-prefs
 * Update email notification preferences
 */
router.put('/notification-prefs', async (req, res) => {
  try {
    const updated = await updateNotificationPrefs(req.user.id, req.body);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating notification prefs:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

export default router;
