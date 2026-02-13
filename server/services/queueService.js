import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_ENABLED = process.env.SCHEDULED_QUEUE_ENABLED !== 'false';
const REDIS_RETRY_LIMIT = Number.parseInt(process.env.REDIS_RETRY_LIMIT || '8', 10);
const REDIS_ERROR_LOG_THROTTLE_MS = Number.parseInt(process.env.REDIS_ERROR_LOG_THROTTLE_MS || '30000', 10);

export const queueRuntime = {
  enabled: QUEUE_ENABLED,
  mode: 'noop',
  available: false,
  reason: '',
};

function createNoopQueue(reason) {
  let lastWarnAt = 0;

  const warn = (action) => {
    const now = Date.now();
    if (now - lastWarnAt < REDIS_ERROR_LOG_THROTTLE_MS) return;
    lastWarnAt = now;
    console.warn(`[Queue:NOOP] ${action} skipped. ${reason}`);
  };

  return {
    async add(name, data, opts) {
      warn(`add(${name})`);
      return {
        id: `noop_${Date.now()}`,
        name,
        data,
        opts,
        async remove() {
          return undefined;
        },
      };
    },
    async getDelayed() {
      return [];
    },
    async close() {
      return undefined;
    },
  };
}

let scheduledTweetQueue = createNoopQueue('Redis queue is disabled or unavailable.');
let queueConnection = null;
let retryStopLogged = false;
let lastRedisErrorAt = 0;

if (!QUEUE_ENABLED) {
  queueRuntime.reason = 'Disabled by SCHEDULED_QUEUE_ENABLED=false';
  console.warn('[Queue] Scheduled queue disabled by environment flag.');
} else if (!REDIS_URL) {
  queueRuntime.reason = 'Missing REDIS_URL';
  console.warn('[Queue] REDIS_URL missing. Using noop queue mode.');
} else {
  queueConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > REDIS_RETRY_LIMIT) {
        if (!retryStopLogged) {
          retryStopLogged = true;
          queueRuntime.available = false;
          queueRuntime.reason = `Redis reconnect retries exceeded (${REDIS_RETRY_LIMIT}).`;
          console.error(`[Queue] Redis reconnect retries exceeded (${REDIS_RETRY_LIMIT}). Queue unavailable.`);
        }
        return null;
      }
      return Math.min(times * 500, 5000);
    },
  });

  queueConnection.on('ready', () => {
    queueRuntime.mode = 'bullmq';
    queueRuntime.available = true;
    queueRuntime.reason = '';
    retryStopLogged = false;
    console.log('[Queue] Redis connection ready for scheduled-tweet-queue.');
  });

  queueConnection.on('end', () => {
    queueRuntime.available = false;
    if (!queueRuntime.reason) {
      queueRuntime.reason = 'Redis connection ended';
    }
  });

  queueConnection.on('error', (err) => {
    const now = Date.now();
    if (now - lastRedisErrorAt < REDIS_ERROR_LOG_THROTTLE_MS) {
      return;
    }
    lastRedisErrorAt = now;
    queueRuntime.available = false;
    queueRuntime.reason = err?.message || 'Redis error';
    console.error('[Queue] Redis error:', err?.message || err);
  });

  scheduledTweetQueue = new Queue('scheduled-tweet-queue', {
    connection: queueConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
    },
  });
  queueRuntime.mode = 'bullmq';
  queueRuntime.reason = 'connecting';
}

export { scheduledTweetQueue };

export function isScheduledQueueAvailable() {
  return queueRuntime.available && queueRuntime.mode === 'bullmq';
}

export function getScheduledQueueHealth() {
  return { ...queueRuntime };
}

export async function closeScheduledQueue() {
  try {
    if (scheduledTweetQueue?.close) {
      await scheduledTweetQueue.close();
    }
  } catch (error) {
    console.error('[Queue] Failed to close scheduledTweetQueue:', error?.message || error);
  }

  try {
    if (queueConnection?.quit) {
      await queueConnection.quit();
    }
  } catch (error) {
    console.error('[Queue] Failed to close Redis connection:', error?.message || error);
  }
}
