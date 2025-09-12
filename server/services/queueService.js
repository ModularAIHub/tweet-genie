import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Use REDIS_URL connection string for Upstash or local Redis
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

// Scheduled tweet queue (for scheduling only, not bulk gen)
export const scheduledTweetQueue = new Queue('scheduled-tweet-queue', {
	connection,
	defaultJobOptions: {
		removeOnComplete: true,
		removeOnFail: false,
		attempts: 3,
		backoff: { type: 'exponential', delay: 60000 },
	},
});

// Legacy bulk generation queue and Redis connection removed. Only scheduled tweet queue logic should remain if needed.
