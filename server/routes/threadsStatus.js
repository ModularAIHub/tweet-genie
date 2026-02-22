import express from 'express';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

const router = express.Router();
const THREADS_STATUS_TIMEOUT_MS = Number.parseInt(process.env.THREADS_STATUS_TIMEOUT_MS || '5000', 10);

router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;

  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized' });
  }

  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    return res.json({
      connected: false,
      reason: 'not_configured',
    });
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
      return res.json({
        connected: false,
        reason: response.status === 404 ? 'not_connected' : 'service_unreachable',
      });
    }

    return res.json({
      connected: body?.connected === true,
      reason: body?.connected === true ? null : (body?.reason || 'not_connected'),
      account: body?.account || null,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.json({ connected: false, reason: 'timeout' });
    }

    logger.error('[threads/status] Proxy error', {
      error: error?.message || String(error),
    });
    return res.json({ connected: false, reason: 'service_unreachable' });
  }
});

export default router;

