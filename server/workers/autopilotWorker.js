// Auto-Pilot Worker - Runs periodically to fill queues for enabled strategies
import pool from '../config/database.js';
import * as autopilotService from '../services/autopilotService.js';

const AUTOPILOT_WORKER_INTERVAL_MS = Number(process.env.AUTOPILOT_WORKER_INTERVAL_MS || 60 * 60 * 1000); // 1 hour
const AUTOPILOT_DEBUG = process.env.AUTOPILOT_DEBUG === 'true';

const autopilotLog = (...args) => {
  if (AUTOPILOT_DEBUG) {
    console.log('[AutoPilot Worker]', ...args);
  }
};

let autopilotWorkerInterval = null;
let autopilotWorkerRunning = false;

/**
 * Process all enabled autopilot strategies
 */
async function processAutopilotStrategies() {
  if (autopilotWorkerRunning) {
    autopilotLog('⏭️  Worker already running, skipping this cycle');
    return;
  }
  
  autopilotWorkerRunning = true;
  
  try {
    autopilotLog('🤖 Starting autopilot worker cycle...');
    
    // Get all enabled autopilot configs
    const result = await pool.query(`
      SELECT ac.*, us.id as strategy_id, us.user_id, us.niche
      FROM autopilot_config ac
      JOIN user_strategies us ON ac.strategy_id = us.id
      WHERE ac.is_enabled = true
        AND us.status = 'active'
    `);
    
    if (result.rows.length === 0) {
      autopilotLog('No enabled autopilot strategies found');
      return;
    }
    
    autopilotLog(`Found ${result.rows.length} enabled autopilot strategies`);
    
    for (const config of result.rows) {
      try {
        autopilotLog(`Processing strategy: ${config.strategy_id} (${config.niche})`);
        
        // Fill queue for this strategy
        const generated = await autopilotService.fillQueue(config.strategy_id);
        
        autopilotLog(`✅ Strategy ${config.strategy_id}: Generated ${generated.length} posts`);
      } catch (error) {
        console.error(`❌ Error processing strategy ${config.strategy_id}:`, error.message);
      }
    }
    
    autopilotLog('🎉 Autopilot worker cycle complete');
  } catch (error) {
    console.error('Autopilot worker error:', error);
  } finally {
    autopilotWorkerRunning = false;
  }
}

/**
 * Start the autopilot worker
 */
export function startAutopilotWorker() {
  if (autopilotWorkerInterval) {
    console.log('⚠️  Autopilot worker already started');
    return;
  }
  
  console.log(`🤖 Starting autopilot worker (interval: ${AUTOPILOT_WORKER_INTERVAL_MS}ms)`);
  
  // Run immediately on start
  processAutopilotStrategies();
  
  // Then run at intervals
  autopilotWorkerInterval = setInterval( () => {
    processAutopilotStrategies();
  }, AUTOPILOT_WORKER_INTERVAL_MS);
}

/**
 * Stop the autopilot worker
 */
export function stopAutopilotWorker() {
  if (!autopilotWorkerInterval) {
    console.log('⚠️  Autopilot worker not running');
    return;
  }
  
  clearInterval(autopilotWorkerInterval);
  autopilotWorkerInterval = null;
  console.log('🛑 Autopilot worker stopped');
}

/**
 * Get autopilot worker status
 */
export function getAutopilotWorkerStatus() {
  return {
    running: !!autopilotWorkerInterval,
    currentlyProcessing: autopilotWorkerRunning,
    intervalMs: AUTOPILOT_WORKER_INTERVAL_MS
  };
}

export default {
  startAutopilotWorker,
  stopAutopilotWorker,
  getAutopilotWorkerStatus,
  processAutopilotStrategies
};
