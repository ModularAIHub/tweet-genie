import dotenv from 'dotenv';
import { pool } from '../config/database.js';
import { isScheduledQueueAvailable, scheduledTweetQueue } from '../services/queueService.js';

dotenv.config();

/**
 * One-time check on startup to queue pending scheduled tweets.
 * Safe no-op when Redis queue is unavailable.
 */
export async function queueOrphanedScheduledTweets() {
  if (!isScheduledQueueAvailable()) {
    console.warn('[Startup] Scheduled queue unavailable. Skipping orphaned tweet queue sync.');
    return {
      skipped: true,
      queuedCount: 0,
      pendingCount: 0,
      reason: 'queue_unavailable',
    };
  }

  try {
    console.log('[Startup] Checking for pending scheduled tweets without queue jobs...');

    const { rows } = await pool.query(
      `
      SELECT id, scheduled_for, user_id, content
      FROM scheduled_tweets
      WHERE status = 'pending'
      ORDER BY scheduled_for ASC
      `
    );

    if (!rows.length) {
      console.log('[Startup] No pending scheduled tweets found');
      return {
        skipped: false,
        queuedCount: 0,
        pendingCount: 0,
      };
    }

    console.log(`[Startup] Found ${rows.length} pending scheduled tweets, adding to queue...`);
    let queuedCount = 0;

    for (const tweet of rows) {
      const delay = Math.max(0, new Date(tweet.scheduled_for).getTime() - Date.now());

      await scheduledTweetQueue.add(
        'scheduled-tweet',
        { scheduledTweetId: tweet.id },
        {
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      queuedCount += 1;
      if (delay === 0) {
        console.log(
          `[Startup] Queued overdue tweet ${tweet.id} (scheduled for ${tweet.scheduled_for}) for immediate processing`
        );
      } else {
        console.log(`[Startup] Queued tweet ${tweet.id} (scheduled for ${tweet.scheduled_for})`);
      }
    }

    console.log(`[Startup] Queued ${queuedCount}/${rows.length} pending scheduled tweets`);
    return {
      skipped: false,
      queuedCount,
      pendingCount: rows.length,
    };
  } catch (error) {
    console.error('[Startup] Error queuing orphaned tweets:', error);
    return {
      skipped: false,
      queuedCount: 0,
      pendingCount: 0,
      error: error?.message || String(error),
    };
  }
}

export async function runStartupScheduledTweetSync() {
  return queueOrphanedScheduledTweets();
}

