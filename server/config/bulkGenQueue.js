import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

export const bulkGenQueue = new Queue('bulk-gen', { connection });

export const getRedisClient = () => connection;
