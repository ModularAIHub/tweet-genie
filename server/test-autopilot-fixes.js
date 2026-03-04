#!/usr/bin/env node
/**
 * Test script to verify autopilot fixes are working correctly
 * Run: node test-autopilot-fixes.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${COLORS.reset} ${message}`);
}

async function testThreadGeneration() {
  console.log(`\n${COLORS.cyan}=== TEST 1: Thread Generation Fix ===${COLORS.reset}\n`);
  
  try {
    const result = await pool.query(`
      SELECT 
        (content LIKE '%---%') as is_thread,
        COUNT(*) as count
      FROM content_review_queue
      WHERE source = 'autopilot'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY is_thread
    `);
    
    if (result.rows.length === 0) {
      log(COLORS.yellow, '⚠️ ', 'No autopilot posts found in last 24 hours');
      return;
    }
    
    const threads = result.rows.find(r => r.is_thread)?.count || 0;
    const singles = result.rows.find(r => !r.is_thread)?.count || 0;
    const total = threads + singles;
    const threadPercent = ((threads / total) * 100).toFixed(1);
    
    console.log(`  Total posts: ${total}`);
    console.log(`  Threads: ${threads} (${threadPercent}%)`);
    console.log(`  Single tweets: ${singles} (${(100 - threadPercent).toFixed(1)}%)`);
    
    if (threadPercent === '100.0') {
      log(COLORS.red, '❌', 'FAIL: All posts are threads (fix not working)');
    } else if (threadPercent === '0.0') {
      log(COLORS.yellow, '⚠️ ', 'WARNING: No threads generated (might be too restrictive)');
    } else {
      log(COLORS.green, '✅', `PASS: Mix of threads (${threadPercent}%) and singles (${(100-threadPercent).toFixed(1)}%)`);
    }
  } catch (err) {
    log(COLORS.red, '❌', `Error: ${err.message}`);
  }
}

async function testTimezoneScheduling() {
  console.log(`\n${COLORS.cyan}=== TEST 2: Timezone Scheduling ===${COLORS.reset}\n`);
  
  try {
    // Get a strategy with custom hours
    const configResult = await pool.query(`
      SELECT ac.strategy_id, ac.custom_posting_hours, ac.timezone
      FROM autopilot_config ac
      WHERE ac.custom_posting_hours IS NOT NULL 
        AND array_length(ac.custom_posting_hours, 1) > 0
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      log(COLORS.yellow, '⚠️ ', 'No autopilot config with custom hours found');
      return;
    }
    
    const config = configResult.rows[0];
    console.log(`  Strategy: ${config.strategy_id}`);
    console.log(`  Configured hours: ${JSON.stringify(config.custom_posting_hours)}`);
    console.log(`  Timezone: ${config.timezone}`);
    
    // Check actual scheduled hours
    const scheduledResult = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM suggested_time AT TIME ZONE $2) as hour,
        EXTRACT(MINUTE FROM suggested_time AT TIME ZONE $2) as minute,
        COUNT(*) as count
      FROM content_review_queue
      WHERE strategy_id = $1
        AND source = 'autopilot'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour, minute
      ORDER BY hour, minute
    `, [config.strategy_id, config.timezone]);
    
    if (scheduledResult.rows.length === 0) {
      log(COLORS.yellow, '⚠️ ', 'No posts scheduled in last 24 hours');
      return;
    }
    
    console.log(`\n  Actual scheduled times:`);
    let hasWrongTimes = false;
    let hasCorrectTimes = false;
    
    scheduledResult.rows.forEach(row => {
      const hour = parseInt(row.hour);
      const minute = parseInt(row.minute);
      const isConfiguredHour = config.custom_posting_hours.includes(hour);
      const isExactHour = minute === 0;
      
      const status = isConfiguredHour && isExactHour ? '✅' : '❌';
      const color = isConfiguredHour && isExactHour ? COLORS.green : COLORS.red;
      
      console.log(`    ${color}${status}${COLORS.reset} ${hour}:${minute.toString().padStart(2, '0')} - ${row.count} posts`);
      
      if (!isConfiguredHour || !isExactHour) hasWrongTimes = true;
      if (isConfiguredHour && isExactHour) hasCorrectTimes = true;
    });
    
    if (hasWrongTimes) {
      log(COLORS.red, '❌', 'FAIL: Posts scheduled at wrong times or with minute offsets');
    } else if (hasCorrectTimes) {
      log(COLORS.green, '✅', 'PASS: All posts scheduled at correct hours with 0 minutes');
    }
  } catch (err) {
    log(COLORS.red, '❌', `Error: ${err.message}`);
  }
}

async function testTimeDistribution() {
  console.log(`\n${COLORS.cyan}=== TEST 3: Time Distribution ===${COLORS.reset}\n`);
  
  try {
    const configResult = await pool.query(`
      SELECT ac.strategy_id, ac.custom_posting_hours, ac.timezone
      FROM autopilot_config ac
      WHERE ac.custom_posting_hours IS NOT NULL 
        AND array_length(ac.custom_posting_hours, 1) > 1
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      log(COLORS.yellow, '⚠️ ', 'No autopilot config with multiple custom hours found');
      return;
    }
    
    const config = configResult.rows[0];
    const configuredHours = config.custom_posting_hours;
    
    console.log(`  Configured hours: ${JSON.stringify(configuredHours)}`);
    
    const distributionResult = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM suggested_time AT TIME ZONE $2) as hour,
        COUNT(*) as count
      FROM content_review_queue
      WHERE strategy_id = $1
        AND source = 'autopilot'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY hour
      ORDER BY hour
    `, [config.strategy_id, config.timezone]);
    
    if (distributionResult.rows.length === 0) {
      log(COLORS.yellow, '⚠️ ', 'No posts found in last 7 days');
      return;
    }
    
    const hoursUsed = distributionResult.rows.map(r => parseInt(r.hour));
    const allConfiguredHoursUsed = configuredHours.every(h => hoursUsed.includes(h));
    const onlyConfiguredHoursUsed = hoursUsed.every(h => configuredHours.includes(h));
    
    console.log(`\n  Hour distribution:`);
    distributionResult.rows.forEach(row => {
      const hour = parseInt(row.hour);
      const isConfigured = configuredHours.includes(hour);
      const color = isConfigured ? COLORS.green : COLORS.red;
      const status = isConfigured ? '✅' : '❌';
      console.log(`    ${color}${status}${COLORS.reset} Hour ${hour}: ${row.count} posts`);
    });
    
    if (allConfiguredHoursUsed && onlyConfiguredHoursUsed) {
      log(COLORS.green, '✅', 'PASS: Posts distributed across all configured hours');
    } else if (!allConfiguredHoursUsed) {
      log(COLORS.yellow, '⚠️ ', 'WARNING: Not all configured hours are being used');
    } else {
      log(COLORS.red, '❌', 'FAIL: Posts scheduled at non-configured hours');
    }
  } catch (err) {
    log(COLORS.red, '❌', `Error: ${err.message}`);
  }
}

async function testWorkerStatus() {
  console.log(`\n${COLORS.cyan}=== TEST 4: Worker Status ===${COLORS.reset}\n`);
  
  try {
    // Check for recent scheduled tweet completions
    const completedResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM scheduled_tweets
      WHERE status = 'completed'
        AND updated_at > NOW() - INTERVAL '1 hour'
    `);
    
    const recentCompletions = parseInt(completedResult.rows[0].count);
    
    if (recentCompletions > 0) {
      log(COLORS.green, '✅', `Worker is active: ${recentCompletions} tweets published in last hour`);
    } else {
      log(COLORS.yellow, '⚠️ ', 'No tweets published in last hour (worker may be idle or not running)');
    }
    
    // Check for pending tweets that should have been published
    const overdueResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM scheduled_tweets
      WHERE status = 'pending'
        AND scheduled_for < NOW() - INTERVAL '5 minutes'
    `);
    
    const overdueCount = parseInt(overdueResult.rows[0].count);
    
    if (overdueCount > 0) {
      log(COLORS.red, '❌', `${overdueCount} tweets are overdue (worker may not be running)`);
    } else {
      log(COLORS.green, '✅', 'No overdue tweets');
    }
  } catch (err) {
    log(COLORS.red, '❌', `Error: ${err.message}`);
  }
}

async function runAllTests() {
  console.log(`\n${COLORS.blue}╔════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.blue}║  Autopilot Fixes Verification Tests       ║${COLORS.reset}`);
  console.log(`${COLORS.blue}╚════════════════════════════════════════════╝${COLORS.reset}`);
  
  await testThreadGeneration();
  await testTimezoneScheduling();
  await testTimeDistribution();
  await testWorkerStatus();
  
  console.log(`\n${COLORS.blue}═══════════════════════════════════════════════${COLORS.reset}\n`);
  
  await pool.end();
}

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
