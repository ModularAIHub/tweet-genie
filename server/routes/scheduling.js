import express from 'express';
import pool from '../config/database.js';
import { validateRequest, scheduleSchema } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { resolveTwitterScope } from '../utils/twitterScopeResolver.js';
import { getDbScheduledTweetWorkerStatus } from '../workers/dbScheduledTweetWorker.js';
import moment from 'moment-timezone';

const router = express.Router();
const SCHEDULING_DEBUG = process.env.SCHEDULING_DEBUG === 'true';

const schedulingDebug = (...args) => {
  if (SCHEDULING_DEBUG) {
    console.log(...args);
  }
};

const SCHEDULED_STATUS_GROUPS = {
  pending: ['pending', 'processing'],
  processing: ['processing'],
  completed: ['completed', 'partially_completed'],
  complete: ['completed', 'partially_completed'],
  posted: ['completed', 'partially_completed'],
  done: ['completed', 'partially_completed'],
  partially_completed: ['partially_completed'],
  failed: ['failed'],
  error: ['failed'],
  cancelled: ['cancelled'],
  canceled: ['cancelled'],
};

function getNormalizedPagination(page, limit) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);

  const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

  return {
    safePage,
    safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function resolveScheduledStatuses(rawStatus) {
  const normalized = String(rawStatus || 'pending').trim().toLowerCase();
  if (normalized === 'all') {
    return { requestedStatus: normalized, statuses: null };
  }
  return {
    requestedStatus: normalized,
    statuses: SCHEDULED_STATUS_GROUPS[normalized] || [normalized],
  };
}

const ISO_OFFSET_SUFFIX = /(?:[zZ]|[+\-]\d{2}:?\d{2})$/;
const DB_UTC_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEZONE_ALIAS_MAP = {
  'asia/calcutta': 'Asia/Kolkata',
};
let scheduledAccountIdColumnTypeCache = null;

function normalizeScheduledAccountId(rawAccountId, columnType) {
  if (rawAccountId === null || rawAccountId === undefined) {
    return null;
  }

  const value = String(rawAccountId).trim();
  if (!value) {
    return null;
  }

  if (columnType === 'integer') {
    return /^\d+$/.test(value) ? Number.parseInt(value, 10) : null;
  }

  if (columnType === 'uuid') {
    return UUID_PATTERN.test(value) ? value : null;
  }

  return value;
}

async function getScheduledAccountIdColumnType() {
  if (scheduledAccountIdColumnTypeCache) {
    return scheduledAccountIdColumnTypeCache;
  }

  try {
    const { rows } = await pool.query(
      `SELECT data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'scheduled_tweets'
         AND column_name = 'account_id'
       LIMIT 1`
    );
    const dataType = String(rows[0]?.data_type || rows[0]?.udt_name || '').toLowerCase();

    if (dataType === 'uuid') {
      scheduledAccountIdColumnTypeCache = 'uuid';
    } else if (['integer', 'bigint', 'smallint', 'int2', 'int4', 'int8'].includes(dataType)) {
      scheduledAccountIdColumnTypeCache = 'integer';
    } else {
      scheduledAccountIdColumnTypeCache = 'text';
    }
  } catch (error) {
    console.warn('[Scheduling] Failed to resolve scheduled_tweets.account_id type. Defaulting to text.', error.message);
    scheduledAccountIdColumnTypeCache = 'text';
  }

  return scheduledAccountIdColumnTypeCache;
}

function normalizeTimezoneInput(timezone) {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    return null;
  }

  const trimmed = timezone.trim();
  const mapped = TIMEZONE_ALIAS_MAP[trimmed.toLowerCase()] || trimmed;
  const zone = moment.tz.zone(mapped);
  return zone ? zone.name : null;
}

function toUtcIso(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const parsed = ISO_OFFSET_SUFFIX.test(raw)
    ? moment.parseZone(raw).utc()
    : moment.utc(raw, [moment.ISO_8601, 'YYYY-MM-DD HH:mm:ss'], true);

  if (!parsed.isValid()) {
    return null;
  }

  return parsed.toISOString();
}

function serializeScheduledTweet(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  return {
    ...row,
    scheduled_for: toUtcIso(row.scheduled_for),
    created_at: toUtcIso(row.created_at),
    updated_at: toUtcIso(row.updated_at),
    posted_at: toUtcIso(row.posted_at),
    last_retry_at: toUtcIso(row.last_retry_at),
    processing_started_at: toUtcIso(row.processing_started_at),
    approval_requested_at: toUtcIso(row.approval_requested_at),
  };
}

function parseScheduledTimeToUtc(scheduledFor, timezone) {
  const zone = normalizeTimezoneInput(timezone) || 'UTC';
  let parsedMoment = null;

  if (scheduledFor instanceof Date) {
    parsedMoment = moment(scheduledFor);
  } else if (typeof scheduledFor === 'string') {
    const rawValue = scheduledFor.trim();
    if (!rawValue) return null;
    parsedMoment = ISO_OFFSET_SUFFIX.test(rawValue)
      ? moment.parseZone(rawValue)
      : moment.tz(rawValue, zone);
  } else {
    parsedMoment = moment(scheduledFor);
  }

  if (!parsedMoment || !parsedMoment.isValid()) {
    return null;
  }

  const utcMoment = parsedMoment.clone().utc();
  return {
    utcDate: utcMoment.toDate(),
    utcDbTimestamp: utcMoment.format(DB_UTC_TIMESTAMP_FORMAT),
    utcIso: utcMoment.toISOString(),
  };
}

// Get scheduled tweets (frontend expects /scheduled)
router.get('/scheduled', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const { safePage, safeLimit, offset } = getNormalizedPagination(page, limit);
    const { requestedStatus, statuses } = resolveScheduledStatuses(status);
    const teamId = req.headers['x-team-id'] || null;
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId });

    schedulingDebug('[ScheduledTweets] Request:', {
      userId,
      teamId,
      selectedAccountId,
      mode: twitterScope.mode,
      page: safePage,
      limit: safeLimit,
      status: requestedStatus,
      statuses,
      headers: req.headers
    });

    let rows;
    if (teamId) {
      // Check if user is a member of the team
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );
      schedulingDebug('[ScheduledTweets] Team membership rows:', memberRows);
      
      if (memberRows.length === 0) {
        schedulingDebug('[ScheduledTweets] Not a member of this team:', teamId);
        return res.status(403).json({ error: 'Not a member of this team' });
      }

      // Fetch ALL scheduled tweets for the team (not just user's own)
      const teamStatusClause = statuses ? 'AND st.status = ANY($2::text[])' : '';
      const teamParams = statuses
        ? [teamId, statuses, safeLimit, offset]
        : [teamId, safeLimit, offset];
      const teamLimitIdx = statuses ? 3 : 2;
      const teamOffsetIdx = statuses ? 4 : 3;

      const result = await pool.query(
        `SELECT st.*, 
                ta.twitter_username as account_username,
                u.email as scheduled_by_email,
                u.name as scheduled_by_name
         FROM scheduled_tweets st
         LEFT JOIN team_accounts ta ON st.account_id::text = ta.id::text
         LEFT JOIN users u ON st.user_id = u.id
         WHERE st.team_id = $1 ${teamStatusClause}
         ORDER BY st.scheduled_for ASC
         LIMIT $${teamLimitIdx} OFFSET $${teamOffsetIdx}`,
        teamParams
      );
      schedulingDebug('[ScheduledTweets] Team scheduled tweets found:', result.rows.length);
      rows = result.rows;
    } else {
      if (!twitterScope.connected && twitterScope.mode === 'personal') {
        return res.json({ scheduled_tweets: [], disconnected: true });
      }

      // Fetch only user's personal scheduled tweets (no team_id)
      const personalStatusClause = statuses ? 'AND st.status = ANY($3::text[])' : '';
      const personalParams = statuses
        ? [userId, twitterScope.twitterUserId, statuses, safeLimit, offset]
        : [userId, twitterScope.twitterUserId, safeLimit, offset];
      const personalLimitIdx = statuses ? 4 : 3;
      const personalOffsetIdx = statuses ? 5 : 4;

      const result = await pool.query(
        `SELECT st.*, ta.twitter_username
         FROM scheduled_tweets st
         LEFT JOIN twitter_auth ta ON st.user_id = ta.user_id
         WHERE st.user_id = $1
          AND (st.team_id IS NULL OR st.team_id::text = '')
          AND (
            st.author_id = $2
            OR (st.author_id IS NULL AND st.user_id = $1)
          )
          ${personalStatusClause}
         ORDER BY st.scheduled_for ASC
         LIMIT $${personalLimitIdx} OFFSET $${personalOffsetIdx}`,
        personalParams
      );
      schedulingDebug('[ScheduledTweets] Personal scheduled tweets found:', result.rows.length);
      rows = result.rows;
    }

    res.json({ scheduled_tweets: rows.map(serializeScheduledTweet), disconnected: false });

  } catch (error) {
    console.error('Get scheduled tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled tweets' });
  }
});

// Bulk schedule drafts
router.post('/bulk', validateTwitterConnection, async (req, res) => {
  try {
    const { items, frequency, startDate, timeOfDay, postsPerDay = 1, dailyTimes = [timeOfDay || '09:00'], daysOfWeek, images, timezone = 'UTC' } = req.body;
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    const normalizedTimezone = normalizeTimezoneInput(timezone);
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
    }
    if (!normalizedTimezone) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
    
    const selectedAccountId = req.headers['x-selected-account-id'] || null;
    const accountIdColumnType = await getScheduledAccountIdColumnType();

    let teamAccount = null;
    if (teamId) {
      const teamAccountQuery = selectedAccountId
        ? {
            sql: `SELECT id, twitter_user_id
                  FROM team_accounts
                  WHERE id::text = $1::text
                    AND team_id = $2
                    AND active = true
                  LIMIT 1`,
            params: [selectedAccountId, teamId],
          }
        : {
            sql: `SELECT id, twitter_user_id
                  FROM team_accounts
                  WHERE team_id = $1
                    AND active = true
                  ORDER BY updated_at DESC NULLS LAST, id DESC
                  LIMIT 1`,
            params: [teamId],
          };

      const { rows: teamAccountRows } = await pool.query(teamAccountQuery.sql, teamAccountQuery.params);
      if (teamAccountRows.length > 0) {
        teamAccount = teamAccountRows[0];
      } else if (selectedAccountId) {
        return res.status(400).json({
          error: 'Selected team account is not available. Please reselect your team Twitter account.',
        });
      }
    }

    const accountId = normalizeScheduledAccountId(teamAccount?.id, accountIdColumnType);
    if (teamAccount?.id && accountId === null && accountIdColumnType !== 'text') {
      schedulingDebug('[Scheduling] Team account id omitted due to account_id column type mismatch', {
        teamAccountId: teamAccount.id,
        accountIdColumnType,
      });
    }

    let authorId = req.twitterAccount?.twitter_user_id || null;
    if (teamId && teamAccount?.twitter_user_id) {
      authorId = teamAccount.twitter_user_id;
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
    let current = moment.tz(startDate, normalizedTimezone);
    let scheduledCount = 0;
    
    for (const item of items) {
      let content = item.text;
      let isThread = item.isThread;
      let threadParts = item.threadParts || null;
      let media = images?.[scheduledCount] || [];
      
      // If it's a thread, ensure threadParts is properly formatted
      if (isThread && threadParts && Array.isArray(threadParts)) {
        threadParts = threadParts.filter(part => part && part.trim().length > 0);
        schedulingDebug(
          `Scheduling thread with ${threadParts.length} parts:`,
          threadParts.map((p, i) => `Part ${i + 1}: ${p.substring(0, 50)}...`)
        );
      } else if (isThread && content && content.includes('---')) {
        threadParts = content.split('---').map(part => part.trim()).filter(Boolean);
        schedulingDebug(
          `Scheduling thread (split by ---) with ${threadParts.length} parts:`,
          threadParts.map((p, i) => `Part ${i + 1}: ${p.substring(0, 50)}...`)
        );
      }
      
      if (frequency === 'daily') {
        const dayOffset = Math.floor(scheduledCount / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        current = moment.tz(startDate, normalizedTimezone).add(dayOffset, 'day').set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = current.clone().utc().format(DB_UTC_TIMESTAMP_FORMAT);
        
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, team_id, account_id, author_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [userId, teamId, accountId, authorId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, normalizedTimezone, approvalStatus, approvedBy, approvalStatus === 'pending_approval' ? new Date() : null]
        );
        
        schedulingDebug(
          `[Daily] Scheduled ID ${rows[0].id}: "${mainContent.substring(0, 40)}..." with ${threadTweets.length} thread tweets`
        );
        
        scheduled.push(rows[0]);
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        const week = Math.floor(scheduledCount / (days.length * postsPerDay));
        const dayIndex = Math.floor((scheduledCount % (days.length * postsPerDay)) / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        const next = moment.tz(startDate, normalizedTimezone).add(week, 'week').day(days[dayIndex]);
        next.set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = next.clone().utc().format(DB_UTC_TIMESTAMP_FORMAT);
        
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, team_id, account_id, author_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [userId, teamId, accountId, authorId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, normalizedTimezone, approvalStatus, approvedBy, approvalStatus === 'pending_approval' ? new Date() : null]
        );
        
        scheduled.push(rows[0]);
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek)) {
        const week = Math.floor(scheduledCount / (daysOfWeek.length * postsPerDay));
        const dayIndex = Math.floor((scheduledCount % (daysOfWeek.length * postsPerDay)) / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        const next = moment.tz(startDate, normalizedTimezone).add(week, 'week').day(daysOfWeek[dayIndex]);
        next.set({ hour, minute, second: 0, millisecond: 0 });
        const scheduledForUTC = next.clone().utc().format(DB_UTC_TIMESTAMP_FORMAT);
        
        let mainContent = content;
        let threadTweets = [];
        let threadMediaArr = [];
        
        if (isThread && threadParts && Array.isArray(threadParts)) {
          mainContent = threadParts[0] || content;
          threadTweets = threadParts.length > 1 ? threadParts.slice(1).map(content => ({ content })) : [];
          threadMediaArr = Array(threadParts.length).fill([]);
        }
        
        const { rows } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, team_id, account_id, author_id, content, media, media_urls, thread_tweets, thread_media, scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [userId, teamId, accountId, authorId, mainContent, JSON.stringify(media || []), JSON.stringify(media || []), JSON.stringify(threadTweets), JSON.stringify(threadMediaArr), scheduledForUTC, normalizedTimezone, approvalStatus, approvedBy, approvalStatus === 'pending_approval' ? new Date() : null]
        );
        
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
    const selectedAccountId = req.headers['x-selected-account-id'] || null;
    const accountIdColumnType = await getScheduledAccountIdColumnType();
    let accountId = null;
    let authorId = req.twitterAccount?.twitter_user_id || null;
    const normalizedTimezone = normalizeTimezoneInput(timezone);
    
    // If frontend sends selectedAccount.team_id, use that
    if (!teamId && req.body.team_id) {
      teamId = req.body.team_id;
    }
    
    if (teamId) {
      const teamAccountQuery = selectedAccountId
        ? {
            sql: `SELECT id, twitter_user_id
                  FROM team_accounts
                  WHERE id::text = $1::text
                    AND team_id = $2
                    AND active = true
                  LIMIT 1`,
            params: [selectedAccountId, teamId],
          }
        : {
            sql: `SELECT id, twitter_user_id
                  FROM team_accounts
                  WHERE team_id = $1
                    AND active = true
                  ORDER BY updated_at DESC NULLS LAST, id DESC
                  LIMIT 1`,
            params: [teamId],
          };

      const { rows: teamAccountRows } = await pool.query(teamAccountQuery.sql, teamAccountQuery.params);
      if (teamAccountRows.length > 0) {
        accountId = normalizeScheduledAccountId(teamAccountRows[0].id, accountIdColumnType);
        authorId = teamAccountRows[0].twitter_user_id || authorId;
      } else if (selectedAccountId) {
        return res.status(400).json({
          error: 'Selected team account is not available. Please reselect your team Twitter account.',
        });
      }

      if (teamAccountRows.length > 0 && accountId === null && accountIdColumnType !== 'text') {
        schedulingDebug('[Scheduling] Team account id omitted due to account_id column type mismatch', {
          teamAccountId: teamAccountRows[0].id,
          accountIdColumnType,
        });
      }
    }

    // Validate timezone
    if (!normalizedTimezone) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Convert scheduled time to UTC without double-shifting timezone offsets.
    const parsedSchedule = parseScheduledTimeToUtc(scheduled_for, normalizedTimezone);
    if (!parsedSchedule) {
      return res.status(400).json({ error: 'Invalid scheduled time' });
    }

    // Check if time is at least 5 minutes in the future
    const minTime = moment().add(5, 'minutes').toDate();
    if (parsedSchedule.utcDate < minTime) {
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
      
      schedulingDebug('[Thread Unicode Debug] Incoming thread:', thread);
      schedulingDebug('[Thread Unicode Debug] Flat thread:', flatThread);
      
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
        user_id, team_id, account_id, author_id, content, media, media_urls, thread_tweets, thread_media, 
        scheduled_for, timezone, status, approval_status, approved_by, approval_requested_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        userId, 
        teamId || null, 
        accountId || null,
        authorId,
        mainContent,
        JSON.stringify(media),
        JSON.stringify(media),
        JSON.stringify(threadTweets),
        JSON.stringify(threadMediaArr),
        parsedSchedule.utcDbTimestamp,
        normalizedTimezone,
        approvalStatus,
        approvedBy,
        approvalStatus === 'pending_approval' ? new Date() : null
      ]
    );

    if (approvalStatus === 'approved') {
      schedulingDebug(`Scheduled tweet for ${parsedSchedule.utcIso}`);
    } else {
      schedulingDebug(`Tweet scheduled for ${parsedSchedule.utcIso} - pending approval`);
    }

    res.json({
      success: true,
      scheduled: serializeScheduledTweet(rows[0]),
      message: approvalStatus === 'pending_approval'
        ? 'Tweet scheduled and awaiting approval from team admin/owner.'
        : 'Tweet scheduled successfully.',
      approval_status: approvalStatus,
      scheduled_tweet: {
        id: rows[0].id,
        scheduled_for: toUtcIso(rows[0].scheduled_for),
        timezone: normalizedTimezone,
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

// Scheduler runtime status + user queue snapshot (LinkedIn parity endpoint)
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const scheduler = getDbScheduledTweetWorkerStatus();

    if (teamId) {
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );

      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }

      const { rows: statusRows } = await pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM scheduled_tweets
         WHERE team_id = $1
         GROUP BY status`,
        [teamId]
      );
      const countsByStatus = statusRows.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {});

      const { rows: dueRows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM scheduled_tweets
         WHERE team_id = $1
           AND status = 'pending'
           AND (approval_status = 'approved' OR approval_status IS NULL)
           AND scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`,
        [teamId]
      );

      return res.json({
        success: true,
        scheduler,
        userQueue: {
          countsByStatus,
          dueNowCount: dueRows[0]?.count || 0,
        },
      });
    }

    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: null });
    const scopeAuthorId = twitterScope.twitterUserId || null;

    const { rows: statusRows } = await pool.query(
      `SELECT st.status, COUNT(*)::int AS count
       FROM scheduled_tweets st
       WHERE st.user_id = $1
         AND (st.team_id IS NULL OR st.team_id::text = '')
         AND (
           $2::text IS NULL
           OR st.author_id = $2
           OR (st.author_id IS NULL AND st.user_id = $1)
         )
       GROUP BY st.status`,
      [userId, scopeAuthorId]
    );
    const countsByStatus = statusRows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    const { rows: dueRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM scheduled_tweets st
       WHERE st.user_id = $1
         AND (st.team_id IS NULL OR st.team_id::text = '')
         AND (
           $2::text IS NULL
           OR st.author_id = $2
           OR (st.author_id IS NULL AND st.user_id = $1)
         )
         AND st.status = 'pending'
         AND (st.approval_status = 'approved' OR st.approval_status IS NULL)
         AND st.scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`,
      [userId, scopeAuthorId]
    );

    return res.json({
      success: true,
      scheduler,
      userQueue: {
        countsByStatus,
        dueNowCount: dueRows[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get scheduler status error:', error);
    return res.status(500).json({ error: 'Failed to fetch scheduler status' });
  }
});

// Get scheduled tweets (alternative endpoint)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const { safePage, safeLimit, offset } = getNormalizedPagination(page, limit);
    const { requestedStatus, statuses } = resolveScheduledStatuses(status);
    const teamId = req.headers['x-team-id'] || null;
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId });

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

      // Fetch ALL team scheduled tweets
      const teamStatusClause = statuses ? 'AND st.status = ANY($2::text[])' : '';
      const teamParams = statuses
        ? [teamId, statuses, safeLimit, offset]
        : [teamId, safeLimit, offset];
      const teamLimitIdx = statuses ? 3 : 2;
      const teamOffsetIdx = statuses ? 4 : 3;

      const result = await pool.query(
        `SELECT st.*, 
                ta.twitter_username as account_username,
                u.email as scheduled_by_email,
                u.name as scheduled_by_name
         FROM scheduled_tweets st
         LEFT JOIN team_accounts ta ON st.account_id::text = ta.id::text
         LEFT JOIN users u ON st.user_id = u.id
         WHERE st.team_id = $1 ${teamStatusClause}
         ORDER BY st.scheduled_for ASC
         LIMIT $${teamLimitIdx} OFFSET $${teamOffsetIdx}`,
        teamParams
      );
      rows = result.rows;
    } else {
      if (!twitterScope.connected && twitterScope.mode === 'personal') {
        return res.json({ scheduled_tweets: [], disconnected: true });
      }

      // Fetch personal scheduled tweets only
      const personalStatusClause = statuses ? 'AND st.status = ANY($3::text[])' : '';
      const personalParams = statuses
        ? [userId, twitterScope.twitterUserId, statuses, safeLimit, offset]
        : [userId, twitterScope.twitterUserId, safeLimit, offset];
      const personalLimitIdx = statuses ? 4 : 3;
      const personalOffsetIdx = statuses ? 5 : 4;

      const result = await pool.query(
         `SELECT st.*, ta.twitter_username
          FROM scheduled_tweets st
          LEFT JOIN twitter_auth ta ON st.user_id = ta.user_id
          WHERE st.user_id = $1
           AND (st.team_id IS NULL OR st.team_id::text = '')
           AND (
             st.author_id = $2
             OR (st.author_id IS NULL AND st.user_id = $1)
           )
          ${personalStatusClause}
          ORDER BY st.scheduled_for ASC
          LIMIT $${personalLimitIdx} OFFSET $${personalOffsetIdx}`,
         personalParams
      );
      rows = result.rows;
    }

    schedulingDebug('[ScheduledTweets] List query:', {
      userId,
      teamId,
      page: safePage,
      limit: safeLimit,
      requestedStatus,
      statuses,
      resultCount: rows.length
    });

    res.json({ scheduled_tweets: rows.map(serializeScheduledTweet), disconnected: false });

  } catch (error) {
    console.error('Get scheduled tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled tweets' });
  }
});

// Retry a failed scheduled tweet immediately (LinkedIn parity endpoint)
router.post('/retry', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    const scheduleId = req.body?.id || req.body?.scheduleId || req.body?.tweetId;

    if (!scheduleId) {
      return res.status(400).json({ error: 'Scheduled tweet id is required' });
    }

    if (teamId) {
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = $3',
        [teamId, userId, 'active']
      );

      if (memberRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this team' });
      }
    }

    let rows = [];
    try {
      if (teamId) {
        const result = await pool.query(
          `UPDATE scheduled_tweets
           SET status = 'pending',
               error_message = NULL,
               scheduled_for = CASE
                 WHEN scheduled_for < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                   THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                 ELSE scheduled_for
               END,
               retry_count = 0,
               last_retry_at = NULL,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND team_id = $2
             AND status = 'failed'
           RETURNING *`,
          [scheduleId, teamId]
        );
        rows = result.rows;
      } else {
        const result = await pool.query(
          `UPDATE scheduled_tweets
           SET status = 'pending',
               error_message = NULL,
               scheduled_for = CASE
                 WHEN scheduled_for < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                   THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                 ELSE scheduled_for
               END,
               retry_count = 0,
               last_retry_at = NULL,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND user_id = $2
             AND (team_id IS NULL OR team_id::text = '')
             AND status = 'failed'
           RETURNING *`,
          [scheduleId, userId]
        );
        rows = result.rows;
      }
    } catch (retryColumnError) {
      if (retryColumnError?.code !== '42703') {
        throw retryColumnError;
      }

      if (teamId) {
        const result = await pool.query(
          `UPDATE scheduled_tweets
           SET status = 'pending',
               error_message = NULL,
               scheduled_for = CASE
                 WHEN scheduled_for < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                   THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                 ELSE scheduled_for
               END,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND team_id = $2
             AND status = 'failed'
           RETURNING *`,
          [scheduleId, teamId]
        );
        rows = result.rows;
      } else {
        const result = await pool.query(
          `UPDATE scheduled_tweets
           SET status = 'pending',
               error_message = NULL,
               scheduled_for = CASE
                 WHEN scheduled_for < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                   THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                 ELSE scheduled_for
               END,
               processing_started_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND user_id = $2
             AND (team_id IS NULL OR team_id::text = '')
             AND status = 'failed'
           RETURNING *`,
          [scheduleId, userId]
        );
        rows = result.rows;
      }
    }

    if (!rows.length) {
      return res.status(404).json({ error: 'Failed scheduled tweet not found' });
    }

    return res.json({
      success: true,
      message: 'Scheduled tweet queued for retry',
      scheduled_tweet: serializeScheduledTweet(rows[0]),
    });
  } catch (error) {
    console.error('Retry scheduled tweet error:', error);
    return res.status(500).json({ error: 'Failed to retry scheduled tweet' });
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
         SET status = $1,
             processing_started_at = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND team_id = $3 
         RETURNING *`,
        ['cancelled', scheduleId, teamId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Scheduled tweet not found' });
      }

      return res.json({ success: true, message: 'Scheduled tweet cancelled' });
    } else {
      // Personal tweet - only owner can cancel
      const { rows } = await pool.query(
        `UPDATE scheduled_tweets 
         SET status = $1,
             processing_started_at = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND user_id = $3 AND (team_id IS NULL OR team_id::text = '')
         RETURNING *`,
        ['cancelled', scheduleId, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Scheduled tweet not found' });
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
    const normalizedTimezone = normalizeTimezoneInput(timezone);

    // Validate timezone
    if (!normalizedTimezone) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Convert scheduled time to UTC without double-shifting timezone offsets.
    const parsedSchedule = parseScheduledTimeToUtc(scheduled_for, normalizedTimezone);
    if (!parsedSchedule) {
      return res.status(400).json({ error: 'Invalid scheduled time' });
    }

    // Check if time is at least 5 minutes in the future
    const minTime = moment().add(5, 'minutes').toDate();
    if (parsedSchedule.utcDate < minTime) {
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
         SET scheduled_for = $1,
             timezone = $2,
             retry_count = 0,
             last_retry_at = NULL,
             processing_started_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND team_id = $4 AND status = 'pending'
         RETURNING *`,
        [parsedSchedule.utcDbTimestamp, normalizedTimezone, scheduleId, teamId]
      );
      rows = result.rows;
    } else {
      // Update personal scheduled tweet
      const result = await pool.query(
        `UPDATE scheduled_tweets 
         SET scheduled_for = $1,
             timezone = $2,
             retry_count = 0,
             last_retry_at = NULL,
             processing_started_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND user_id = $4 AND (team_id IS NULL OR team_id::text = '') AND status = 'pending'
         RETURNING *`,
        [parsedSchedule.utcDbTimestamp, normalizedTimezone, scheduleId, userId]
      );
      rows = result.rows;
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled tweet not found or already processed' });
    }

    res.json({
      success: true,
      scheduled_tweet: {
        id: rows[0].id,
        scheduled_for: toUtcIso(rows[0].scheduled_for),
        timezone: normalizedTimezone
      }
    });

  } catch (error) {
    console.error('Update scheduled tweet error:', error);
    res.status(500).json({ error: 'Failed to update scheduled tweet' });
  }
});

export default router;
