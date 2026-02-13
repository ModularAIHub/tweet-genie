import express from 'express';
import Honeybadger from '@honeybadger-io/js';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
// import cron from 'node-cron';

// Route imports
import authRoutes from './routes/auth.js';
import secureAuthRoutes from './routes/secure-auth.js';
import ssoRoutes from './routes/sso.js';
import twitterRoutes from './routes/twitter.js';
import tweetsRoutes from './routes/tweets.js';
import schedulingRoutes from './routes/scheduling.js';
import analyticsRoutes from './routes/analytics.js';
import dashboardRoutes from './routes/dashboard.js';
import creditsRoutes from './routes/credits.js';
import providersRoutes from './routes/providers.js';
import aiRoutes from './routes/ai.js';
import imageGenerationRoutes from './routes/imageGeneration.js';
import teamRoutes from './routes/team.js';
import approvalRoutes from './routes/approval.js';
import cleanupRoutes from './routes/cleanup.js';

// Middleware imports
import { authenticateToken, getAuthPerfStats, resetAuthPerfStats } from './middleware/auth.js';
// import { errorHandler } from './middleware/errorHandler.js';

// Service imports
import { scheduledTweetService } from './services/scheduledTweetService.js';
import { getScheduledQueueHealth, isScheduledQueueAvailable } from './services/queueService.js';
import { startScheduledTweetWorker } from './workers/scheduledTweetWorker.js';
import { runStartupScheduledTweetSync } from './workers/startupScheduledTweetSync.js';
import { getAnalyticsAutoSyncStatus, startAnalyticsAutoSyncWorker } from './workers/analyticsSyncWorker.js';

dotenv.config();

// Honeybadger configuration
Honeybadger.configure({
  apiKey: 'hbp_A8vjKimYh8OnyV8J3djwKrpqc4OniI3a4MJg', // Replace with your real key
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
const SCHEDULED_DB_POLLER_ENABLED = process.env.SCHEDULED_DB_POLLER_ENABLED !== 'false';
const SCHEDULED_DB_POLLER_INTERVAL_MS = Number.parseInt(process.env.SCHEDULED_DB_POLLER_INTERVAL_MS || '30000', 10);

let scheduledDbPoller = null;
let scheduledDbPollerInFlight = false;

const requestLog = (...args) => {
  if (REQUEST_DEBUG) {
    console.log(...args);
  }
};

const corsLog = (...args) => {
  if (CORS_DEBUG) {
    console.log(...args);
  }
};

const corsWarn = (...args) => {
  if (CORS_DEBUG) {
    console.warn(...args);
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

// CSRF token endpoint (for frontend compatibility)
app.get('/api/csrf-token', (req, res) => {
  try {
    res.json({
      csrfToken: 'dummy-csrf-token',
      message: 'CSRF protection not implemented in Tweet Genie',
    });
  } catch (error) {
    console.error('CSRF token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/credits', authenticateToken, creditsRoutes);
app.use('/api/providers', authenticateToken, providersRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/image-generation', authenticateToken, imageGenerationRoutes);
app.use('/imageGeneration', authenticateToken, imageGenerationRoutes);
app.use('/api/team', authenticateToken, teamRoutes);
app.use('/api/approval', authenticateToken, approvalRoutes);
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

function startScheduledDbPoller(reason = 'queue_unavailable') {
  if (!SCHEDULED_DB_POLLER_ENABLED) {
    console.warn('[Startup] DB poller fallback is disabled (SCHEDULED_DB_POLLER_ENABLED=false).');
    return;
  }

  if (scheduledDbPoller) {
    return;
  }

  const intervalMs =
    Number.isFinite(SCHEDULED_DB_POLLER_INTERVAL_MS) && SCHEDULED_DB_POLLER_INTERVAL_MS >= 5000
      ? SCHEDULED_DB_POLLER_INTERVAL_MS
      : 30000;

  console.warn(
    `[Startup] Using DB poller fallback for scheduled tweets (every ${intervalMs}ms). Reason: ${reason}`
  );

  scheduledDbPoller = setInterval(async () => {
    if (isScheduledQueueAvailable()) {
      console.log('[ScheduledPoller] Queue is available again. Stopping DB poller fallback.');
      clearInterval(scheduledDbPoller);
      scheduledDbPoller = null;
      return;
    }

    if (scheduledDbPollerInFlight) {
      return;
    }

    scheduledDbPollerInFlight = true;
    try {
      await scheduledTweetService.processScheduledTweets();
    } catch (error) {
      console.error('[ScheduledPoller] Error processing scheduled tweets:', error?.message || error);
    } finally {
      scheduledDbPollerInFlight = false;
    }
  }, intervalMs);

  if (typeof scheduledDbPoller.unref === 'function') {
    scheduledDbPoller.unref();
  }
}

// Honeybadger error handler (must be after all routes/middleware)
app.use(Honeybadger.errorHandler);

app.listen(PORT, async () => {
  console.log(`Tweet Genie server running on port ${PORT}`);

  const queueHealth = getScheduledQueueHealth();
  console.log('[Startup] Scheduled queue health:', queueHealth);
  startAnalyticsAutoSyncWorker();
  console.log('[Startup] Analytics auto sync status:', getAnalyticsAutoSyncStatus());

  try {
    await startScheduledTweetWorker();

    if (isScheduledQueueAvailable()) {
      await runStartupScheduledTweetSync();
    } else {
      const degradedQueueHealth = getScheduledQueueHealth();
      startScheduledDbPoller(degradedQueueHealth.reason || queueHealth.reason || 'queue_not_ready');
    }
  } catch (error) {
    console.error('[Startup] Scheduler initialization error:', error?.message || error);
    startScheduledDbPoller('worker_init_failed');
  }
});
