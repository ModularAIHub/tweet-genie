import pg from 'pg';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    console.log('\n=== CHECKING IST TIMEZONE CONFIG ===\n');
    
    // Get the IST config
    const configResult = await pool.query(`
      SELECT ac.strategy_id, ac.custom_posting_hours, ac.timezone, ac.posts_per_day, ac.use_optimal_times,
             us.user_id, us.niche
      FROM autopilot_config ac
      JOIN user_strategies us ON us.id = ac.strategy_id
      WHERE ac.timezone LIKE '%Kolkata%' OR ac.timezone LIKE '%Calcutta%'
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      console.log('No IST config found');
      await pool.end();
      return;
    }
    
    const config = configResult.rows[0];
    console.log('IST Autopilot Config:');
    console.log(`  Strategy ID: ${config.strategy_id}`);
    console.log(`  Custom Hours: ${JSON.stringify(config.custom_posting_hours)}`);
    console.log(`  Timezone: ${config.timezone}`);
    console.log(`  Use Optimal: ${config.use_optimal_times}`);
    
    // Check actual scheduled posts
    console.log(`\n=== ACTUAL SCHEDULED POSTS ===`);
    const scheduledResult = await pool.query(`
      SELECT id, LEFT(content, 40) as content_preview, suggested_time, timezone, status
      FROM content_review_queue
      WHERE strategy_id = $1
      ORDER BY created_at DESC
      LIMIT 15
    `, [config.strategy_id]);
    
    console.log(`\nUser configured hours: ${JSON.stringify(config.custom_posting_hours)}`);
    console.log(`Expected: Posts at ${config.custom_posting_hours.join(', ')} in ${config.timezone}`);
    console.log(`\nActual scheduled times:`);
    
    const hourCounts = {};
    scheduledResult.rows.forEach(row => {
      const schedTime = moment(row.suggested_time);
      const hourInUserTz = schedTime.tz(config.timezone).hour();
      const hourInUTC = schedTime.utc().hour();
      
      hourCounts[hourInUserTz] = (hourCounts[hourInUserTz] || 0) + 1;
      
      console.log(`  ${schedTime.tz(config.timezone).format('YYYY-MM-DD HH:mm')} ${config.timezone} (${hourInUTC}:00 UTC) - ${row.content_preview}...`);
    });
    
    console.log(`\n=== HOUR DISTRIBUTION IN ${config.timezone} ===`);
    Object.keys(hourCounts).sort((a, b) => a - b).forEach(hour => {
      const isExpected = config.custom_posting_hours.includes(parseInt(hour));
      const marker = isExpected ? '✅' : '❌';
      console.log(`  ${marker} Hour ${hour}: ${hourCounts[hour]} posts ${isExpected ? '(EXPECTED)' : '(NOT IN CONFIG!)'}`);
    });
    
    console.log(`\n=== EXPECTED vs ACTUAL ===`);
    console.log(`Expected hours: ${JSON.stringify(config.custom_posting_hours)}`);
    console.log(`Actual hours: ${JSON.stringify(Object.keys(hourCounts).map(h => parseInt(h)).sort((a,b) => a-b))}`);
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
