import dotenv from 'dotenv';
import pool from '../config/database.js';
import { scheduledTweetService } from '../services/scheduledTweetService.js';

dotenv.config();

const WORKER_ENABLED = process.env.DB_SCHEDULED_TWEET_WORKER_ENABLED !== 'false';
const POLL_INTERVAL_MS = Number.parseInt(process.env.DB_SCHEDULED_TWEET_WORKER_POLL_MS || '10000', 10);
const BATCH_SIZE = Number.parseInt(process.env.DB_SCHEDULED_TWEET_WORKER_BATCH_SIZE || '10', 10);
const STUCK_MINUTES = Number.parseInt(process.env.SCHEDULED_PROCESSING_STUCK_MINUTES || '15', 10);
const STUCK_RECOVERY_INTERVAL_MS = Number.parseInt(
  process.env.DB_SCHEDULED_TWEET_WORKER_RECOVERY_INTERVAL_MS || '60000',
  10
);
const MAX_ERROR_LENGTH = 900;

let tickInProgress = false;
let workerStarted = false;
let workerInterval = null;
let workerStartedAt = null;
let lastTickFinishedAt = null;
let lastRecoveryRunAt = null;

const workerStats = {
  ticks: 0,
  noopTicks: 0,
  recoveredRows: 0,
  claimedRows: 0,
  processedRows: 0,
  succeededRows: 0,
  retriedRows: 0,
  skippedRows: 0,
  failedRows: 0,
};

const lastTickSummary = {
  tickId: null,
  startedAt: null,
  finishedAt: null,
  durationMs: 0,
  recovered: 0,
  claimed: 0,
  succeeded: 0,
  retried: 0,
  skipped: 0,
  failed: 0,
  status: 'idle',
  error: null,
};

const safeErrorMessage = (error) => {
  const message = error?.response?.data?.message || error?.message || 'Unknown DB scheduler error';
  return String(message).slice(0, MAX_ERROR_LENGTH);
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

async function recoverStuckScheduledTweets() {
  const stuckMinutes = Number.isFinite(STUCK_MINUTES) && STUCK_MINUTES > 0 ? STUCK_MINUTES : 15;
  const { rows } = await pool.query(
    `UPDATE scheduled_tweets
     SET status = 'pending',
         processing_started_at = NULL,
         error_message = CASE
           WHEN COALESCE(error_message, '') = '' THEN 'Recovered by DB scheduler after processing timeout.'
           ELSE error_message || ' | Recovered by DB scheduler after processing timeout.'
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing'
       AND COALESCE(processing_started_at, updated_at) <
           (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 minute')
     RETURNING id`,
    [stuckMinutes]
  );

  return rows.length;
}

async function claimDueScheduledTweets(limit) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
  const { rows } = await pool.query(
    `WITH due AS (
       SELECT id
       FROM scheduled_tweets
       WHERE status = 'pending'
         AND (approval_status = 'approved' OR approval_status IS NULL)
         AND scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
       ORDER BY scheduled_for ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE scheduled_tweets st
     SET status = 'processing',
         processing_started_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     FROM due
     WHERE st.id = due.id
     RETURNING st.id`,
    [safeLimit]
  );
  return rows;
}

async function schedulerTick() {
  if (tickInProgress) {
    return;
  }

  tickInProgress = true;
  const tickId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  workerStats.ticks += 1;

  lastTickSummary.tickId = tickId;
  lastTickSummary.startedAt = startedAt;
  lastTickSummary.status = 'running';
  lastTickSummary.error = null;
  lastTickSummary.recovered = 0;
  lastTickSummary.claimed = 0;
  lastTickSummary.succeeded = 0;
  lastTickSummary.retried = 0;
  lastTickSummary.skipped = 0;
  lastTickSummary.failed = 0;

  try {
    const nowMs = Date.now();
    const shouldRunRecovery =
      !lastRecoveryRunAt ||
      !Number.isFinite(STUCK_RECOVERY_INTERVAL_MS) ||
      STUCK_RECOVERY_INTERVAL_MS <= 0 ||
      nowMs - lastRecoveryRunAt >= STUCK_RECOVERY_INTERVAL_MS;

    if (shouldRunRecovery) {
      const recovered = await recoverStuckScheduledTweets();
      workerStats.recoveredRows += recovered;
      lastTickSummary.recovered = recovered;
      lastRecoveryRunAt = nowMs;
    }

    const dueRows = await claimDueScheduledTweets(BATCH_SIZE);
    if (!dueRows.length) {
      workerStats.noopTicks += 1;
      lastTickSummary.status = 'noop';
      return;
    }

    workerStats.claimedRows += dueRows.length;
    workerStats.processedRows += dueRows.length;
    lastTickSummary.claimed = dueRows.length;

    for (const row of dueRows) {
      try {
        const result = await scheduledTweetService.processSingleScheduledTweetById(row.id);
        const outcome = result?.outcome || 'succeeded';

        if (outcome === 'retry') {
          workerStats.retriedRows += 1;
          lastTickSummary.retried += 1;
        } else if (outcome === 'failed') {
          workerStats.failedRows += 1;
          lastTickSummary.failed += 1;
        } else if (outcome === 'skipped') {
          workerStats.skippedRows += 1;
          lastTickSummary.skipped += 1;
        } else {
          workerStats.succeededRows += 1;
          lastTickSummary.succeeded += 1;
        }
      } catch (error) {
        const errorMessage = safeErrorMessage(error);
        workerStats.failedRows += 1;
        lastTickSummary.failed += 1;

        try {
          await pool.query(
            `UPDATE scheduled_tweets
             SET status = 'failed',
                 error_message = $2,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
               AND status = 'processing'`,
            [row.id, errorMessage]
          );
        } catch (updateError) {
          console.error('[DBScheduledTweetWorker] Failed to mark row as failed:', updateError?.message || updateError);
        }
      }
    }

    lastTickSummary.status = 'ok';
  } catch (error) {
    lastTickSummary.status = 'error';
    lastTickSummary.error = safeErrorMessage(error);
    console.error('[DBScheduledTweetWorker] Tick failed:', lastTickSummary.error);
  } finally {
    tickInProgress = false;
    lastTickFinishedAt = Date.now();
    lastTickSummary.finishedAt = lastTickFinishedAt;
    lastTickSummary.durationMs = lastTickFinishedAt - startedAt;
  }
}

export function getDbScheduledTweetWorkerStatus() {
  const now = Date.now();
  const nextRunAt = workerStarted && lastTickFinishedAt
    ? new Date(lastTickFinishedAt + POLL_INTERVAL_MS).toISOString()
    : null;

  return {
    enabled: WORKER_ENABLED,
    started: workerStarted,
    startedAt: toIso(workerStartedAt),
    pid: process.pid,
    inProgress: tickInProgress,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    stuckMinutes: STUCK_MINUTES,
    recoveryIntervalMs: STUCK_RECOVERY_INTERVAL_MS,
    lastRecoveryRunAt: toIso(lastRecoveryRunAt),
    stats: { ...workerStats },
    lastTick: {
      tickId: lastTickSummary.tickId,
      startedAt: toIso(lastTickSummary.startedAt),
      finishedAt: toIso(lastTickSummary.finishedAt),
      durationMs: lastTickSummary.durationMs,
      status: lastTickSummary.status,
      error: lastTickSummary.error,
      recovered: lastTickSummary.recovered,
      claimed: lastTickSummary.claimed,
      succeeded: lastTickSummary.succeeded,
      retried: lastTickSummary.retried,
      skipped: lastTickSummary.skipped,
      failed: lastTickSummary.failed,
    },
    nextRunAt,
    nextRunInMs: nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - now) : null,
  };
}

export async function startDbScheduledTweetWorker(options = {}) {
  if (workerStarted) {
    return { started: true };
  }

  const enabled = options.enabled !== undefined ? Boolean(options.enabled) : WORKER_ENABLED;
  if (!enabled) {
    console.warn('[DBScheduledTweetWorker] Disabled by configuration.');
    return { started: false };
  }

  workerStarted = true;
  workerStartedAt = Date.now();
  lastRecoveryRunAt = null;
  console.log('[DBScheduledTweetWorker] Started', {
    intervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    stuckMinutes: STUCK_MINUTES,
    recoveryIntervalMs: STUCK_RECOVERY_INTERVAL_MS,
  });

  await schedulerTick();
  workerInterval = setInterval(schedulerTick, POLL_INTERVAL_MS);

  if (typeof workerInterval.unref === 'function') {
    workerInterval.unref();
  }

  return { started: true };
}

export function stopDbScheduledTweetWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }

  workerStarted = false;
  workerStartedAt = null;
  lastRecoveryRunAt = null;
  tickInProgress = false;
}
