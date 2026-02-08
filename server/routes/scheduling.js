import express from 'express';
import pool from '../config/database.js';
import { validateRequest, scheduleSchema } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { creditService } from '../services/creditService.js';
import { scheduledTweetService } from '../services/scheduledTweetService.js';
import { scheduledTweetQueue } from '../services/queueService.js';
import moment from 'moment-timezone';

const router = express.Router();

// Get scheduled tweets (frontend expects /scheduled)
router.get('/scheduled', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const offset = (page - 1) * limit;
    const teamId = req.headers['x-team-id'] || null;

    console.log('[ScheduledTweets] Request:', {
      userId: req.user.id,
      teamId,
      page,
      limit,
      status,
      headers: req.headers
    });

    let rows;
    if (teamId) {
      // Check if user is a member of the team
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, req.user.id, 'active']
      );
      console.log('[ScheduledTweets] Team membership rows:', memberRows);
      
      if (memberRows.length === 0) {
        console.log('[ScheduledTweets] Not a member of this team:', teamId);
        return res.status(403).json({ error: 'Not a member of this team' });
      }

      // Fetch ALL scheduled tweets for the team (not just user's own)
      const result = await pool.query(
        `SELECT st.*, 
                ta.twitter_username as account_username,
                u.email as scheduled_by_email,
                u.name as scheduled_by_name
         FROM scheduled_tweets st
         LEFT JOIN team_accounts ta ON st.account_id = ta.id
         LEFT JOIN users u ON st.user_id = u.id
         WHERE st.team_id = $1 AND st.status = $2
         ORDER BY st.scheduled_for ASC
         LIMIT $3 OFFSET $4`,
        [teamId, status, limit, offset]
      );
      console.log('[ScheduledTweets] Team scheduled tweets found:', result.rows.length);
      rows = result.rows;
    } else {
      // Fetch only user's personal scheduled tweets (no team_id)
      const result = await pool.query(
        `SELECT st.*, ta.twitter_username
         FROM scheduled_tweets st
         LEFT JOIN twitter_auth ta ON st.user_id = ta.user_id
         WHERE st.user_id = $1 AND (st.team_id IS NULL OR st.team_id::text = '')
         AND st.status = $2
         ORDER BY st.scheduled_for ASC
         LIMIT $3 OFFSET $4`,
        [req.user.id, status, limit, offset]
      );
      console.log('[ScheduledTweets] Personal scheduled tweets found:', result.rows.length);
      rows = result.rows;
    }

    res.json({ scheduled_tweets: rows });

  } catch (error) {
    console.error('Get scheduled tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled tweets' });
  }
});

// Bulk schedule drafts
router.post('/bulk', async (req, res) => {
  try {
    const { items, frequency, startDate, timeOfDay, postsPerDay = 1, dailyTimes = [timeOfDay || '09:00'], daysOfWeek, images, timezone = 'UTC' } = req.body;
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
    }
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
    
    // Get account_id if team
    let accountId = null;
    if (teamId) {
      const { rows: teamAccountRows } = await pool.query(
        'SELECT id FROM team_accounts WHERE team_id = $1 AND active = true LIMIT 1',
        [teamId]
      );
      if (teamAccountRows.length > 0) {
        accountId = teamAccountRows[0].id;
      }
    }
    
    // Check team role and determine approval status
    let approvalStatus = 'approved';
    let approvedBy = null;
    if (teamId) {
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );
      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }
      const userRole = memberRows[0].role;
      if (userRole === 'editor') {
        approvalStatus = 'pending_approval';
      } else {
        approvalStatus = 'approved';
        approvedBy = userId;
      }
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
        threadParts = threadParts.filter(part => part && part.trim().length > 0);
        console.log(`📝 Scheduling thread with ${threadParts.length} parts:`, threadParts.map((p, i) => `Part ${i + 1}: ${p.substring(0, 50)}...`));
      } else if (isThread && content && content.includes('---')) {
        threadParts = content.split('---').map(part => part.trim()).filter(Boolean);
        console.log(`📝 Scheduling thread (split by ---) with ${threadParts.length} parts:`, threadParts.map((p, i) => `Part ${i + 1}: ${p.substring(0, 50)}...`));
      }
      
      if (frequency === 'daily') {
        const dayOffset = Math.floor(scheduledCount / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        current = moment.tz(startDate, timezone).add(dayOffset, 'day').set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = current.clone().utc().toDate();
        
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, team_id, account_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [userId, teamId, accountId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, timezone, approvalStatus, approvedBy, approvalStatus === 'pending_approval' ? new Date() : null]
        );
        
        console.log(`✅ [Daily] Scheduled ID ${rows[0].id}: "${mainContent.substring(0, 40)}..." with ${threadTweets.length} thread tweets`);
        
        if (approvalStatus === 'approved') {
          const delay = Math.max(0, new Date(scheduledForUTC).getTime() - Date.now());
          await scheduledTweetQueue.add(
            'scheduled-tweet',
            { scheduledTweetId: rows[0].id },
            { delay }
          );
        }
        
        scheduled.push(rows[0]);
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        const week = Math.floor(scheduledCount / (days.length * postsPerDay));
        const dayIndex = Math.floor((scheduledCount % (days.length * postsPerDay)) / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        const next = moment.tz(startDate, timezone).add(week, 'week').day(days[dayIndex]);
        next.set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = next.clone().utc().toDate();
        
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, team_id, account_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [userId, teamId, accountId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, timezone, approvalStatus, approvedBy, approvalStatus === 'pending_approval' ? new Date() : null]
        );
        
        if (approvalStatus === 'approved') {
          const delay = Math.max(0, new Date(scheduledForUTC).getTime() - Date.now());
          await scheduledTweetQueue.add(
            'scheduled-tweet',
            { scheduledTweetId: rows[0].id },
            { delay }
          );
        }
        
        scheduled.push(rows[0]);
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek)) {
        const week = Math.floor(scheduledCount / (daysOfWeek.length * postsPerDay));
        const dayIndex = Math.floor((scheduledCount % (daysOfWeek.length * postsPerDay)) / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        const next = moment.tz(startDate, timezone).add(week, 'week').day(daysOfWeek[dayIndex]);
        next.set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = next.clone().utc().toDate();
        
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, team_id, account_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [userId, teamId, accountId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, timezone, approvalStatus, approvedBy, approvalStatus === 'pending_approval' ? new Date() : null]
        );
        
        if (approvalStatus === 'approved') {
          const delay = Math.max(0, new Date(scheduledForUTC).getTime() - Date.now());
          await scheduledTweetQueue.add(
            'scheduled-tweet',
            { scheduledTweetId: rows[0].id },
            { delay }
          );
        }
        
        scheduled.push(rows[0]);
      }
      scheduledCount++;
    }
    
    res.json({ success: true, scheduled, approval_status: approvalStatus });
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
    let teamId = req.headers['x-team-id'] || null;
    let accountId = null;
    
    // If frontend sends selectedAccount.team_id, use that
    if (!teamId && req.body.team_id) {
      teamId = req.body.team_id;
    }
    
    if (teamId) {
      // Find the active team account for this team
      const { rows: teamAccountRows } = await pool.query(
        'SELECT id FROM team_accounts WHERE team_id = $1 AND active = true LIMIT 1',
        [teamId]
      );
      if (teamAccountRows.length > 0) {
        accountId = teamAccountRows[0].id;
      }
    }

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

    // Check team role and determine approval status
    let approvalStatus = 'approved';
    let approvedBy = null;
    if (teamId) {
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );
      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }
      const userRole = memberRows[0].role;
      // Editors need approval, Owners and Admins are auto-approved
      if (userRole === 'editor') {
        approvalStatus = 'pending_approval';
      } else {
        approvalStatus = 'approved';
        approvedBy = userId;
      }
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

    // Thread support
    let mainContent = content;
    let threadTweets = [];
    let threadMediaArr = [];
    
    if (Array.isArray(thread) && thread.length > 0) {
      const flatThread = thread
        .map(t => (typeof t === 'string' ? t : (t && typeof t.content === 'string' ? t.content : '')))
        .map(t => (t || '').trim())
        .filter(t => t.length > 0);
      
      console.log('[Thread Unicode Debug] Incoming thread:', thread);
      console.log('[Thread Unicode Debug] Flat thread:', flatThread);
      
      if (flatThread.length > 0) {
        mainContent = flatThread[0];
        threadTweets = flatThread.length > 1 ? flatThread.slice(1).map(content => ({ content })) : [];
        
        if (Array.isArray(threadMedia) && threadMedia.length === flatThread.length) {
          threadMediaArr = threadMedia;
        } else if (Array.isArray(threadMedia)) {
          threadMediaArr = threadMedia.slice(0, flatThread.length);
          while (threadMediaArr.length < flatThread.length) threadMediaArr.push([]);
        } else {
          threadMediaArr = [];
        }
      }
    }

    // Debug logging
    if (!mainContent || mainContent.trim().length === 0) {
      console.error('[Schedule Debug] Incoming payload:', req.body);
      console.error('[Schedule Debug] Computed mainContent:', mainContent);
      console.error('[Schedule Debug] Computed threadTweets:', threadTweets);
      return res.status(400).json({ error: 'Please enter some content or add images' });
    }

    // Save scheduled tweet
    const { rows } = await pool.query(
      `INSERT INTO scheduled_tweets (
        user_id, team_id, account_id, content, media, media_urls, thread_tweets, thread_media, 
        scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        userId, 
        teamId || null, 
        accountId || null, 
        mainContent, 
        JSON.stringify(media), 
        JSON.stringify(media), 
        JSON.stringify(threadTweets), 
        JSON.stringify(threadMediaArr), 
        scheduledTime, 
        timezone, 
        approvalStatus, 
        approvedBy, 
        approvalStatus === 'pending_approval' ? new Date() : null
      ]
    );

    // Only enqueue if approved
    if (approvalStatus === 'approved') {
      const delay = Math.max(0, new Date(scheduledTime).getTime() - Date.now());
      await scheduledTweetQueue.add(
        'scheduled-tweet',
        { scheduledTweetId: rows[0].id },
        { delay }
      );
      console.log(`✅ Scheduled tweet for ${scheduledTime.toISOString()}`);
    } else {
      console.log(`📋 Tweet scheduled for ${scheduledTime.toISOString()} - pending approval`);
    }

    res.json({
      success: true,
      scheduled: rows[0],
      message: approvalStatus === 'pending_approval'
        ? 'Tweet scheduled and awaiting approval from team admin/owner.'
        : 'Tweet scheduled successfully.',
      approval_status: approvalStatus,
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
        if (!teamId && selectedAccountId) {
          const { rows } = await pool.query(
            'SELECT team_id FROM team_accounts WHERE id = $1 AND active = true',
            [selectedAccountId]
          );
          if (rows.length > 0) {
            teamId = rows[0].team_id;
          }
        }
    res.status(500).json({ error: 'Failed to schedule tweet' });
  }
});

// Get scheduled tweets (alternative endpoint)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const offset = (page - 1) * limit;
    const teamId = req.headers['x-team-id'] || null;

    let rows;
    if (teamId) {
      // Check team membership
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, req.user.id, 'active']
      );
      
      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }

      // Fetch ALL team scheduled tweets
      const result = await pool.query(
        `SELECT st.*, 
                ta.twitter_username as account_username,
                u.email as scheduled_by_email,
                u.name as scheduled_by_name
         FROM scheduled_tweets st
         LEFT JOIN team_accounts ta ON st.account_id = ta.id
         LEFT JOIN users u ON st.user_id = u.id
         WHERE st.team_id = $1 AND st.status = $2
         ORDER BY st.scheduled_for ASC
         LIMIT $3 OFFSET $4`,
        [teamId, status, limit, offset]
      );
      rows = result.rows;
    } else {
      // Fetch personal scheduled tweets only
      const result = await pool.query(
        `SELECT st.*, ta.twitter_username
         FROM scheduled_tweets st
         LEFT JOIN twitter_auth ta ON st.user_id = ta.user_id
         WHERE st.user_id = $1 AND (st.team_id IS NULL OR st.team_id::text = '')
         AND st.status = $2
         ORDER BY st.scheduled_for ASC
         LIMIT $3 OFFSET $4`,
        [req.user.id, status, limit, offset]
      );
      rows = result.rows;
    }

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
    const teamId = req.headers['x-team-id'] || null;

    // Check permissions
    if (teamId) {
      // For team tweets, check if user is a member
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );
      
      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }

      // Update team scheduled tweet
      const { rows } = await pool.query(
        `UPDATE scheduled_tweets 
         SET status = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND team_id = $3 
         RETURNING *`,
        ['cancelled', scheduleId, teamId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Scheduled tweet not found' });
      }

      // Remove BullMQ job
      const jobs = await scheduledTweetQueue.getDelayed();
      for (const job of jobs) {
        if (job.data.scheduledTweetId === rows[0].id) {
          await job.remove();
        }
      }

      return res.json({ success: true, message: 'Scheduled tweet cancelled' });
    } else {
      // Personal tweet - only owner can cancel
      const { rows } = await pool.query(
        `UPDATE scheduled_tweets 
         SET status = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND user_id = $3 AND (team_id IS NULL OR team_id::text = '')
         RETURNING *`,
        ['cancelled', scheduleId, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Scheduled tweet not found' });
      }

      // Remove BullMQ job
      const jobs = await scheduledTweetQueue.getDelayed();
      for (const job of jobs) {
        if (job.data.scheduledTweetId === rows[0].id) {
          await job.remove();
        }
      }

      return res.json({ success: true, message: 'Scheduled tweet cancelled' });
    }

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
    const teamId = req.headers['x-team-id'] || null;

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

    let rows;
    if (teamId) {
      // Check team membership
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );
      
      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }

      // Update team scheduled tweet
      const result = await pool.query(
        `UPDATE scheduled_tweets 
         SET scheduled_for = $1, timezone = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND team_id = $4 AND status = 'pending'
         RETURNING *`,
        [scheduledTime, timezone, scheduleId, teamId]
      );
      rows = result.rows;
    } else {
      // Update personal scheduled tweet
      const result = await pool.query(
        `UPDATE scheduled_tweets 
         SET scheduled_for = $1, timezone = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND user_id = $4 AND (team_id IS NULL OR team_id::text = '') AND status = 'pending'
         RETURNING *`,
        [scheduledTime, timezone, scheduleId, userId]
      );
      rows = result.rows;
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled tweet not found or already processed' });
    }

    // Remove existing BullMQ job
    const jobs = await scheduledTweetQueue.getDelayed();
    for (const job of jobs) {
      if (job.data.scheduledTweetId === rows[0].id) {
        await job.remove();
      }
    }

    // Enqueue new job with updated delay
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