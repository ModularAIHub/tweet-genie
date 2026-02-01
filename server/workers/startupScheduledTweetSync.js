import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { pool } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const scheduledTweetQueue = new Queue('scheduled-tweet-queue', { connection });

/**
 * One-time check on startup to queue any pending scheduled tweets that were missed
 * This catches tweets that were scheduled before BullMQ integration was added to bulk scheduling
 */
async function queueOrphanedScheduledTweets() {
  try {
    console.log('[Startup] Checking for pending scheduled tweets without queue jobs...');
    
    // Find all pending tweets (including past due ones)
    const { rows } = await pool.query(`
      SELECT id, scheduled_for, user_id, content
      FROM scheduled_tweets 
      WHERE status = 'pending'
      ORDER BY scheduled_for ASC
    `);

    if (rows.length > 0) {
      console.log(`[Startup] Found ${rows.length} pending scheduled tweets, adding to queue...`);
      
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
            removeOnFail: false
          }
        );
        
        if (delay === 0) {
          console.log(`[Startup] Queued overdue tweet ${tweet.id} (scheduled for ${tweet.scheduled_for}) - will post immediately`);
        } else {
          console.log(`[Startup] Queued tweet ${tweet.id} (scheduled for ${tweet.scheduled_for})`);
        }
      }
      
      console.log('[Startup] ✅ All pending tweets added to queue');
    } else {
      console.log('[Startup] No pending scheduled tweets found');
    }
  } catch (error) {
    console.error('[Startup] Error queuing orphaned tweets:', error);
  }
}

// Run once on startup
queueOrphanedScheduledTweets();

export { queueOrphanedScheduledTweets };
