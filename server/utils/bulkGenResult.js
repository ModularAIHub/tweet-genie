import { getRedisClient } from '../config/bulkGenQueue.js';

const redis = getRedisClient();
redis.connect();

export const getBulkGenResult = async (jobId) => {
  const data = await redis.get(`bulkgen:result:${jobId}`);
  return data ? JSON.parse(data) : null;
};
