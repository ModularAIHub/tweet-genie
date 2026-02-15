import express from 'express';
import pool from '../config/database.js';
import { validateRequest, scheduleSchema } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { resolveTwitterScope } from '../utils/twitterScopeResolver.js';
import { getDbScheduledTweetWorkerStatus } from '../workers/dbScheduledTweetWorker.js';
import moment from 'moment-timezone';

const router = express.Router();
const SCHEDULING_DEBUG = process.env.SCHEDULING_DEBUG === 'true';
const MAX_BULK_SCHEDULE_ITEMS = 30;
const MAX_SCHEDULING_WINDOW_DAYS = 15;

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

function getMaxSchedulingUtcMoment() {
  return moment.utc().add(MAX_SCHEDULING_WINDOW_DAYS, 'days');
}

function isQueryTimeoutError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('query read timeout') ||
    message.includes('statement timeout') ||
    message.includes('canceling statement due to statement timeout')
  );
}

async function ensureActiveTeamMembership(teamId, userId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM team_members
     WHERE team_id = $1
       AND user_id = $2
       AND status = $3
     LIMIT 1`,
    [teamId, userId, 'active']
  );
  return rows.length > 0;
}

async function fetchTeamScheduledRows({ teamId, statuses, safeLimit, offset }) {
  const teamStatusClause = statuses ? 'AND st.status = ANY($2::text[])' : '';
  const teamParams = statuses
    ? [teamId, statuses, safeLimit, offset]
    : [teamId, safeLimit, offset];
  const teamLimitIdx = statuses ? 3 : 2;
  const teamOffsetIdx = statuses ? 4 : 3;

  const result = await pool.query(
    `SELECT st.*
     FROM scheduled_tweets st
     WHERE st.team_id = $1 ${teamStatusClause}
     ORDER BY st.scheduled_for ASC
     LIMIT $${teamLimitIdx} OFFSET $${teamOffsetIdx}`,
    teamParams
  );

  return result.rows;
}

async function enrichTeamScheduledRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows || [];
  }

  const accountIds = [...new Set(
    rows
      .map((row) => row.account_id)
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
      .map((value) => String(value))
  )];

  const userIds = [...new Set(
    rows
      .map((row) => row.user_id)
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
      .map((value) => String(value))
  )];

  const accountUsernameById = new Map();
  const userMetaById = new Map();

  if (accountIds.length > 0) {
    const { rows: accountRows } = await pool.query(
      `SELECT id::text AS account_id, twitter_username
       FROM team_accounts
       WHERE id::text = ANY($1::text[])`,
      [accountIds]
    );

    for (const accountRow of accountRows) {
      accountUsernameById.set(String(accountRow.account_id), accountRow.twitter_username || null);
    }
  }

  if (userIds.length > 0) {
    const { rows: userRows } = await pool.query(
      `SELECT id::text AS user_id, email, name
       FROM users
       WHERE id::text = ANY($1::text[])`,
      [userIds]
    );

    for (const userRow of userRows) {
      userMetaById.set(String(userRow.user_id), {
        email: userRow.email || null,
        name: userRow.name || null,
      });
    }
  }

  return rows.map((row) => {
    const accountKey = row.account_id !== null && row.account_id !== undefined ? String(row.account_id) : null;
    const userKey = row.user_id !== null && row.user_id !== undefined ? String(row.user_id) : null;
    const userMeta = userKey ? userMetaById.get(userKey) : null;

    return {
      ...row,
      account_username: accountKey ? accountUsernameById.get(accountKey) || null : null,
      scheduled_by_email: userMeta?.email || null,
      scheduled_by_name: userMeta?.name || null,
    };
  });
}

async function fetchPersonalScheduledRows({ userId, twitterScope, statuses, safeLimit, offset }) {
  const hasAuthorScope = Boolean(twitterScope?.twitterUserId);
  const statusParamIdx = hasAuthorScope ? 3 : 2;
  const statusClause = statuses ? `AND st.status = ANY($${statusParamIdx}::text[])` : '';
  const authorScopeClause = hasAuthorScope
    ? 'AND (st.author_id = $2 OR (st.author_id IS NULL AND st.user_id = $1))'
    : 'AND (st.author_id IS NULL AND st.user_id = $1)';

  const personalParams = hasAuthorScope
    ? [userId, twitterScope.twitterUserId]
    : [userId];

  if (statuses) {
    personalParams.push(statuses);
  }

  const limitIdx = personalParams.length + 1;
  const offsetIdx = personalParams.length + 2;
  personalParams.push(safeLimit, offset);

  const result = await pool.query(
    `SELECT st.*
     FROM scheduled_tweets st
     WHERE st.user_id = $1
       AND (st.team_id IS NULL OR st.team_id::text = '')
       ${authorScopeClause}
       ${statusClause}
     ORDER BY st.scheduled_for ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    personalParams
  );

  const personalUsername = twitterScope?.twitterUsername || null;
  return result.rows.map((row) => ({
    ...row,
    account_username: personalUsername,
    twitter_username: personalUsername,
  }));
}

async function listScheduledTweets({ userId, teamId, selectedAccountId, safeLimit, offset, requestedStatus, statuses }) {
  const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId });

  schedulingDebug('[ScheduledTweets] Request:', {
    userId,
    teamId,
    selectedAccountId,
    mode: twitterScope.mode,
    pageSize: safeLimit,
    offset,
    status: requestedStatus,
    statuses,
  });

  if (teamId) {
    const isMember = await ensureActiveTeamMembership(teamId, userId);
    if (!isMember) {
      return { forbidden: true };
    }

    try {
      const rows = await fetchTeamScheduledRows({ teamId, statuses, safeLimit, offset });
      const enrichedRows = await enrichTeamScheduledRows(rows);
      return { rows: enrichedRows, disconnected: false };
    } catch (teamQueryError) {
      if (!isQueryTimeoutError(teamQueryError)) {
        throw teamQueryError;
      }

      console.warn('[ScheduledTweets] Team query timed out, retrying with reduced result window.', {
        teamId,
        requestedStatus,
        limit: safeLimit,
      });

      const fallbackRows = await fetchTeamScheduledRows({
        teamId,
        statuses,
        safeLimit: Math.min(safeLimit, 10),
        offset: 0,
      });
      const fallbackEnrichedRows = await enrichTeamScheduledRows(fallbackRows);
      return { rows: fallbackEnrichedRows, disconnected: false, degraded: true };
    }
  }

  if (!twitterScope.connected && twitterScope.mode === 'personal') {
    return { rows: [], disconnected: true };
  }

  const personalRows = await fetchPersonalScheduledRows({
    userId,
    twitterScope,
    statuses,
    safeLimit,
    offset,
  });

  return { rows: personalRows, disconnected: false };
}

async function handleScheduledTweetsList(req, res) {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const { safePage, safeLimit, offset } = getNormalizedPagination(page, limit);
    const { requestedStatus, statuses } = resolveScheduledStatuses(status);
    const teamId = req.headers['x-team-id'] || null;
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const result = await listScheduledTweets({
      userId,
      teamId,
      selectedAccountId,
      safeLimit,
      offset,
      requestedStatus,
      statuses,
    });

    if (result.forbidden) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    schedulingDebug('[ScheduledTweets] List query result:', {
      userId,
      teamId,
      page: safePage,
      limit: safeLimit,
      requestedStatus,
      statuses,
      resultCount: result.rows?.length || 0,
      degraded: Boolean(result.degraded),
      disconnected: Boolean(result.disconnected),
    });

    return res.json({
      scheduled_tweets: (result.rows || []).map(serializeScheduledTweet),
      disconnected: Boolean(result.disconnected),
      degraded: Boolean(result.degraded),
    });

  } catch (error) {
    console.error('Get scheduled tweets error:', error);
    return res.status(500).json({ error: 'Failed to fetch scheduled tweets' });
  }
}

// Get scheduled tweets (frontend expects /scheduled)
router.get('/scheduled', handleScheduledTweetsList);

// Bulk schedule drafts
router.post('/bulk', validateTwitterConnection, async (req, res) => {
  try {
    const { items, frequency, startDate, timeOfDay, postsPerDay = 1, dailyTimes = [timeOfDay || '09:00'], daysOfWeek, images, timezone = 'UTC' } = req.body;
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || req.body.teamId || req.body.team_id || null;
    const normalizedTimezone = normalizeTimezoneInput(timezone);
    const maxSchedulingUtc = getMaxSchedulingUtcMoment();
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
    }
    if (items.length > MAX_BULK_SCHEDULE_ITEMS) {
      return res.status(400).json({
        error: `Bulk scheduling is limited to ${MAX_BULK_SCHEDULE_ITEMS} prompts at a time.`,
      });
    }
    if (!normalizedTimezone) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
    
    const selectedAccountId =
      req.headers['x-selected-account-id'] ||
      req.body.accountId ||
      req.body.account_id ||
      null;
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
        if (current.clone().utc().isAfter(maxSchedulingUtc)) {
          return res.status(400).json({
            error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
          });
        }
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
        if (next.clone().utc().isAfter(maxSchedulingUtc)) {
          return res.status(400).json({
            error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
          });
        }
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
        if (next.clone().utc().isAfter(maxSchedulingUtc)) {
          return res.status(400).json({
            error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
          });
        }
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

    const maxTime = moment().add(MAX_SCHEDULING_WINDOW_DAYS, 'days').toDate();
    if (parsedSchedule.utcDate > maxTime) {
      return res.status(400).json({
        error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
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
router.get('/', handleScheduledTweetsList);

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
