import express from 'express';
import fetch from 'node-fetch';
import pool from '../config/database.js';
import { logger } from '../utils/logger.js';
import { listLatestPersonalTwitterAuth } from '../utils/personalTwitterAuth.js';
import { listTwitterConnectedAccounts } from '../utils/twitterConnectedAccountRegistry.js';

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
    id:
      row?.source_id !== undefined && row?.source_id !== null
        ? String(row.source_id)
        : row?.id !== undefined && row?.id !== null
          ? String(row.id)
          : null,
    platform: 'twitter',
    username: username || null,
    displayName,
    avatar: row?.twitter_profile_image_url || null,
    scope,
  };
};

const isSameTwitterAccount = (row = {}, accountId = null) => {
  const normalizedAccountId = String(accountId || '').trim();
  if (!normalizedAccountId) return false;
  return (
    String(row?.source_id || '').trim() === normalizedAccountId ||
    String(row?.id || '').trim() === normalizedAccountId ||
    String(row?.twitter_user_id || '').trim() === normalizedAccountId
  );
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

const resolveEffectiveTeamScope = async ({ userId, requestedTeamId = null, sourceAccountId = null }) => {
  const teamId = String(requestedTeamId || '').trim();
  const accountId = String(sourceAccountId || '').trim();
  if (!teamId) return null;

  try {
    const membershipResult = await pool.query(
      `SELECT 1
       FROM team_members
       WHERE user_id = $1
         AND team_id::text = $2::text
         AND status = 'active'
       LIMIT 1`,
      [userId, teamId]
    );
    if (membershipResult.rows.length === 0) {
      return null;
    }

    if (!accountId) {
      return teamId;
    }

    const personalMatch = await pool.query(
      `SELECT 1
       FROM twitter_auth
       WHERE user_id = $2
         AND (
           id::text = $1::text
           OR twitter_user_id::text = $1::text
         )
       LIMIT 1`,
      [accountId, userId]
    );
    if (personalMatch.rows.length > 0) {
      return null;
    }

    const teamMatch = await pool.query(
      `SELECT 1
       FROM team_accounts ta
       INNER JOIN team_members tm
         ON tm.team_id = ta.team_id
       AND tm.user_id = $1
       AND tm.status = 'active'
       WHERE ta.team_id::text = $3::text
         AND (
           ta.id::text = $2::text
           OR ta.twitter_user_id::text = $2::text
         )
         AND ta.active = true
       LIMIT 1`,
      [userId, accountId, teamId]
    );
    if (teamMatch.rows.length > 0) {
      return teamId;
    }
  } catch (error) {
    logger.warn('[Cross-post Targets] Failed to resolve effective scope from source account', {
      userId,
      requestedTeamId: teamId,
      sourceAccountId: accountId,
      error: error?.message || String(error),
    });
  }

  return null;
};

const listLocalLinkedInTargets = async ({ userId, teamId = null }) => {
  const normalizedTeamId = String(teamId || '').trim() || null;
  const scope = normalizedTeamId ? 'team' : 'personal';

  try {
    const socialResult = await pool.query(
      normalizedTeamId
        ? `SELECT id, account_username, account_display_name, profile_image_url
           FROM social_connected_accounts
           WHERE team_id::text = $1::text
             AND platform = 'linkedin'
             AND is_active = true
           ORDER BY account_display_name ASC NULLS LAST, id DESC`
        : `SELECT id, account_username, account_display_name, profile_image_url
           FROM social_connected_accounts
           WHERE user_id = $1
             AND team_id IS NULL
             AND platform = 'linkedin'
             AND is_active = true
           ORDER BY account_display_name ASC NULLS LAST, id DESC`,
      [normalizedTeamId || userId]
    );

    if (socialResult.rows.length > 0) {
      return socialResult.rows
        .map((row) =>
          mapLinkedInTarget(
            {
              id: row.id,
              username: row.account_username,
              displayName: row.account_display_name,
              avatar: row.profile_image_url,
            },
            scope
          )
        )
        .filter((row) => row.id);
    }
  } catch (error) {
    logger.warn('[Cross-post Targets] Local social_connected_accounts lookup failed for LinkedIn', {
      userId,
      teamId: normalizedTeamId,
      error: error?.message || String(error),
    });
  }

  if (normalizedTeamId) {
    return [];
  }

  try {
    const authResult = await pool.query(
      `SELECT id, linkedin_user_id, linkedin_username, linkedin_display_name, linkedin_profile_image_url
       FROM linkedin_auth
       WHERE user_id = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC`,
      [userId]
    );

    return authResult.rows
      .map((row) =>
        mapLinkedInTarget(
          {
            id: row.id,
            username: row.linkedin_username || row.linkedin_user_id,
            displayName: row.linkedin_display_name || row.linkedin_username,
            avatar: row.linkedin_profile_image_url,
          },
          'personal'
        )
      )
      .filter((row) => row.id);
  } catch (error) {
    logger.warn('[Cross-post Targets] Local linkedin_auth lookup failed', {
      userId,
      error: error?.message || String(error),
    });
    return [];
  }
};

const listLocalThreadsTargets = async ({ userId, teamId = null }) => {
  const normalizedTeamId = String(teamId || '').trim() || null;
  const scope = normalizedTeamId ? 'team' : 'personal';

  try {
    const { rows } = await pool.query(
      normalizedTeamId
        ? `SELECT id, account_username, account_display_name, profile_image_url
           FROM social_connected_accounts
           WHERE team_id::text = $1::text
             AND platform = 'threads'
             AND is_active = true
           ORDER BY account_display_name ASC NULLS LAST, id DESC`
        : `SELECT id, account_username, account_display_name, profile_image_url
           FROM social_connected_accounts
           WHERE user_id = $1
             AND team_id IS NULL
             AND platform = 'threads'
             AND is_active = true
           ORDER BY account_display_name ASC NULLS LAST, id DESC`,
      [normalizedTeamId || userId]
    );

    return rows
      .map((row) => mapThreadsTarget(row, scope))
      .filter((row) => row.id);
  } catch (error) {
    logger.warn('[Cross-post Targets] Local social_connected_accounts lookup failed for Threads', {
      userId,
      teamId: normalizedTeamId,
      error: error?.message || String(error),
    });
    return [];
  }
};

const listTwitterTargets = async ({ userId, teamId = null, excludeAccountId = null }) => {
  try {
    const registryRows = await listTwitterConnectedAccounts(pool, { userId, teamId });
    if (registryRows.length > 0) {
      return registryRows
        .filter((row) => !isSameTwitterAccount(row, excludeAccountId))
        .map((row) => mapTwitterTarget(row, teamId ? 'team' : 'personal'))
        .filter((row) => row.id);
    }
  } catch (error) {
    logger.warn('[Cross-post Targets] Local social_connected_accounts lookup failed for Twitter', {
      userId,
      teamId,
      error: error?.message || String(error),
    });
  }

  if (teamId) {
    const { rows } = await pool.query(
      `SELECT ta.id, ta.twitter_user_id, ta.twitter_username, ta.twitter_display_name, ta.twitter_profile_image_url
       FROM team_accounts ta
       INNER JOIN team_members tm
         ON tm.team_id = ta.team_id
        AND tm.user_id = $1
        AND tm.status = 'active'
       WHERE ta.team_id::text = $2::text
         AND ta.active = true
       ORDER BY
         CASE WHEN ta.user_id = $1 THEN 0 ELSE 1 END,
         ta.updated_at DESC NULLS LAST,
         ta.id DESC`,
      [userId, String(teamId)]
    );

    return rows
      .filter((row) => !isSameTwitterAccount(row, excludeAccountId))
      .map((row) => mapTwitterTarget(row, 'team'))
      .filter((row) => row.id);
  }

  const rows = await listLatestPersonalTwitterAuth(pool, userId, {
    columns: 'id, twitter_user_id, twitter_username, twitter_display_name, twitter_profile_image_url',
  });

  return rows
    .filter((row) => !isSameTwitterAccount(row, excludeAccountId))
    .map((row) => mapTwitterTarget(row, 'personal'))
    .filter((row) => row.id);
};

const fetchLinkedInTargets = async ({ userId, teamId = null }) => {
  const linkedinGenieUrl = String(process.env.LINKEDIN_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!linkedinGenieUrl || !internalApiKey) {
    return listLocalLinkedInTargets({ userId, teamId });
  }

  const endpoint = `${linkedinGenieUrl.replace(/\/$/, '')}/api/internal/accounts/targets`;

  try {
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
      logger.warn('[Cross-post Targets] LinkedIn target lookup failed; falling back to local lookup', {
        status: response.status,
        code: body?.code || null,
      });
      return listLocalLinkedInTargets({ userId, teamId });
    }

    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    const normalized = accounts
      .map((row) => mapLinkedInTarget(row, teamId ? 'team' : 'personal'))
      .filter((row) => row.id);

    if (normalized.length > 0) {
      return normalized;
    }

    return listLocalLinkedInTargets({ userId, teamId });
  } catch (error) {
    logger.warn('[Cross-post Targets] LinkedIn target lookup errored; falling back to local lookup', {
      userId,
      teamId,
      error: error?.message || String(error),
    });
    return listLocalLinkedInTargets({ userId, teamId });
  }
};

const fetchThreadsTargets = async ({ userId, teamId = null }) => {
  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!socialGenieUrl || !internalApiKey) {
    return listLocalThreadsTargets({ userId, teamId });
  }

  const endpoint = `${socialGenieUrl.replace(/\/$/, '')}/api/internal/threads/targets`;

  try {
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
      logger.warn('[Cross-post Targets] Threads target lookup failed; falling back to local lookup', {
        status: response.status,
        code: body?.code || null,
      });
      return listLocalThreadsTargets({ userId, teamId });
    }

    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    const normalized = accounts
      .map((row) => mapThreadsTarget(row, teamId ? 'team' : 'personal'))
      .filter((row) => row.id);

    if (normalized.length > 0) {
      return normalized;
    }

    return listLocalThreadsTargets({ userId, teamId });
  } catch (error) {
    logger.warn('[Cross-post Targets] Threads target lookup errored; falling back to local lookup', {
      userId,
      teamId,
      error: error?.message || String(error),
    });
    return listLocalThreadsTargets({ userId, teamId });
  }
};

router.get('/targets', async (req, res) => {
  const userId = req.user?.id || req.user?.userId || null;
  const requestedTeamId = String(req.headers['x-team-id'] || '').trim() || null;
  const excludeAccountId = String(req.query?.excludeAccountId || '').trim() || null;
  const excludePlatform = String(req.query?.excludePlatform || '').trim().toLowerCase() || null;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const effectiveTeamId = await resolveEffectiveTeamScope({
      userId,
      requestedTeamId,
      sourceAccountId: excludeAccountId,
    });

    const [twitterTargets, initialLinkedinTargets, initialThreadsTargets] = await Promise.all([
      listTwitterTargets({ userId, teamId: effectiveTeamId, excludeAccountId }),
      fetchLinkedInTargets({ userId, teamId: effectiveTeamId }),
      fetchThreadsTargets({ userId, teamId: effectiveTeamId }),
    ]);

    const targets = {
      twitter: twitterTargets,
      linkedin: initialLinkedinTargets,
      threads: initialThreadsTargets,
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
      teamId: requestedTeamId,
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
