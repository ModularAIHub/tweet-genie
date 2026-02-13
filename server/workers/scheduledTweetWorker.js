import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import IORedis from 'ioredis';
import { scheduledTweetService } from '../services/scheduledTweetService.js';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || '';
const WORKER_ENABLED = process.env.SCHEDULED_WORKER_ENABLED !== 'false';
const REDIS_RETRY_LIMIT = Number.parseInt(process.env.REDIS_RETRY_LIMIT || '8', 10);
const WORKER_ERROR_LOG_THROTTLE_MS = Number.parseInt(process.env.WORKER_ERROR_LOG_THROTTLE_MS || '30000', 10);

let scheduledTweetWorker = null;
let workerConnection = null;
let retryStopLogged = false;
let lastErrorLogAt = 0;

function shouldLogError() {
  const now = Date.now();
  if (now - lastErrorLogAt < WORKER_ERROR_LOG_THROTTLE_MS) {
    return false;
  }
  lastErrorLogAt = now;
  return true;
}

export async function startScheduledTweetWorker() {
  if (!WORKER_ENABLED) {
    console.warn('[Worker] Scheduled tweet worker disabled by SCHEDULED_WORKER_ENABLED=false.');
    return null;
  }

  if (!REDIS_URL) {
    console.warn('[Worker] REDIS_URL missing. Scheduled tweet worker not started.');
    return null;
  }

  if (scheduledTweetWorker) {
    return scheduledTweetWorker;
  }

  workerConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > REDIS_RETRY_LIMIT) {
        if (!retryStopLogged) {
          retryStopLogged = true;
          console.error(`[Worker] Redis reconnect retries exceeded (${REDIS_RETRY_LIMIT}). Worker disabled.`);
        }
        return null;
      }
      return Math.min(times * 500, 5000);
    },
  });

  workerConnection.on('ready', () => {
    retryStopLogged = false;
    console.log('[Worker] Redis connection ready for scheduled tweet worker.');
  });

  workerConnection.on('error', (err) => {
    if (!shouldLogError()) return;
    console.error('[Worker] Redis connection error:', err?.message || err);
  });

  const concurrency = Number.parseInt(process.env.SCHEDULED_WORKER_CONCURRENCY || '1', 10);

  scheduledTweetWorker = new Worker(
    'scheduled-tweet-queue',
    async (job) => {
      const { scheduledTweetId } = job.data;
      await scheduledTweetService.processSingleScheduledTweetById(scheduledTweetId);
    },
    {
      connection: workerConnection,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
    }
  );

  scheduledTweetWorker.on('completed', (job) => {
    console.log(`[Worker] Scheduled tweet job completed: ${job.id}`);
  });

  scheduledTweetWorker.on('failed', (job, err) => {
    console.error(`[Worker] Scheduled tweet job failed: ${job?.id || 'unknown'}`, err?.message || err);
  });

  scheduledTweetWorker.on('error', (err) => {
    if (!shouldLogError()) return;
    console.error('[Worker] Worker runtime error:', err?.message || err);
  });

  console.log('[Worker] Scheduled tweet worker started.');
  return scheduledTweetWorker;
}

export async function stopScheduledTweetWorker() {
  try {
    if (scheduledTweetWorker) {
      await scheduledTweetWorker.close();
      scheduledTweetWorker = null;
    }
  } catch (error) {
    console.error('[Worker] Failed to close scheduled tweet worker:', error?.message || error);
  }

  try {
    if (workerConnection) {
      await workerConnection.quit();
      workerConnection = null;
    }
  } catch (error) {
    console.error('[Worker] Failed to close worker Redis connection:', error?.message || error);
  }
}

export function getScheduledWorkerStatus() {
  return {
    enabled: WORKER_ENABLED,
    started: Boolean(scheduledTweetWorker),
    hasRedisUrl: Boolean(REDIS_URL),
  };
}

