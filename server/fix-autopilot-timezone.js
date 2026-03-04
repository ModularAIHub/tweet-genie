#!/usr/bin/env node
/**
 * Fix autopilot timezone settings
 * This script updates autopilot_config timezone from UTC to user's actual timezone
 */

import pg from 'pg';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function fixTimezones() {
  console.log('\n=== Autopilot Timezone Fix Script ===\n');
  
  try {
    // Find autopilot configs with UTC or NULL timezone
    const result = await pool.query(`
      SELECT 
        ac.strategy_id,
        ac.timezone as current_timezone,
        ac.custom_posting_hours,
        ac.is_enabled,
        us.niche,
        us.user_id,
        u.email
      FROM autopilot_config ac
      JOIN user_strategies us ON ac.strategy_id = us.id
      JOIN users u ON us.user_id = u.id
      WHERE ac.timezone IS NULL OR ac.timezone = 'UTC'
      ORDER BY ac.is_enabled DESC, ac.updated_at DESC
    `);
    
    if (result.rows.length === 0) {
      console.log('✅ No autopilot configs need timezone fixes');
      rl.close();
      await pool.end();
      return;
    }
    
    console.log(`Found ${result.rows.length} autopilot configs with UTC or NULL timezone:\n`);
    
    result.rows.forEach((config, index) => {
      console.log(`${index + 1}. Strategy: ${config.strategy_id}`);
      console.log(`   User: ${config.email}`);
      console.log(`   Niche: ${config.niche}`);
      console.log(`   Current timezone: ${config.current_timezone || 'NULL'}`);
      console.log(`   Custom hours: ${JSON.stringify(config.custom_posting_hours)}`);
      console.log(`   Enabled: ${config.is_enabled}`);
      console.log('');
    });
    
    console.log('Common timezones:');
    console.log('  1. Asia/Kolkata (IST - India)');
    console.log('  2. America/New_York (EST/EDT - US East Coast)');
    console.log('  3. America/Los_Angeles (PST/PDT - US West Coast)');
    console.log('  4. Europe/London (GMT/BST - UK)');
    console.log('  5. Asia/Tokyo (JST - Japan)');
    console.log('  6. Australia/Sydney (AEDT - Australia)');
    console.log('');
    
    const timezone = await question('Enter the timezone to set for ALL configs (or "skip" to cancel): ');
    
    if (timezone.toLowerCase() === 'skip') {
      console.log('Cancelled');
      rl.close();
      await pool.end();
      return;
    }
    
    // Validate timezone
    const validationResult = await pool.query(`
      SELECT NOW() AT TIME ZONE $1 as test
    `, [timezone]);
    
    if (!validationResult.rows[0]) {
      console.log(`❌ Invalid timezone: ${timezone}`);
      rl.close();
      await pool.end();
      return;
    }
    
    console.log(`\n✅ Timezone '${timezone}' is valid`);
    
    const confirm = await question(`\nUpdate ${result.rows.length} configs to timezone '${timezone}'? (yes/no): `);
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Cancelled');
      rl.close();
      await pool.end();
      return;
    }
    
    // Update all configs
    const updateResult = await pool.query(`
      UPDATE autopilot_config
      SET timezone = $1, updated_at = NOW()
      WHERE timezone IS NULL OR timezone = 'UTC'
      RETURNING strategy_id
    `, [timezone]);
    
    console.log(`\n✅ Updated ${updateResult.rows.length} autopilot configs to timezone '${timezone}'`);
    
    // Optionally clear bad posts
    const clearPosts = await question('\nClear pending autopilot posts with wrong times? (yes/no): ');
    
    if (clearPosts.toLowerCase() === 'yes') {
      const deleteResult = await pool.query(`
        DELETE FROM content_review_queue
        WHERE source = 'autopilot'
          AND status IN ('pending', 'approved')
          AND created_at > NOW() - INTERVAL '7 days'
        RETURNING id
      `);
      
      console.log(`✅ Deleted ${deleteResult.rows.length} pending autopilot posts`);
      console.log('   Autopilot will regenerate posts with correct timezone');
    }
    
    console.log('\n=== Fix Complete ===');
    console.log('\nNext steps:');
    console.log('1. Restart the worker: node worker.js');
    console.log('2. Monitor logs for correct timezone: tail -f logs/app.log | grep Autopilot');
    console.log('3. Verify new posts have correct times');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rl.close();
    await pool.end();
  }
}

fixTimezones();
