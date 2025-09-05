import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { scheduledTweetService } from '../services/scheduledTweetService.js';
import IORedis from 'ioredis';

dotenv.config();

// Use REDIS_URL connection string for Upstash or local Redis
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

export const scheduledTweetWorker = new Worker(
  'scheduled-tweet-queue',
  async (job) => {
    // job.data should contain scheduledTweetId
    const { scheduledTweetId } = job.data;
    await scheduledTweetService.processSingleScheduledTweetById(scheduledTweetId);
  },
  { connection }
);

scheduledTweetWorker.on('completed', (job) => {
  console.log(`✅ Scheduled tweet job completed: ${job.id}`);
});

scheduledTweetWorker.on('failed', (job, err) => {
  console.error(`❌ Scheduled tweet job failed: ${job.id}`, err);
});
