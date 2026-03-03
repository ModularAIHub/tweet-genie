import http from 'http';
import dotenv from 'dotenv';
import { startDbScheduledTweetWorker, stopDbScheduledTweetWorker } from './workers/dbScheduledTweetWorker.js';
import { startAutopilotWorker, stopAutopilotWorker } from './workers/autopilotWorker.js';

dotenv.config();

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

startDbScheduledTweetWorker()
  .then(() => {
    console.log('[Tweet Worker] Scheduled tweet worker started');
  })
  .catch((error) => {
    console.error('[Tweet Worker] Failed to start scheduled tweet worker:', error);
    process.exit(1);
  });

// Autopilot worker runs independently — fills content queues for enabled strategies.
// Uses DB pool directly, no HTTP auth required, so it works even when users are logged out.
try {
  startAutopilotWorker();
  console.log('[Tweet Worker] Autopilot worker started');
} catch (error) {
  console.error('[Tweet Worker] Failed to start autopilot worker:', error);
  // Non-fatal — scheduled tweet processing can still continue
}
