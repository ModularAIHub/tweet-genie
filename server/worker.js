import http from 'http';
import dotenv from 'dotenv';
import { startDbScheduledTweetWorker, stopDbScheduledTweetWorker } from './workers/dbScheduledTweetWorker.js';
import { startAutopilotWorker, stopAutopilotWorker } from './workers/autopilotWorker.js';

dotenv.config();

const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const START_DB_SCHEDULER_WORKER = parseBooleanEnv(process.env.START_DB_SCHEDULER_WORKER, true);
const START_AUTOPILOT_WORKER = parseBooleanEnv(process.env.START_AUTOPILOT_WORKER, false);

// Minimal health server so Render free web service tier keeps this process alive.
// Ping this endpoint every 5 minutes via UptimeRobot to prevent sleep.
const PORT = process.env.PORT || 3099;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'tweet-genie-worker', ts: Date.now() }));
}).listen(PORT, () => console.log(`[Tweet Worker] Health server listening on ${PORT}`));

const shutdown = (signal) => {
  console.log(`[Tweet Worker] Shutdown signal received: ${signal}`);
  stopDbScheduledTweetWorker();
  stopAutopilotWorker();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (START_DB_SCHEDULER_WORKER) {
  startDbScheduledTweetWorker()
    .then(() => {
      console.log('[Tweet Worker] Scheduled tweet worker started');
    })
    .catch((error) => {
      console.error('[Tweet Worker] Failed to start scheduled tweet worker:', error);
      process.exit(1);
    });
} else {
  console.log('[Tweet Worker] Scheduled tweet worker disabled by START_DB_SCHEDULER_WORKER=false');
}

// Autopilot worker runs independently and fills queues for enabled strategies.
// Uses DB pool directly, no HTTP auth required, so it works even when users are logged out.
if (START_AUTOPILOT_WORKER) {
  Promise.resolve()
    .then(() => startAutopilotWorker())
    .then(() => {
      console.log('[Tweet Worker] Autopilot worker started');
    })
    .catch((error) => {
      console.error('[Tweet Worker] Failed to start autopilot worker:', error);
      // Non-fatal: scheduled tweet processing can still continue.
    });
} else {
  console.log('[Tweet Worker] Autopilot worker disabled by START_AUTOPILOT_WORKER=false');
}
