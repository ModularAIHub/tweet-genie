import {
  DELETED_TWEET_RETENTION_DAYS,
  ensureTweetDeletionRetentionSchema,
  purgeExpiredDeletedTweets,
} from '../services/tweetRetentionService.js';

const WORKER_ENABLED = process.env.DELETED_TWEET_RETENTION_WORKER_ENABLED !== 'false';
const WORKER_INTERVAL_MS = Number.parseInt(
  process.env.DELETED_TWEET_RETENTION_WORKER_INTERVAL_MS || String(6 * 60 * 60 * 1000),
  10
);
const WORKER_INITIAL_DELAY_MS = Number.parseInt(
  process.env.DELETED_TWEET_RETENTION_WORKER_INITIAL_DELAY_MS || '45000',
  10
);
const WORKER_DEBUG = process.env.DELETED_TWEET_RETENTION_DEBUG === 'true';

let workerInterval = null;
let workerBootTimer = null;
let workerInFlight = false;
let workerStartedAt = null;
let workerLastRun = {
  startedAt: null,
  finishedAt: null,
  deletedCount: 0,
  error: null,
};

const workerLog = (...args) => {
  if (WORKER_DEBUG) {
    console.log('[DeletedTweetRetentionWorker]', ...args);
  }
};

const toIso = (value) => {
  if (!value) return null;
  return new Date(value).toISOString();
};

async function runRetentionCleanupTick() {
  if (workerInFlight) return;
  workerInFlight = true;

  const startedAt = Date.now();
  workerLastRun = {
    startedAt,
    finishedAt: null,
    deletedCount: 0,
    error: null,
  };

  try {
    await ensureTweetDeletionRetentionSchema();
    const result = await purgeExpiredDeletedTweets();
    workerLastRun.deletedCount = result.deletedCount || 0;
    workerLog('Cleanup tick completed', { deletedCount: workerLastRun.deletedCount });
  } catch (error) {
    workerLastRun.error = error?.message || String(error);
    console.error('[DeletedTweetRetentionWorker] Tick failed:', workerLastRun.error);
  } finally {
    workerLastRun.finishedAt = Date.now();
    workerInFlight = false;
  }
}

export function startDeletedTweetRetentionWorker(options = {}) {
  if (workerInterval || workerBootTimer) {
    return { started: true };
  }

  const enabled = options.enabled !== undefined ? Boolean(options.enabled) : WORKER_ENABLED;
  if (!enabled) {
    console.log('[DeletedTweetRetentionWorker] Disabled by configuration.');
    return { started: false };
  }

  workerStartedAt = Date.now();
  console.log('[DeletedTweetRetentionWorker] Started', {
    retentionDays: DELETED_TWEET_RETENTION_DAYS,
    intervalMs: WORKER_INTERVAL_MS,
    initialDelayMs: WORKER_INITIAL_DELAY_MS,
  });

  workerBootTimer = setTimeout(() => {
    workerBootTimer = null;
    runRetentionCleanupTick().catch((error) => {
      console.error('[DeletedTweetRetentionWorker] Initial tick error:', error?.message || error);
    });

    workerInterval = setInterval(() => {
      runRetentionCleanupTick().catch((error) => {
        console.error('[DeletedTweetRetentionWorker] Interval tick error:', error?.message || error);
      });
    }, WORKER_INTERVAL_MS);

    if (typeof workerInterval.unref === 'function') {
      workerInterval.unref();
    }
  }, Math.max(0, WORKER_INITIAL_DELAY_MS));

  if (typeof workerBootTimer.unref === 'function') {
    workerBootTimer.unref();
  }

  return { started: true };
}

export function stopDeletedTweetRetentionWorker() {
  if (workerBootTimer) {
    clearTimeout(workerBootTimer);
    workerBootTimer = null;
  }

  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getDeletedTweetRetentionWorkerStatus() {
  return {
    enabled: WORKER_ENABLED,
    running: Boolean(workerBootTimer || workerInterval),
    inFlight: workerInFlight,
    retentionDays: DELETED_TWEET_RETENTION_DAYS,
    intervalMs: WORKER_INTERVAL_MS,
    initialDelayMs: WORKER_INITIAL_DELAY_MS,
    startedAt: toIso(workerStartedAt),
    lastRun: {
      startedAt: toIso(workerLastRun.startedAt),
      finishedAt: toIso(workerLastRun.finishedAt),
      deletedCount: workerLastRun.deletedCount,
      error: workerLastRun.error,
    },
  };
}

