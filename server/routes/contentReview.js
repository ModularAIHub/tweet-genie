import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireProPlan } from '../middleware/planAccess.js';
import { contentReviewRateLimit } from '../middleware/rateLimit.js';
import { weeklyContentService } from '../services/weeklyContentService.js';
import { creditService } from '../services/creditService.js';

const router = express.Router();

// ─── Shared scheduling helper ────────────────────────────────────────────
const MAX_SCHEDULED_PER_USER = parseInt(process.env.MAX_SCHEDULED_TWEETS_PER_USER || '100');
const MAX_SCHEDULING_WINDOW_DAYS = 15;

async function scheduleContentItem(userId, item, overrideTime, overrideTz) {
  const scheduleTime = overrideTime || item.suggested_time;
  const tz = overrideTz || item.timezone || 'UTC';

  if (!scheduleTime) {
    return { ok: false, error: 'No schedule time available. Please provide scheduled_for.' };
  }

  // Validate time is in the future
  const scheduledDate = new Date(scheduleTime);
  if (isNaN(scheduledDate.getTime())) {
    return { ok: false, error: 'Invalid schedule time format' };
  }
  if (scheduledDate <= new Date()) {
    return { ok: false, error: 'Scheduled time must be in the future' };
  }

  // Validate within scheduling window
  const maxDate = new Date(Date.now() + MAX_SCHEDULING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (scheduledDate > maxDate) {
    return { ok: false, error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.` };
  }

  // Check scheduling limits
  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*) FROM scheduled_tweets WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  if (parseInt(count) >= MAX_SCHEDULED_PER_USER) {
    return { ok: false, error: `Maximum ${MAX_SCHEDULED_PER_USER} scheduled tweets allowed` };
  }

  // Detect threads: split on --- separator
  const rawContent = item.content || '';
  const threadParts = rawContent.split(/---+/).map(p => p.trim()).filter(Boolean);
  const isThread = threadParts.length > 1;
  const mainContent = isThread ? threadParts[0] : rawContent;
  const threadTweets = isThread ? threadParts.slice(1).map(p => ({ content: p })) : null;

  // Determine source from the queue item (preserves 'autopilot' origin)
  const source = item.source || 'manual';
  const strategyId = item.strategy_id || null;

  // Insert into scheduled_tweets with proper columns
  const { rows: [scheduledTweet] } = await pool.query(
    `INSERT INTO scheduled_tweets (user_id, content, thread_tweets, scheduled_for, timezone, status, approval_status, source, autopilot_strategy_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', 'approved', $6, $7, NOW(), NOW())
     RETURNING id`,
    [userId, mainContent, isThread ? JSON.stringify(threadTweets) : null, scheduledDate.toISOString(), tz, source, source === 'autopilot' ? strategyId : null]
  );

  // Mark queue item as scheduled
  await weeklyContentService.markScheduled(item.id, userId, scheduledTweet.id);

  return { ok: true, scheduledTweetId: scheduledTweet.id, scheduledFor: scheduledDate.toISOString() };
}

// All routes require authentication + pro plan
router.use(authenticateToken, requireProPlan('Content Queue'));

// ─── GET /api/content-review — List queue items ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, strategy_id, order_by, limit } = req.query;

    const filters = {};
    if (status && ['pending', 'approved', 'rejected', 'scheduled'].includes(status)) {
      filters.status = status;
    }
    if (strategy_id) filters.strategyId = strategy_id;
    if (order_by) filters.orderBy = order_by;
    if (limit) filters.limit = Math.min(parseInt(limit) || 50, 100);

    const items = await weeklyContentService.getQueue(userId, filters);
    res.json({ items });
  } catch (error) {
    console.error('[ContentReview] GET / error:', error.message);
    res.status(500).json({ error: 'Failed to fetch content queue' });
  }
});

// ─── GET /api/content-review/stats — Queue stats ────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await weeklyContentService.getQueueStats(req.user.id, req.query.strategy_id || null);
    res.json(stats);
  } catch (error) {
    console.error('[ContentReview] GET /stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch queue stats' });
  }
});

// ─── POST /api/content-review/generate — Manually trigger generation ────
router.post('/generate', async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategy_id } = req.body;

    if (!strategy_id) {
      return res.status(400).json({ error: 'strategy_id is required' });
    }

    // Check the strategy belongs to user
    const { rows: [strategy] } = await pool.query(
      `SELECT id FROM user_strategies WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [strategy_id, userId]
    );

    if (!strategy) {
      return res.status(404).json({ error: 'Active strategy not found' });
    }

    // Check throttle — max 14 non-rejected items per strategy per day
    const { rows: [recentCount] } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM content_review_queue
       WHERE user_id = $1 AND strategy_id = $2
         AND status != 'rejected'
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId, strategy_id]
    );

    if (parseInt(recentCount.cnt) >= 14) {
      return res.status(429).json({
        error: 'You already have enough content for today. Try again later.',
      });
    }

    // 5 credits for weekly content generation (7 AI tweets at a discount)
    const creditResult = await creditService.checkAndDeductCredits(userId, 'weekly_content_generation', 5);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. 5 credits required for weekly content generation.',
        available: creditResult.available,
        required: 5,
      });
    }

    let result;
    try {
      result = await weeklyContentService.generateForUser(userId, strategy_id);
    } catch (genError) {
      // Refund credits on failure
      try { await creditService.refundCredits(userId, 'weekly_content_generation_failed', 5); } catch {}
      throw genError;
    }
    res.json({
      message: `Generated ${result.count} content items`,
      count: result.count,
      items: result.items,
    });
  } catch (error) {
    console.error('[ContentReview] POST /generate error:', error.message);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// ─── PATCH /api/content-review/:id — Update (edit content) ──────────────
router.patch('/:id', contentReviewRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { content, suggested_time } = req.body;

    const updates = {};
    if (content !== undefined) updates.content = content;
    if (suggested_time !== undefined) updates.suggested_time = suggested_time;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const item = await weeklyContentService.updateItem(id, userId, updates);
    if (!item) {
      return res.status(404).json({ error: 'Item not found or cannot be edited' });
    }

    res.json({ item });
  } catch (error) {
    console.error('[ContentReview] PATCH /:id error:', error.message);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// ─── POST /api/content-review/:id/approve — Approve + auto-schedule ────
router.post('/:id/approve', contentReviewRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const item = await weeklyContentService.approveItem(id, userId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found or already processed' });
    }

    // Auto-schedule if suggested_time exists
    let scheduled = null;
    if (item.suggested_time) {
      const result = await scheduleContentItem(userId, item);
      if (result.ok) {
        scheduled = { scheduledTweetId: result.scheduledTweetId, scheduledFor: result.scheduledFor };
        console.log(`[ContentReview] Auto-scheduled approved item ${id} → tweet ${result.scheduledTweetId}`);
      } else {
        console.warn(`[ContentReview] Approved item ${id} but auto-schedule failed: ${result.error}`);
      }
    }

    res.json({ item, scheduled });
  } catch (error) {
    console.error('[ContentReview] POST /:id/approve error:', error.message);
    res.status(500).json({ error: 'Failed to approve item' });
  }
});

// ─── POST /api/content-review/:id/reject — Reject single item ──────────
router.post('/:id/reject', contentReviewRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const item = await weeklyContentService.rejectItem(id, userId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found or already processed' });
    }

    res.json({ item });
  } catch (error) {
    console.error('[ContentReview] POST /:id/reject error:', error.message);
    res.status(500).json({ error: 'Failed to reject item' });
  }
});

// ─── POST /api/content-review/:id/schedule — Approve + schedule ────────
router.post('/:id/schedule', contentReviewRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { scheduled_for, timezone } = req.body;

    // Fetch the queue item
    const { rows: [item] } = await pool.query(
      `SELECT * FROM content_review_queue WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'approved')`,
      [id, userId]
    );

    if (!item) {
      return res.status(404).json({ error: 'Item not found or cannot be scheduled' });
    }

    const result = await scheduleContentItem(userId, item, scheduled_for, timezone);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: 'Content scheduled successfully',
      scheduledTweetId: result.scheduledTweetId,
      scheduledFor: result.scheduledFor,
    });
  } catch (error) {
    console.error('[ContentReview] POST /:id/schedule error:', error.message);
    res.status(500).json({ error: 'Failed to schedule content' });
  }
});

// ─── POST /api/content-review/batch-approve — Batch approve + auto-schedule ──
router.post('/batch-approve', contentReviewRateLimit, async (req, res) => {
  try {
    const userId = req.user.id;
    const { item_ids } = req.body;

    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ error: 'item_ids array is required' });
    }

    if (item_ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 items per batch' });
    }

    const items = await weeklyContentService.batchApprove(item_ids, userId);

    // Auto-schedule each approved item that has a suggested_time
    let scheduledCount = 0;
    for (const item of items) {
      if (item.suggested_time) {
        const result = await scheduleContentItem(userId, item);
        if (result.ok) scheduledCount++;
      }
    }

    res.json({
      message: `Approved ${items.length} items, auto-scheduled ${scheduledCount}`,
      count: items.length,
      scheduledCount,
      items,
    });
  } catch (error) {
    console.error('[ContentReview] POST /batch-approve error:', error.message);
    res.status(500).json({ error: 'Failed to batch approve' });
  }
});

// ─── POST /api/content-review/batch-schedule — Batch schedule items ────
router.post('/batch-schedule', contentReviewRateLimit, async (req, res) => {
  try {
    const userId = req.user.id;
    const { item_ids } = req.body;

    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ error: 'item_ids array is required' });
    }

    if (item_ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 items per batch' });
    }

    // Fetch all items
    const { rows: items } = await pool.query(
      `SELECT * FROM content_review_queue 
       WHERE id = ANY($1) AND user_id = $2 AND status IN ('pending', 'approved')`,
      [item_ids, userId]
    );

    const results = { scheduled: 0, failed: 0, errors: [] };

    for (const item of items) {
      const result = await scheduleContentItem(userId, item);
      if (result.ok) {
        results.scheduled++;
      } else {
        results.failed++;
        results.errors.push({ id: item.id, error: result.error });
      }
    }

    res.json({
      message: `Scheduled ${results.scheduled} items`,
      ...results,
    });
  } catch (error) {
    console.error('[ContentReview] POST /batch-schedule error:', error.message);
    res.status(500).json({ error: 'Failed to batch schedule' });
  }
});

// ─── DELETE /api/content-review/:id — Remove item from queue ────────────
router.delete('/:id', contentReviewRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { rowCount } = await pool.query(
      `DELETE FROM content_review_queue WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'approved', 'rejected')`,
      [id, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Item not found or cannot be deleted' });
    }

    res.json({ message: 'Item removed' });
  } catch (error) {
    console.error('[ContentReview] DELETE /:id error:', error.message);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ─── Phase 6: Repurpose a tweet ──────────────────────────────────────────
router.post('/repurpose/:tweetId', authenticateToken, requireProPlan, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { tweetId } = req.params;
    const { formats } = req.body; // optional: ['linkedin', 'thread', 'alternatives']

    // Credit check: 3 credits for repurposing
    const REPURPOSE_CREDITS = 3;
    const canAfford = await creditService.canAfford(userId, REPURPOSE_CREDITS);
    if (!canAfford) {
      return res.status(402).json({ error: 'Insufficient credits', credits_required: REPURPOSE_CREDITS });
    }

    // Deduct credits
    await creditService.deductCredits(userId, REPURPOSE_CREDITS, 'repurpose_tweet', {
      tweet_id: tweetId,
      formats: formats || ['linkedin', 'thread', 'alternatives'],
    });

    try {
      const { repurposeService } = await import('../services/repurposeService.js');
      const result = await repurposeService.repurposeTweet(userId, tweetId, { formats });

      res.json({
        success: true,
        message: `Generated ${result.count} repurposed item(s) — they're in your review queue`,
        data: result,
      });
    } catch (repurposeError) {
      // Refund credits on failure
      await creditService.addCredits(userId, REPURPOSE_CREDITS, 'repurpose_refund', {
        tweet_id: tweetId,
        error: repurposeError.message,
      });
      throw repurposeError;
    }
  } catch (error) {
    console.error('[ContentReview] POST /repurpose/:tweetId error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to repurpose tweet' });
  }
});

export default router;
