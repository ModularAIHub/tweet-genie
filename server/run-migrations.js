import pool from './config/database.js';
import fs from 'fs';

async function runMigrations() {
  try {
    console.log('🔄 Running migrations...\n');
    
    // Run analytics migration
    const sql1 = fs.readFileSync('./migrations/20260214_add_analytics_integration.sql', 'utf8');
    console.log('📊 Running analytics integration migration...');
    await pool.query(sql1);
    console.log('✅ Analytics integration complete\n');
    
    // Run autopilot migration
    const sql2 = fs.readFileSync('./migrations/20260214_add_autopilot_enhancement.sql', 'utf8');
    console.log('🤖 Running autopilot enhancement migration...');
    await pool.query(sql2);
    console.log('✅ Autopilot enhancement complete\n');
    
    console.log('🎉 All migrations completed successfully!');
    process.exit(0);
  } catch(err) {
    console.error('❌ Migration error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

runMigrations();
