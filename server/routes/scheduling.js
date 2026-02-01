import express from 'express';
import pool from '../config/database.js';
import { validateRequest, scheduleSchema } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';
import { scheduledTweetService } from '../services/scheduledTweetService.js';
import { scheduledTweetQueue } from '../services/queueService.js';
import moment from 'moment-timezone';

const router = express.Router();

// Bulk schedule drafts
router.post('/bulk', async (req, res) => {
  try {
    const { items, frequency, startDate, timeOfDay, postsPerDay = 1, dailyTimes = [timeOfDay || '09:00'], daysOfWeek, images, timezone = 'UTC' } = req.body;
    const userId = req.user.id;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
    }
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
    const scheduled = [];
    let current = moment.tz(startDate, timezone);
    let scheduledCount = 0;
    for (const item of items) {
      let content = item.text;
      let isThread = item.isThread;
      let threadParts = item.threadParts || null;
      let media = images?.[scheduledCount] || [];
      
      // If it's a thread, ensure threadParts is properly formatted
      if (isThread && threadParts && Array.isArray(threadParts)) {
        // threadParts should be an array of strings
        threadParts = threadParts.filter(part => part && part.trim().length > 0);
        console.log(`📝 Scheduling thread with ${threadParts.length} parts:`, threadParts.map((p, i) => `Part ${i + 1}: ${p.substring(0, 50)}...`));
      } else if (isThread && content && content.includes('---')) {
        // Fallback: split content by --- if threadParts not provided
        threadParts = content.split('---').map(part => part.trim()).filter(Boolean);
        console.log(`📝 Scheduling thread (split by ---) with ${threadParts.length} parts:`, threadParts.map((p, i) => `Part ${i + 1}: ${p.substring(0, 50)}...`));
      }
      if (frequency === 'daily') {
        const dayOffset = Math.floor(scheduledCount / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        current.add(dayOffset, 'day').set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = current.clone().utc().toDate();
        
        // Convert to the format expected by the individual scheduling endpoint
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
          [userId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, timezone]
        );
        
        console.log(`✅ [Daily] Scheduled ID ${rows[0].id}: "${mainContent.substring(0, 40)}..." with ${threadTweets.length} thread tweets`);
        
        // Add to BullMQ queue with delay
        const delay = Math.max(0, new Date(scheduledForUTC).getTime() - Date.now());
        await scheduledTweetQueue.add(
          'scheduled-tweet',
          { scheduledTweetId: rows[0].id },
          { delay }
        );
        
        scheduled.push(rows[0]);
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        const week = Math.floor(scheduledCount / (days.length * postsPerDay));
        const dayIndex = Math.floor((scheduledCount % (days.length * postsPerDay)) / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        const next = current.clone().add(week, 'week').day(days[dayIndex]);
        next.set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = next.clone().utc().toDate();
        
        // Convert to the format expected by the individual scheduling endpoint
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
          [userId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, timezone]
        );
        
        // Add to BullMQ queue with delay
        const delay = Math.max(0, new Date(scheduledForUTC).getTime() - Date.now());
        await scheduledTweetQueue.add(
          'scheduled-tweet',
          { scheduledTweetId: rows[0].id },
          { delay }
        );
        
        scheduled.push(rows[0]);
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek)) {
        const week = Math.floor(scheduledCount / (daysOfWeek.length * postsPerDay));
        const dayIndex = Math.floor((scheduledCount % (daysOfWeek.length * postsPerDay)) / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        const next = current.clone().add(week, 'week').day(daysOfWeek[dayIndex]);
        next.set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = next.clone().utc().toDate();
        
        // Convert to the format expected by the individual scheduling endpoint
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
          [userId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, timezone]
        );
        
        // Add to BullMQ queue with delay
        const delay = Math.max(0, new Date(scheduledForUTC).getTime() - Date.now());
        await scheduledTweetQueue.add(
          'scheduled-tweet',
          { scheduledTweetId: rows[0].id },
          { delay }
        );
        
        scheduled.push(rows[0]);
      }
      scheduledCount++;
    }
    res.json({ success: true, scheduled });
  } catch (error) {
    console.error('Bulk schedule error:', error);
    res.status(500).json({ error: 'Failed to schedule bulk content' });
  }
});


// Schedule a tweet
router.post('/', validateRequest(scheduleSchema), validateTwitterConnection, async (req, res) => {
  try {
  const { content, media = [], thread, threadMedia = [], scheduled_for, timezone = 'UTC' } = req.body;
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

    // Thread support: if thread is present and valid, use it
    let mainContent = content;
    let threadTweets = [];
    let threadMediaArr = [];
    if (Array.isArray(thread) && thread.length > 0) {
      // Filter: allow string or object with content, preserve raw Unicode, do NOT HTML-encode
      const flatThread = thread
        .map(t => (typeof t === 'string' ? t : (t && typeof t.content === 'string' ? t.content : '')))
        .map(t => (t || '').trim())
        .filter(t => t.length > 0);
      // Log for debugging encoding issues
      console.log('[Thread Unicode Debug] Incoming thread:', thread);
      console.log('[Thread Unicode Debug] Flat thread:', flatThread);
      if (flatThread.length > 0) {
        mainContent = flatThread[0];
        threadTweets = flatThread.length > 1 ? flatThread.slice(1).map(content => ({ content })) : [];
        // Accept threadMedia as array of arrays of media IDs, align with thread
        if (Array.isArray(threadMedia) && threadMedia.length === flatThread.length) {
          threadMediaArr = threadMedia;
        } else if (Array.isArray(threadMedia)) {
          // Fallback: pad or trim to match thread length
          threadMediaArr = threadMedia.slice(0, flatThread.length);
          while (threadMediaArr.length < flatThread.length) threadMediaArr.push([]);
        } else {
          threadMediaArr = [];
        }
      }
    }

    // Debug logging for validation issues
    if (!mainContent || mainContent.trim().length === 0) {
      console.error('[Schedule Debug] Incoming payload:', req.body);
      console.error('[Schedule Debug] Computed mainContent:', mainContent);
      console.error('[Schedule Debug] Computed threadTweets:', threadTweets);
      return res.status(400).json({ error: 'Please enter some content or add images' });
    }

    // Save scheduled tweet (not posted yet)
    // Store media IDs in both media and media_urls columns for compatibility
    // Store per-tweet media for threads in thread_media column
    const { rows } = await pool.query(
      `INSERT INTO scheduled_tweets (
        user_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *`,
      [userId, mainContent, JSON.stringify(media), JSON.stringify(media), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledTime, timezone]
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
      message: 'Tweets are scheduled at least 5 minutes in the future as per platform policy.',
      scheduled_tweet: {
        id: rows[0].id,
        scheduled_for: rows[0].scheduled_for,
        timezone: rows[0].timezone,
        status: rows[0].status,
        content: rows[0].content,
        media: rows[0].media,
        thread_tweets: rows[0].thread_tweets
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
