import pool from './config/database.js';
import fs from 'fs';

async function runMigrations() {
  const logFile = './migration-log.txt';
  const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
  };

  try {
    fs.writeFileSync(logFile, ''); // Clear log file
    log('🔄 Running migrations...\n');
    
    // Run analytics migration
    log('📊 Reading analytics integration migration...');
    const sql1 = fs.readFileSync('./migrations/20260214_add_analytics_integration.sql', 'utf8');
    log(`SQL file size: ${sql1.length} bytes`);
    
    log('📊 Executing analytics integration migration...');
    await pool.query(sql1);
    log('✅ Analytics integration complete\n');
    
    // Run autopilot migration
    log('🤖 Reading autopilot enhancement migration...');
    const sql2 = fs.readFileSync('./migrations/20260214_add_autopilot_enhancement.sql', 'utf8');
    log(`SQL file size: ${sql2.length} bytes`);
    
    log('🤖 Executing autopilot enhancement migration...');
    await pool.query(sql2);
    log('✅ Autopilot enhancement complete\n');

    // Run metric column compatibility migration
    log('🩹 Reading tweet metric compatibility migration...');
    const sql3 = fs.readFileSync('./migrations/20260214_fix_missing_tweet_metric_columns.sql', 'utf8');
    log(`SQL file size: ${sql3.length} bytes`);

    log('🩹 Executing tweet metric compatibility migration...');
    await pool.query(sql3);
    log('✅ Tweet metric compatibility complete\n');
    
    log('🎉 All migrations completed successfully!');
    await pool.end();
    process.exit(0);
  } catch(err) {
    const errMsg = `❌ Migration error: ${err.message}\n${err.stack}`;
    log(errMsg);
    console.error(err);
    await pool.end();
    process.exit(1);
  }
}

runMigrations();
