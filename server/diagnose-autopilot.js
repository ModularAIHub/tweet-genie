#!/usr/bin/env node
/**
 * Diagnostic script to check autopilot configuration and recent posts
 */

import pg from 'pg';
import dotenv from 'dotenv';
import moment from 'moment-timezone';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diagnose() {
  console.log('\n=== Autopilot Configuration Diagnosis ===\n');
  
  try {
    // Get all autopilot configs
    const configResult = await pool.query(`
      SELECT 
        ac.strategy_id,
        ac.is_enabled,
        ac.posts_per_day,
        ac.use_optimal_times,
        ac.custom_posting_hours,
        ac.timezone,
        ac.require_approval,
        us.niche,
        us.user_id
      FROM autopilot_config ac
      JOIN user_strategies us ON ac.strategy_id = us.id
      ORDER BY ac.updated_at DESC
      LIMIT 5
    `);
    
    if (configResult.rows.length === 0) {
      console.log('❌ No autopilot configurations found');
      return;
    }
    
    console.log(`Found ${configResult.rows.length} autopilot configurations:\n`);
    
    for (const config of configResult.rows) {
      console.log(`Strategy: ${config.strategy_id}`);
      console.log(`  Niche: ${config.niche}`);
      console.log(`  Enabled: ${config.is_enabled}`);
      console.log(`  Posts per day: ${config.posts_per_day}`);
      console.log(`  Use optimal times: ${config.use_optimal_times}`);
      console.log(`  Custom hours: ${JSON.stringify(config.custom_posting_hours)}`);
      console.log(`  Timezone: ${config.timezone}`);
      console.log(`  Require approval: ${config.require_approval}`);
      
      // Check recent posts for this strategy
      const postsResult = await pool.query(`
        SELECT 
          id,
          LEFT(content, 50) as content_preview,
          suggested_time,
          timezone,
          EXTRACT(HOUR FROM suggested_time AT TIME ZONE $2) as hour_in_user_tz,
          EXTRACT(MINUTE FROM suggested_time AT TIME ZONE $2) as minute_in_user_tz,
          status,
          created_at
        FROM content_review_queue
        WHERE strategy_id = $1
          AND source = 'autopilot'
        ORDER BY created_at DESC
        LIMIT 10
      `, [config.strategy_id, config.timezone || 'UTC']);
      
      if (postsResult.rows.length > 0) {
        console.log(`\n  Recent posts (${postsResult.rows.length}):`);
        postsResult.rows.forEach(post => {
          const hour = parseInt(post.hour_in_user_tz);
          const minute = parseInt(post.minute_in_user_tz);
          const isConfiguredHour = config.custom_posting_hours && config.custom_posting_hours.includes(hour);
          const isExactHour = minute === 0;
          const status = isConfiguredHour && isExactHour ? '✅' : '❌';
          
          console.log(`    ${status} ${hour}:${minute.toString().padStart(2, '0')} - ${post.content_preview}... (${post.status})`);
          console.log(`       Suggested time (UTC): ${moment(post.suggested_time).utc().format('YYYY-MM-DD HH:mm:ss')}`);
          console.log(`       Suggested time (${config.timezone}): ${moment(post.suggested_time).tz(config.timezone || 'UTC').format('YYYY-MM-DD HH:mm:ss')}`);
        });
      } else {
        console.log(`\n  No recent posts found`);
      }
      
      console.log('\n' + '='.repeat(80) + '\n');
    }
    
    // Check for posts with wrong times
    console.log('\n=== Posts with Potential Timezone Issues ===\n');
    
    const issuesResult = await pool.query(`
      SELECT 
        crq.id,
        crq.strategy_id,
        crq.suggested_time,
        crq.timezone,
        ac.custom_posting_hours,
        EXTRACT(HOUR FROM crq.suggested_time AT TIME ZONE crq.timezone) as hour_in_tz,
        EXTRACT(MINUTE FROM crq.suggested_time AT TIME ZONE crq.timezone) as minute_in_tz
      FROM content_review_queue crq
      JOIN autopilot_config ac ON crq.strategy_id = ac.strategy_id
      WHERE crq.source = 'autopilot'
        AND crq.created_at > NOW() - INTERVAL '7 days'
        AND (
          EXTRACT(MINUTE FROM crq.suggested_time AT TIME ZONE crq.timezone) != 0
          OR NOT (EXTRACT(HOUR FROM crq.suggested_time AT TIME ZONE crq.timezone)::int = ANY(ac.custom_posting_hours))
        )
      ORDER BY crq.created_at DESC
      LIMIT 20
    `);
    
    if (issuesResult.rows.length > 0) {
      console.log(`Found ${issuesResult.rows.length} posts with timing issues:\n`);
      issuesResult.rows.forEach(post => {
        const hour = parseInt(post.hour_in_tz);
        const minute = parseInt(post.minute_in_tz);
        console.log(`  ❌ Post ${post.id.substring(0, 8)}...`);
        console.log(`     Scheduled for: ${hour}:${minute.toString().padStart(2, '0')} ${post.timezone}`);
        console.log(`     Expected hours: ${JSON.stringify(post.custom_posting_hours)}`);
        console.log(`     UTC time: ${moment(post.suggested_time).utc().format('YYYY-MM-DD HH:mm:ss')}`);
        console.log('');
      });
    } else {
      console.log('✅ No timing issues found in recent posts');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

diagnose();
