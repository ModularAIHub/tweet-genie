import express from 'express';
import fetch from 'node-fetch';
import pool from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const THREADS_STATUS_TIMEOUT_MS = Number.parseInt(process.env.THREADS_STATUS_TIMEOUT_MS || '5000', 10);

const getLocalThreadsStatus = async ({ userId, teamId = null }) => {
  const normalizedTeamId = String(teamId || '').trim() || null;

  const { rows } = await pool.query(
    normalizedTeamId
      ? `SELECT account_id, account_username, account_display_name, profile_image_url
         FROM social_connected_accounts
         WHERE team_id::text = $1::text
           AND platform = 'threads'
           AND is_active = true
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`
      : `SELECT account_id, account_username, account_display_name, profile_image_url
         FROM social_connected_accounts
         WHERE user_id = $1
           AND team_id IS NULL
           AND platform = 'threads'
           AND is_active = true
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`,
    [normalizedTeamId || userId]
  );

  const account = rows[0] || null;
  if (!account) {
    return { connected: false, reason: 'not_connected', account: null };
  }

  return {
    connected: true,
    reason: null,
    account: {
      account_id: account.account_id || null,
      account_username: account.account_username || null,
      account_display_name: account.account_display_name || null,
      profile_image_url: account.profile_image_url || null,
    },
  };
};

router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const requestTeamId = req.headers['x-team-id'] || req.user?.teamId || req.user?.team_id || null;

  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized' });
  }

  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    try {
      const localStatus = await getLocalThreadsStatus({ userId, teamId: requestTeamId });
      return res.json(localStatus);
    } catch (error) {
      logger.error('[threads/status] Local status fallback failed', {
        error: error?.message || String(error),
      });
      return res.json({ connected: false, reason: 'not_configured' });
    }
  }

  const endpoint = `${socialGenieUrl.replace(/\/$/, '')}/api/internal/threads/status`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), THREADS_STATUS_TIMEOUT_MS);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'tweet-genie',
        'x-platform-user-id': String(userId),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.warn('[threads/status] Social Genie returned non-OK response', {
        status: response.status,
        code: body?.code,
      });
      try {
        const localStatus = await getLocalThreadsStatus({ userId, teamId: requestTeamId });
        return res.json(localStatus);
      } catch {
        return res.json({
          connected: false,
          reason: response.status === 404 ? 'not_connected' : 'service_unreachable',
        });
      }
    }

    return res.json({
      connected: body?.connected === true,
      reason: body?.connected === true ? null : (body?.reason || 'not_connected'),
      account: body?.account || null,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      try {
        const localStatus = await getLocalThreadsStatus({ userId, teamId: requestTeamId });
        return res.json(localStatus);
      } catch {
        return res.json({ connected: false, reason: 'timeout' });
      }
    }

    logger.error('[threads/status] Proxy error', {
      error: error?.message || String(error),
    });
    try {
      const localStatus = await getLocalThreadsStatus({ userId, teamId: requestTeamId });
      return res.json(localStatus);
    } catch {
      return res.json({ connected: false, reason: 'service_unreachable' });
    }
  }
});

export default router;
