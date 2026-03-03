import { weeklyContentService } from '../services/weeklyContentService.js';
import { feedbackLoopService } from '../services/feedbackLoopService.js';
import pool from '../config/database.js';

// ─── Config ──────────────────────────────────────────────────────────────
const WORKER_ENABLED = process.env.WEEKLY_CONTENT_WORKER_ENABLED !== 'false';
const POLL_INTERVAL_MS = parseInt(process.env.WEEKLY_CONTENT_POLL_INTERVAL || '3600000'); // 1 hour default
const GENERATION_DAY = parseInt(process.env.WEEKLY_CONTENT_GENERATION_DAY || '1'); // 0=Sun, 1=Mon
const GENERATION_HOUR = parseInt(process.env.WEEKLY_CONTENT_GENERATION_HOUR || '7'); // 7 AM UTC

// ─── State ───────────────────────────────────────────────────────────────
let intervalId = null;
let lastRunDate = null;
const stats = {
  totalRuns: 0,
  totalSucceeded: 0,
  totalFailed: 0,
  lastRunAt: null,
  lastRunResult: null,
};

// ─── Should Run Check ────────────────────────────────────────────────────
function shouldRunNow() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Already ran today?
  if (lastRunDate === today) return false;

  // Is it the right day of week?
  if (now.getUTCDay() !== GENERATION_DAY) return false;

  // Is it past the generation hour?
  if (now.getUTCHours() < GENERATION_HOUR) return false;

  return true;
}

// ─── Worker Tick ─────────────────────────────────────────────────────────
export async function runWeeklyContentTick() {
  if (!shouldRunNow()) {
    return { skipped: true, reason: 'Not time yet' };
  }

  console.log('[WeeklyContentWorker] Running weekly content generation...');
  lastRunDate = new Date().toISOString().slice(0, 10);
  stats.totalRuns++;
  stats.lastRunAt = new Date().toISOString();

  try {
    const result = await weeklyContentService.runWeeklyGeneration();
    stats.totalSucceeded += result.succeeded;
    stats.totalFailed += result.failed;
    stats.lastRunResult = result;

    console.log('[WeeklyContentWorker] Completed:', result);
    return result;
  } catch (error) {
    stats.totalFailed++;
    stats.lastRunResult = { error: error.message };
    console.error('[WeeklyContentWorker] Error:', error.message);
    throw error;
  }
}

// ─── Cron Endpoint Handler (for Vercel/QStash) ──────────────────────────
export async function handleWeeklyContentCron() {
  console.log('[WeeklyContentWorker] Cron endpoint triggered');

  // DB-level dedup: check if any content was already generated today
  try {
    const { rows: [{ cnt }] } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM content_review_queue
       WHERE created_at > NOW() - INTERVAL '18 hours'
         AND source IN ('weekly_generation', 'manual_generation')`
    );
    if (parseInt(cnt) > 0) {
      console.log(`[WeeklyContentWorker] Skipping — already generated ${cnt} items within last 18h`);
      return { skipped: true, reason: 'Already generated recently', recentItems: parseInt(cnt) };
    }
  } catch (dbErr) {
    console.warn('[WeeklyContentWorker] Dedup check failed, proceeding anyway:', dbErr.message);
  }

  stats.totalRuns++;
  stats.lastRunAt = new Date().toISOString();
  lastRunDate = new Date().toISOString().slice(0, 10);

  try {
    // Phase 5: Run feedback loop cycle BEFORE generation
    // This scores unscored tweets, generates weekly summaries,
    // auto-updates strategies, and builds performance context.
    let performanceContextMap = new Map();
    try {
      const feedbackResult = await feedbackLoopService.runWeeklyCycle();
      performanceContextMap = feedbackResult.contextMap || new Map();
      console.log(`[WeeklyContentWorker] Feedback loop completed: ${feedbackResult.results.summaries} summaries, ${feedbackResult.results.updates} strategy updates`);
    } catch (feedbackErr) {
      console.warn('[WeeklyContentWorker] Feedback loop failed (non-fatal), proceeding with generation:', feedbackErr.message);
    }

    const result = await weeklyContentService.runWeeklyGeneration(performanceContextMap);
    stats.totalSucceeded += result.succeeded;
    stats.totalFailed += result.failed;
    stats.lastRunResult = result;
    return result;
  } catch (error) {
    stats.totalFailed++;
    stats.lastRunResult = { error: error.message };
    throw error;
  }
}

// ─── Start Interval-Based Worker ─────────────────────────────────────────
export function startWeeklyContentWorker() {
  if (!WORKER_ENABLED) {
    console.log('[WeeklyContentWorker] Worker disabled via env');
    return;
  }

  if (intervalId) {
    console.log('[WeeklyContentWorker] Already running');
    return;
  }

  console.log(`[WeeklyContentWorker] Started — checking every ${POLL_INTERVAL_MS / 1000}s, generates on day=${GENERATION_DAY} hour>=${GENERATION_HOUR} UTC`);

  intervalId = setInterval(async () => {
    try {
      await runWeeklyContentTick();
    } catch (err) {
      // Error already logged in tick
    }
  }, POLL_INTERVAL_MS);

  // Run once at startup to catch up if server restarted on a Monday
  setTimeout(async () => {
    try {
      await runWeeklyContentTick();
    } catch (err) {
      // Error already logged
    }
  }, 5000);
}

// ─── Status ──────────────────────────────────────────────────────────────
export function getWeeklyContentWorkerStatus() {
  return {
    enabled: WORKER_ENABLED,
    running: intervalId !== null,
    generationDay: GENERATION_DAY,
    generationHour: GENERATION_HOUR,
    lastRunDate,
    ...stats,
  };
}
