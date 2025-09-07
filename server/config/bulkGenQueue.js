import pkg from 'bullmq';
const { Queue, Worker, Job } = pkg;
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

// Remove quotes from REDIS_URL if present
let redisUrl = process.env.REDIS_URL;
if (redisUrl && redisUrl.startsWith('"') && redisUrl.endsWith('"')) {
  redisUrl = redisUrl.slice(1, -1);
}

let connection;
if (redisUrl) {
  connection = { url: redisUrl };
} else {
  connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

console.log('Redis connection config:', connection);

export const bulkGenQueue = new Queue('bulk-gen', { connection });

export const getRedisClient = () => createClient(connection);
