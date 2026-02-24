import express from 'express';
import fetch from 'node-fetch';
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
