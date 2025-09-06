import pkg from 'bullmq';
const { Queue, Worker, Job } = pkg;
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();


let connection;
if (process.env.REDIS_URL) {
  connection = { url: process.env.REDIS_URL };
} else {
  connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

export const bulkGenQueue = new Queue('bulk-gen', { connection });

export const getRedisClient = () => createClient(connection);
