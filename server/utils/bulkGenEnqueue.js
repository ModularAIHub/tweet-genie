import { bulkGenQueue } from '../config/bulkGenQueue.js';

// Enqueue jobs for each prompt, return job IDs
export const enqueueBulkGenJobs = async (prompts, optionsArr, userId) => {
  const jobs = await Promise.all(prompts.map((prompt, idx) =>
    bulkGenQueue.add('generate', { prompt, options: optionsArr[idx], userId })
  ));
  return jobs.map(job => job.id);
};
