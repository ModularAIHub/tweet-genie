import express from 'express';
import fetch from 'node-fetch';
import pool from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const normalizeTarget = (target = {}) => ({
  id: target?.id !== undefined && target?.id !== null ? String(target.id) : null,
  teamId: target?.teamId !== undefined && target?.teamId !== null ? String(target.teamId) : null,
  label: typeof target?.label === 'string' ? target.label : null,
  accountType: typeof target?.accountType === 'string' ? target.accountType : 'personal',
  linkedinUserId: target?.linkedinUserId !== undefined && target?.linkedinUserId !== null ? String(target.linkedinUserId) : null,
  connectedByUserId: target?.connectedByUserId !== undefined && target?.connectedByUserId !== null ? String(target.connectedByUserId) : null,
});

const mapTwitterTarget = (row = {}, scope = 'personal') => {
  const username = String(row.twitter_username || '').trim();
  const displayName = String(row.twitter_display_name || '').trim() || (username ? `@${username}` : 'X account');
  return {
    id: row?.id !== undefined && row?.id !== null ? String(row.id) : null,
    platform: 'twitter',
    username: username || null,
    displayName,
    avatar: row?.twitter_profile_image_url || null,
    scope,
  };
};

const mapLinkedInTarget = (row = {}, scope = 'personal') => ({
  id: row?.id !== undefined && row?.id !== null ? String(row.id) : null,
  platform: 'linkedin',
  username: row?.username ? String(row.username) : (row?.linkedinUserId ? String(row.linkedinUserId) : null),
  displayName:
    (row?.displayName ? String(row.displayName) : null) ||
    (row?.label ? String(row.label) : null) ||
    (row?.username ? String(row.username) : null) ||
    'LinkedIn account',
  avatar: row?.avatar || null,
  scope,
});

const mapThreadsTarget = (row = {}, scope = 'personal') => ({
  id: row?.id !== undefined && row?.id !== null ? String(row.id) : null,
  platform: 'threads',
  username: row?.account_username ? String(row.account_username) : (row?.username ? String(row.username) : null),
  displayName:
    (row?.account_display_name ? String(row.account_display_name) : null) ||
    (row?.displayName ? String(row.displayName) : null) ||
    (row?.account_username ? `@${String(row.account_username)}` : 'Threads account'),
  avatar: row?.profile_image_url || row?.avatar || null,
  scope,
});

const listTwitterTargets = async ({ userId, teamId = null, excludeAccountId = null }) => {
  if (teamId) {
    const { rows } = await pool.query(
      `SELECT ta.id, ta.twitter_username, ta.twitter_display_name, ta.twitter_profile_image_url
       FROM team_accounts ta
       INNER JOIN team_members tm
         ON tm.team_id = ta.team_id
        AND tm.user_id = $1
        AND tm.status = 'active'
       WHERE ta.team_id::text = $2::text
         AND ta.active = true
       ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC`,
      [userId, String(teamId)]
    );

    return rows
      .map((row) => mapTwitterTarget(row, 'team'))
      .filter((row) => row.id && row.id !== String(excludeAccountId || ''));
  }

  const { rows } = await pool.query(
    `SELECT id, twitter_username, twitter_display_name, twitter_profile_image_url
     FROM twitter_auth
     WHERE user_id = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC`,
    [userId]
  );

  return rows
    .map((row) => mapTwitterTarget(row, 'personal'))
    .filter((row) => row.id && row.id !== String(excludeAccountId || ''));
};

const fetchLinkedInTargets = async ({ userId, teamId = null }) => {
  const linkedinGenieUrl = String(process.env.LINKEDIN_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!linkedinGenieUrl || !internalApiKey) return [];

  const endpoint = `${linkedinGenieUrl.replace(/\/$/, '')}/api/internal/accounts/targets`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-key': internalApiKey,
      'x-internal-caller': 'tweet-genie',
      'x-platform-user-id': String(userId),
      ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.warn('[Cross-post Targets] LinkedIn target lookup failed', {
      status: response.status,
      code: body?.code || null,
    });
    return [];
  }

  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  return accounts
    .map((row) => mapLinkedInTarget(row, teamId ? 'team' : 'personal'))
    .filter((row) => row.id);
};

const fetchThreadsTargets = async ({ userId, teamId = null }) => {
  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!socialGenieUrl || !internalApiKey) return [];

  const endpoint = `${socialGenieUrl.replace(/\/$/, '')}/api/internal/threads/targets`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-key': internalApiKey,
      'x-internal-caller': 'tweet-genie',
      'x-platform-user-id': String(userId),
      ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.warn('[Cross-post Targets] Threads target lookup failed', {
      status: response.status,
      code: body?.code || null,
    });
    return [];
  }

  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  return accounts
    .map((row) => mapThreadsTarget(row, teamId ? 'team' : 'personal'))
    .filter((row) => row.id);
};

router.get('/targets', async (req, res) => {
  const userId = req.user?.id || req.user?.userId || null;
  const teamId = String(req.headers['x-team-id'] || '').trim() || null;
  const excludeAccountId = String(req.query?.excludeAccountId || '').trim() || null;
  const excludePlatform = String(req.query?.excludePlatform || '').trim().toLowerCase() || null;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [twitterTargets, linkedinTargets, threadsTargets] = await Promise.all([
      listTwitterTargets({ userId, teamId, excludeAccountId }),
      fetchLinkedInTargets({ userId, teamId }),
      fetchThreadsTargets({ userId, teamId }),
    ]);

    const targets = {
      twitter: twitterTargets,
      linkedin: linkedinTargets,
      threads: threadsTargets,
    };
    if (excludeAccountId && excludePlatform && Array.isArray(targets[excludePlatform])) {
      targets[excludePlatform] = targets[excludePlatform].filter(
        (target) => String(target?.id || '') !== String(excludeAccountId)
      );
    }

    return res.json({
      success: true,
      targets,
    });
  } catch (error) {
    logger.error('[Cross-post Targets] Failed to fetch unified targets', {
      userId,
      teamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({ error: 'Failed to fetch cross-post targets' });
  }
});

router.get('/targets/linkedin', async (req, res) => {
  const userId = req.user?.id || req.user?.userId || null;
  const teamId = String(req.headers['x-team-id'] || '').trim() || null;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Personal scope does not need team target routing.
  if (!teamId) {
    return res.json({ success: true, targets: [], scope: 'personal' });
  }

  const linkedinGenieUrl = String(process.env.LINKEDIN_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!linkedinGenieUrl || !internalApiKey) {
    logger.warn('[Cross-post Targets] LinkedIn target lookup skipped: internal config missing', {
      hasLinkedinGenieUrl: Boolean(linkedinGenieUrl),
      hasInternalApiKey: Boolean(internalApiKey),
    });
    return res.json({ success: true, targets: [], reason: 'not_configured' });
  }

  try {
    const response = await fetch(
      `${linkedinGenieUrl.replace(/\/$/, '')}/api/internal/team-accounts/eligible-crosspost-targets`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': internalApiKey,
          'x-internal-caller': 'tweet-genie',
          'x-platform-user-id': String(userId),
          'x-platform-team-id': String(teamId),
        },
      }
    );

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const code = String(body?.code || '').trim();
      const status = Number(response.status || 500);
      if (status === 403 && code === 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN') {
        return res.status(403).json({
          error: body?.error || 'Not allowed to view LinkedIn team cross-post targets for this team.',
          code,
        });
      }

      logger.warn('[Cross-post Targets] LinkedIn internal target lookup failed', {
        status,
        code,
      });
      return res.status(502).json({
        error: body?.error || 'Failed to fetch LinkedIn cross-post targets',
        code: code || 'LINKEDIN_TARGET_LOOKUP_FAILED',
      });
    }

    const targets = Array.isArray(body?.targets) ? body.targets.map(normalizeTarget).filter((t) => t.id) : [];
    return res.json({
      success: true,
      requesterRole: typeof body?.requesterRole === 'string' ? body.requesterRole : null,
      targets,
    });
  } catch (error) {
    logger.error('[Cross-post Targets] LinkedIn target lookup error', {
      userId,
      teamId,
      error: error?.message || String(error),
    });
    return res.status(502).json({ error: 'Failed to fetch LinkedIn cross-post targets' });
  }
});

export default router;
