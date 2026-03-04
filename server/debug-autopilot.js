import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Get recent scheduled tweets
    const result = await pool.query(`
      SELECT id, LEFT(content, 50) as content_preview, scheduled_for, timezone, 
             thread_tweets IS NOT NULL as is_thread, status, created_at
      FROM scheduled_tweets 
      WHERE source = 'autopilot'
      ORDER BY created_at DESC 
      LIMIT 20
    `);
    
    console.log('\n=== Recent autopilot scheduled tweets ===');
    result.rows.forEach(row => {
      const schedTime = new Date(row.scheduled_for);
      console.log(`\nID: ${row.id}`);
      console.log(`Content: ${row.content_preview}...`);
      console.log(`Scheduled: ${schedTime.toISOString()} (${row.timezone})`);
      console.log(`Is Thread: ${row.is_thread}`);
      console.log(`Status: ${row.status}`);
      console.log(`Created: ${row.created_at}`);
    });
    
    // Get autopilot config
    const configResult = await pool.query(`
      SELECT strategy_id, custom_posting_hours, timezone, posts_per_day, use_optimal_times
      FROM autopilot_config
      LIMIT 5
    `);
    
    console.log('\n\n=== Autopilot Configs ===');
    configResult.rows.forEach(config => {
      console.log(`\nStrategy ID: ${config.strategy_id}`);
      console.log(`Custom Hours: ${JSON.stringify(config.custom_posting_hours)}`);
      console.log(`Timezone: ${config.timezone}`);
      console.log(`Posts/Day: ${config.posts_per_day}`);
      console.log(`Use Optimal: ${config.use_optimal_times}`);
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
