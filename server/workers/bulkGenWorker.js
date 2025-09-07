import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
// Debug: print REDIS_URL to verify environment variable is loaded
console.log('REDIS_URL:', process.env.REDIS_URL);
import { bulkGenQueue, getRedisClient } from '../config/bulkGenQueue.js';
import { aiService } from '../services/aiService.js';
import { creditService } from '../services/creditService.js';

const redis = getRedisClient();
redis.connect();

import { Worker } from 'bullmq';

export function startBulkGenWorker() {
  new Worker(
    bulkGenQueue.name,
    async (job) => {
      const { prompt, options, userId } = job.data;
      console.log(`[BulkGenWorker] Processing job ${job.id} for user ${userId}...`);
      try {
        const result = await aiService.generateTweetOrThread(prompt, options);
        // Deduct credits: 1 for single tweet, 1.2 per thread part
        let creditsToDeduct = 1;
        if (result.isThread && Array.isArray(result.threadParts)) {
          creditsToDeduct = result.threadParts.length * 1.2;
        }
        await creditService.checkAndDeductCredits(userId, 'bulk_ai_generation', creditsToDeduct);
        console.log(`[BulkGenWorker] Deducted ${creditsToDeduct} credits for user ${userId}`);
        console.log(`[BulkGenWorker] Job ${job.id} generated result:`, result);
        // Store result in Redis with jobId as key
        await redis.set(`bulkgen:result:${job.id}`,
          JSON.stringify(result), { EX: 60 * 60 }); // 1 hour expiry
        console.log(`[BulkGenWorker] Result for job ${job.id} written to Redis.`);
        return result;
      } catch (err) {
        console.error(`[BulkGenWorker] Error processing job ${job.id}:`, err);
        await redis.set(`bulkgen:result:${job.id}`,
          JSON.stringify({ error: err.message }), { EX: 60 * 60 });
        throw err;
      }
    },
    { connection: bulkGenQueue.opts.connection }
  );
}
