import express from 'express';
import pool from '../config/database.js';
import { validateRequest, scheduleSchema } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';
import { scheduledTweetService } from '../services/scheduledTweetService.js';
import { scheduledTweetQueue } from '../services/queueService.js';
import moment from 'moment-timezone';

const router = express.Router();

// Schedule a tweet
router.post('/', validateRequest(scheduleSchema), validateTwitterConnection, async (req, res) => {
  try {
    const { content, media = [], scheduled_for, timezone = 'UTC' } = req.body;
    const userId = req.user.id;

    // Validate timezone
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Convert scheduled time to UTC
    const scheduledTime = moment.tz(scheduled_for, timezone).utc().toDate();

    // Check if time is at least 5 minutes in the future
    const minTime = moment().add(5, 'minutes').toDate();
    if (scheduledTime < minTime) {
      return res.status(400).json({ 
        error: 'Scheduled time must be at least 5 minutes in the future' 
      });
    }

    // Check scheduling limits
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) FROM scheduled_tweets WHERE user_id = $1 AND status = $2',
      [userId, 'pending']
    );

    const maxScheduled = parseInt(process.env.MAX_SCHEDULED_TWEETS_PER_USER || '100');
    if (parseInt(countRows[0].count) >= maxScheduled) {
      return res.status(400).json({ 
        error: `Maximum ${maxScheduled} scheduled tweets allowed` 
      });
    }

    // Save scheduled tweet (not posted yet)
    const { rows } = await pool.query(
      `INSERT INTO scheduled_tweets (
        user_id, content, media, scheduled_for, timezone, status
      ) VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *`,
      [userId, content, JSON.stringify(media), scheduledTime, timezone]
    );

    // Enqueue BullMQ job for scheduled tweet
    const delay = Math.max(0, new Date(scheduledTime).getTime() - Date.now());
    await scheduledTweetQueue.add(
      'scheduled-tweet',
      { scheduledTweetId: rows[0].id },
      { delay }
    );

    res.json({
      success: true,
      scheduled_tweet: {
        id: rows[0].id,
        scheduled_for: rows[0].scheduled_for,
        timezone: rows[0].timezone,
        status: rows[0].status,
        content: rows[0].content,
        media: rows[0].media
      }
    });

  } catch (error) {
    console.error('Schedule tweet error:', error);
    res.status(500).json({ error: 'Failed to schedule tweet' });
  }
});

// Get scheduled tweets
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT *
       FROM scheduled_tweets
       WHERE user_id::text = $1 AND status = $2
       ORDER BY scheduled_for ASC
       LIMIT $3 OFFSET $4`,
      [req.user.id, status, limit, offset]
    );

    res.json({ scheduled_tweets: rows });

  } catch (error) {
    console.error('Get scheduled tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled tweets' });
  }
});

// Cancel scheduled tweet
router.delete('/:scheduleId', async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const userId = req.user.id;

    const { rows } = await pool.query(
      'UPDATE scheduled_tweets SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      ['cancelled', scheduleId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled tweet not found' });
    }


    // Remove BullMQ job if it exists
    const jobs = await scheduledTweetQueue.getDelayed();
    for (const job of jobs) {
      if (job.data.scheduledTweetId === rows[0].id) {
        await job.remove();
      }
    }

    res.json({ success: true, message: 'Scheduled tweet cancelled' });

  } catch (error) {
    console.error('Cancel scheduled tweet error:', error);
    res.status(500).json({ error: 'Failed to cancel scheduled tweet' });
  }
});

// Update scheduled time
router.put('/:scheduleId', validateRequest(scheduleSchema), async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { scheduled_for, timezone = 'UTC' } = req.body;
    const userId = req.user.id;

    // Validate timezone
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Convert scheduled time to UTC
    const scheduledTime = moment.tz(scheduled_for, timezone).utc().toDate();

    // Check if time is at least 5 minutes in the future
    const minTime = moment().add(5, 'minutes').toDate();
    if (scheduledTime < minTime) {
      return res.status(400).json({ 
        error: 'Scheduled time must be at least 5 minutes in the future' 
      });
    }


    const { rows } = await pool.query(
      `UPDATE scheduled_tweets 
       SET scheduled_for = $1, timezone = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4 AND status = 'pending'
       RETURNING *`,
      [scheduledTime, timezone, scheduleId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled tweet not found or already processed' });
    }

    // Remove any existing BullMQ job for this scheduled tweet (if exists)
    const jobs = await scheduledTweetQueue.getDelayed();
    for (const job of jobs) {
      if (job.data.scheduledTweetId === rows[0].id) {
        await job.remove();
      }
    }

    // Enqueue new BullMQ job with updated delay
    const delay = Math.max(0, new Date(scheduledTime).getTime() - Date.now());
    await scheduledTweetQueue.add(
      'scheduled-tweet',
      { scheduledTweetId: rows[0].id },
      { delay }
    );

    res.json({
      success: true,
      scheduled_tweet: {
        id: rows[0].id,
        scheduled_for: rows[0].scheduled_for,
        timezone: rows[0].timezone
      }
    });

  } catch (error) {
    console.error('Update scheduled tweet error:', error);
    res.status(500).json({ error: 'Failed to update scheduled tweet' });
  }
});

export default router;
