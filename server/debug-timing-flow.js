import pg from 'pg';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Replicate the createSlotDate function from autopilotService.js
 */
function createSlotDate(baseMoment, hour) {
  return baseMoment.clone().startOf('day').hour(hour).minute(0).second(0).millisecond(0).toDate();
}

(async () => {
  try {
    console.log('\n=== INVESTIGATING AUTOPILOT TIMING ISSUE ===\n');
    
    // Get autopilot config with custom hours
    const configResult = await pool.query(`
      SELECT ac.strategy_id, ac.custom_posting_hours, ac.timezone, ac.posts_per_day, ac.use_optimal_times,
             us.user_id, us.niche
      FROM autopilot_config ac
      JOIN user_strategies us ON us.id = ac.strategy_id
      WHERE ac.custom_posting_hours IS NOT NULL 
        AND array_length(ac.custom_posting_hours, 1) > 0
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      console.log('No autopilot config with custom hours found');
      await pool.end();
      return;
    }
    
    const config = configResult.rows[0];
    console.log('Found autopilot config:');
    console.log(`  Strategy ID: ${config.strategy_id}`);
    console.log(`  User ID: ${config.user_id}`);
    console.log(`  Custom Hours: ${JSON.stringify(config.custom_posting_hours)}`);
    console.log(`  Timezone: ${config.timezone}`);
    console.log(`  Posts/Day: ${config.posts_per_day}`);
    console.log(`  Use Optimal: ${config.use_optimal_times}`);
    
    // Simulate what getNextOptimalPostingTime does
    const userTz = config.timezone && moment.tz.zone(config.timezone) ? config.timezone : 'UTC';
    const customHours = config.custom_posting_hours;
    
    console.log(`\n=== SIMULATING getNextOptimalPostingTime ===`);
    console.log(`User Timezone: ${userTz}`);
    console.log(`Custom Hours: ${JSON.stringify(customHours)}`);
    
    const nowMoment = moment.tz(userTz);
    const now = nowMoment.toDate();
    
    console.log(`\nCurrent time in ${userTz}: ${nowMoment.format('YYYY-MM-DD HH:mm:ss Z')}`);
    console.log(`Current time in UTC: ${moment(now).utc().format('YYYY-MM-DD HH:mm:ss Z')}`);
    
    // Check the next 3 days
    console.log(`\n=== CHECKING NEXT 3 DAYS FOR AVAILABLE SLOTS ===`);
    
    for (let daysAhead = 0; daysAhead < 3; daysAhead++) {
      const checkMoment = nowMoment.clone().add(daysAhead, 'days');
      console.log(`\n--- Day +${daysAhead}: ${checkMoment.format('YYYY-MM-DD')} ---`);
      
      for (const hour of customHours) {
        const slotTime = createSlotDate(checkMoment, hour);
        const slotMomentInUserTz = moment(slotTime).tz(userTz);
        const slotMomentInUTC = moment(slotTime).utc();
        
        console.log(`\n  Hour ${hour}:`);
        console.log(`    Created slot in ${userTz}: ${slotMomentInUserTz.format('YYYY-MM-DD HH:mm:ss Z')}`);
        console.log(`    Stored in DB (UTC): ${slotMomentInUTC.format('YYYY-MM-DD HH:mm:ss Z')}`);
        console.log(`    ISO String: ${slotTime.toISOString()}`);
        console.log(`    Is in future: ${slotTime > now}`);
        
        if (slotTime <= now) {
          console.log(`    ❌ SKIPPED - in the past`);
          continue;
        }
        
        // Check if slot is taken
        const existingResult = await pool.query(
          `SELECT id, suggested_time FROM content_review_queue 
           WHERE strategy_id = $1 
             AND suggested_time BETWEEN $2 AND $3
             AND status IN ('pending', 'approved', 'scheduled')`,
          [config.strategy_id, new Date(slotTime.getTime() - 30*60000), new Date(slotTime.getTime() + 30*60000)]
        );
        
        if (existingResult.rows.length > 0) {
          console.log(`    ⚠️  SLOT TAKEN - ${existingResult.rows.length} items in queue`);
          existingResult.rows.forEach(row => {
            console.log(`       - Queue ID: ${row.id}, Time: ${moment(row.suggested_time).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z')}`);
          });
        } else {
          console.log(`    ✅ SLOT AVAILABLE`);
        }
      }
    }
    
    // Now check what's actually in the database
    console.log(`\n\n=== ACTUAL SCHEDULED POSTS FOR THIS STRATEGY ===`);
    const scheduledResult = await pool.query(`
      SELECT id, LEFT(content, 50) as content_preview, suggested_time, timezone, status, created_at
      FROM content_review_queue
      WHERE strategy_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [config.strategy_id]);
    
    scheduledResult.rows.forEach(row => {
      const schedTime = moment(row.suggested_time);
      console.log(`\nQueue ID: ${row.id}`);
      console.log(`  Content: ${row.content_preview}...`);
      console.log(`  Scheduled (UTC): ${schedTime.utc().format('YYYY-MM-DD HH:mm:ss Z')}`);
      console.log(`  Scheduled (${row.timezone}): ${schedTime.tz(row.timezone).format('YYYY-MM-DD HH:mm:ss Z')}`);
      console.log(`  Hour in ${row.timezone}: ${schedTime.tz(row.timezone).hour()}`);
      console.log(`  Status: ${row.status}`);
      console.log(`  Created: ${row.created_at}`);
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
