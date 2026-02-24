import express from 'express';
import Honeybadger from '@honeybadger-io/js';
import cors from 'cors';
import helmet from 'helmet';
import fetch from 'node-fetch';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
// import cron from 'node-cron';
import { logger } from './utils/logger.js';

// Route imports
import authRoutes from './routes/auth.js';
import secureAuthRoutes from './routes/secure-auth.js';
import ssoRoutes from './routes/sso.js';
import twitterRoutes from './routes/twitter.js';
import tweetsRoutes from './routes/tweets.js';
import schedulingRoutes from './routes/scheduling.js';
import linkedinStatusRoutes from './routes/linkedinStatus.js';
import threadsStatusRoutes from './routes/threadsStatus.js';
import crossPostTargetsRoutes from './routes/crossPostTargets.js';
import internalTwitterRoutes from './routes/internalTwitter.js';
import analyticsRoutes from './routes/analytics.js';
import dashboardRoutes from './routes/dashboard.js';
import creditsRoutes from './routes/credits.js';
import providersRoutes from './routes/providers.js';
import aiRoutes from './routes/ai.js';
import imageGenerationRoutes from './routes/imageGeneration.js';
import teamRoutes from './routes/team.js';
import approvalRoutes from './routes/approval.js';
import cleanupRoutes from './routes/cleanup.js';
import strategyBuilderRoutes from './routes/strategyBuilder.js';
import strategyAnalyticsRoutes from './routes/strategy-analytics.js';
import autopilotRoutes from './routes/autopilot.js';

// Middleware imports
import {
  authenticateToken,
  getAuthPerfStats,
  resetAuthPerfStats,
  validateTwitterConnection,
} from './middleware/auth.js';
// import { errorHandler } from './middleware/errorHandler.js';

// Service imports
import { getDbScheduledTweetWorkerStatus, startDbScheduledTweetWorker } from './workers/dbScheduledTweetWorker.js';
import { getAnalyticsAutoSyncStatus, startAnalyticsAutoSyncWorker } from './workers/analyticsSyncWorker.js';
import { startAutopilotWorker, getAutopilotWorkerStatus } from './workers/autopilotWorker.js';
import {
  getDeletedTweetRetentionWorkerStatus,
  startDeletedTweetRetentionWorker,
} from './workers/deletedTweetRetentionWorker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, './.env') });

// Honeybadger configuration
Honeybadger.configure({
  apiKey: process.env.HONEYBADGER_API_KEY || process.env.HONEYBADGER_KEY || '',
  environment: process.env.NODE_ENV || 'development',
});

import proTeamRoutes from './routes/proTeam.js';
const app = express();

// Honeybadger request handler (must be first middleware)
app.use(Honeybadger.requestHandler);
const PORT = process.env.PORT || 3002;
const REQUEST_DEBUG = process.env.REQUEST_DEBUG === 'true';
const CORS_DEBUG = process.env.CORS_DEBUG === 'true';
const AUTH_PERF_ROUTE_ENABLED =
  process.env.AUTH_PERF_ROUTE_ENABLED === 'true' ||
  (process.env.AUTH_PERF_ROUTE_ENABLED !== 'false' && process.env.NODE_ENV !== 'production');

const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const BACKGROUND_WORKERS_ENABLED = parseBooleanEnv(process.env.BACKGROUND_WORKERS_ENABLED, true);
const START_ANALYTICS_WORKER = BACKGROUND_WORKERS_ENABLED && parseBooleanEnv(process.env.START_ANALYTICS_WORKER, true);
const START_AUTOPILOT_WORKER = BACKGROUND_WORKERS_ENABLED && parseBooleanEnv(process.env.START_AUTOPILOT_WORKER, false);
const START_DB_SCHEDULER_WORKER =
  BACKGROUND_WORKERS_ENABLED && parseBooleanEnv(process.env.START_DB_SCHEDULER_WORKER, true);
const START_DELETED_TWEET_RETENTION_WORKER =
  BACKGROUND_WORKERS_ENABLED && parseBooleanEnv(process.env.START_DELETED_TWEET_RETENTION_WORKER, true);

const requestLog = (...args) => {
  if (REQUEST_DEBUG) {
    logger.debug(...args);
  }
};

const corsLog = (...args) => {
  if (CORS_DEBUG) {
    logger.debug(...args);
  }
};

const corsWarn = (...args) => {
  if (CORS_DEBUG) {
    logger.warn(...args);
  }
};

// Basic middleware with CSP configuration for development
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'http://localhost:*', 'https://api.twitter.com', 'https://upload.twitter.com'],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        fontSrc: ["'self'", 'https:', 'data:'],
      },
    },
  })
);

// --- CORS: must be first middleware! ---
const allowedOrigins = [
  'https://suitegenie.in',
  'https://tweet.suitegenie.in',
  'https://api.suitegenie.in',
  'https://tweetapi.suitegenie.in',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return (
      allowedOrigins.includes(origin) ||
      hostname === 'suitegenie.in' ||
      hostname.endsWith('.suitegenie.in') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  corsLog('[cors] request origin:', origin);

  if (isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Cookie, X-CSRF-Token, X-Selected-Account-Id, X-Team-Id'
    );
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    corsLog('[cors] headers set for:', origin);
  } else {
    corsWarn('[cors] origin not allowed:', origin);
  }

  if (req.method === 'OPTIONS') {
    corsLog('[cors] preflight handled');
    return res.sendStatus(200);
  }
  next();
});

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Tweet Genie' });
});

// Auth middleware performance debug endpoint
app.get('/api/perf/auth-stats', authenticateToken, (req, res) => {
  if (!AUTH_PERF_ROUTE_ENABLED) {
    return res.status(404).json({ error: 'Not found' });
  }

  const shouldReset = String(req.query.reset || '').toLowerCase() === 'true';
  if (shouldReset) {
    resetAuthPerfStats();
  }

  return res.json({
    success: true,
    reset: shouldReset,
    stats: getAuthPerfStats(),
  });
});

app.get('/api/perf/scheduler-stats', authenticateToken, (req, res) => {
  if (!AUTH_PERF_ROUTE_ENABLED) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.json({
    success: true,
    scheduler: getDbScheduledTweetWorkerStatus(),
  });
});

// CSRF token endpoint (for frontend compatibility)
app.get('/api/csrf-token', (req, res) => {
  try {
    res.json({
      csrfToken: 'dummy-csrf-token',
      message: 'CSRF protection not implemented in Tweet Genie',
    });
  } catch (error) {
    logger.error('CSRF token error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Internal debug endpoint: report presence of important env vars (no secrets returned)
app.get('/internal/debug/env', (req, res) => {
  try {
    const linkedinGenieUrlPresent = !!process.env.LINKEDIN_GENIE_URL;
    const internalApiKeyPresent = !!process.env.INTERNAL_API_KEY;

    return res.json({
      success: true,
      linkedinGenieUrlPresent,
      internalApiKeyPresent,
    });
  } catch (err) {
    logger.error('Internal debug env error', { error: err?.message || String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Internal service routes (header-authenticated inside route)
app.use('/api/internal/twitter', internalTwitterRoutes);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', secureAuthRoutes);
app.use('/', ssoRoutes); // SSO routes at root level

// Twitter routes with conditional authentication
app.use(
  '/api/twitter',
  (req, res, next) => {
    // Public OAuth endpoints that don't need authentication
    const publicEndpoints = [
      '/team-connect',
      '/team-connect-oauth1',
      '/callback',
      '/connect',
      '/connect-oauth1',
      '/test-team-accounts',
    ];

    // Check if this is a public endpoint
    const isPublicEndpoint = publicEndpoints.some((endpoint) => req.path === endpoint);

    if (isPublicEndpoint) {
      // Skip authentication for public OAuth endpoints
      requestLog(`[router] public endpoint: ${req.path}`);
      next();
    } else {
      // Apply authentication for all other endpoints
      requestLog(`[router] protected endpoint: ${req.path}`);
      authenticateToken(req, res, next);
    }
  },
  twitterRoutes
);
app.use('/api/pro-team', proTeamRoutes); // <-- Register proTeam routes here
app.use('/api/tweets', authenticateToken, tweetsRoutes);
app.use('/api/scheduling', authenticateToken, schedulingRoutes);
app.use('/api/linkedin', authenticateToken, linkedinStatusRoutes);
app.use('/api/threads', authenticateToken, threadsStatusRoutes);
app.use('/api/cross-post', authenticateToken, crossPostTargetsRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/credits', authenticateToken, creditsRoutes);
app.use('/api/providers', authenticateToken, providersRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/image-generation', authenticateToken, imageGenerationRoutes);
app.use('/imageGeneration', authenticateToken, imageGenerationRoutes);
app.use('/api/team', authenticateToken, teamRoutes);
app.use('/api/approval', authenticateToken, approvalRoutes);
// Strategy Builder should be accessible even when Twitter team-account context is not resolved yet.
app.use('/api/strategy', authenticateToken, strategyBuilderRoutes);
app.use(
  '/api/strategy-analytics',
  authenticateToken,
  validateTwitterConnection,
  strategyAnalyticsRoutes
);
app.use('/api/autopilot', authenticateToken, validateTwitterConnection, autopilotRoutes);
app.use('/api/cleanup', cleanupRoutes); // Cleanup routes (unprotected for internal service calls)

// Global error handler to always set CORS headers, even for body parser errors (e.g., 413)
app.use((err, req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-CSRF-Token, X-Selected-Account-Id');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  // Handle body too large error
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request entity too large', details: err.message });
  }
  // Default to 500
  return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Honeybadger error handler (must be after all routes/middleware)
app.use(Honeybadger.errorHandler);

app.listen(PORT, async () => {
  logger.info(`Tweet Genie server running on port ${PORT}`);
  // Diagnostic: check configured LinkedIn Genie URL to detect frontend misconfiguration
  try {
    const linkedinBase = process.env.LINKEDIN_GENIE_URL;
    if (linkedinBase) {
      const checkUrl = `${linkedinBase.replace(/\/$/, '')}/api/linkedin/status`;
      const controller = new AbortController();
      const timeoutMs = 3000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(checkUrl, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!resp) {
          logger.warn('LinkedIn status check failed (no response)', { url: checkUrl });
        } else {
          const ct = resp.headers.get('content-type') || '';
          const looksLikeHtml = ct.includes('text/html') || ct.includes('application/xhtml+xml');

          if (looksLikeHtml) {
            logger.warn('LINKEDIN_GENIE_URL appears to be pointing at a frontend (HTML) rather than the API', { url: checkUrl, contentType: ct });
          } else {
            logger.info('LinkedIn Genie status endpoint reachable', { url: checkUrl, contentType: ct });
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          logger.warn('LinkedIn status check timed out', { url: checkUrl, timeoutMs });
        } else {
          logger.warn('Error while checking LINKEDIN_GENIE_URL', { error: err?.message || String(err) });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      logger.warn('LINKEDIN_GENIE_URL not configured');
    }
  } catch (err) {
    logger.warn('Error while checking LINKEDIN_GENIE_URL', { error: err?.message || err });
  }
  if (!BACKGROUND_WORKERS_ENABLED) {
    logger.info('Background workers disabled by BACKGROUND_WORKERS_ENABLED=false');
    return;
  }

  if (START_ANALYTICS_WORKER) {
    startAnalyticsAutoSyncWorker();
    const analyticsStatus = getAnalyticsAutoSyncStatus();
    logger.info('Analytics auto sync worker started', {
      enabled: !!analyticsStatus.enabled,
      running: !!analyticsStatus.running,
      intervalMs: analyticsStatus.intervalMs
    });
  } else {
    logger.info('Analytics auto sync worker disabled.');
  }

  if (START_AUTOPILOT_WORKER) {
    startAutopilotWorker();
    const autopilotStatus = getAutopilotWorkerStatus();
    logger.info('Autopilot worker started', { enabled: !!autopilotStatus });
  } else {
    logger.info('Autopilot worker disabled.');
  }

  if (START_DB_SCHEDULER_WORKER) {
    try {
      await startDbScheduledTweetWorker();
      const dbStatus = getDbScheduledTweetWorkerStatus();
      logger.info('DB scheduled tweet worker started', {
        enabled: !!dbStatus.enabled,
        started: !!dbStatus.started,
        batchSize: dbStatus.batchSize,
        pollIntervalMs: dbStatus.pollIntervalMs
      });
    } catch (error) {
      logger.error('DB scheduler initialization error', { error: error?.message || error });
    }
  } else {
    logger.info('DB scheduled tweet worker disabled.');
  }

  if (START_DELETED_TWEET_RETENTION_WORKER) {
    try {
      startDeletedTweetRetentionWorker();
      const delStatus = getDeletedTweetRetentionWorkerStatus();
      logger.info('Deleted tweet retention worker started', {
        enabled: !!delStatus.enabled,
        retentionDays: delStatus.days || delStatus.retentionDays || null,
        intervalMs: delStatus.intervalMs
      });
    } catch (error) {
      logger.error('Deleted tweet retention worker initialization error', { error: error?.message || error });
    }
  } else {
    logger.info('Deleted tweet retention worker disabled.');
  }
});
