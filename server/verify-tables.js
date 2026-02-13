import pool from './config/database.js';

async function verifyTables() {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN (
          'autopilot_config', 
          'strategy_analytics', 
          'optimal_posting_schedule', 
          'content_insights', 
          'autopilot_history',
          'content_variations'
        )
      ORDER BY table_name
    `);
    
    console.log('\n✅ Phase 3 & 4 Tables Created:');
    console.log('================================');
    result.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });
    console.log('');
    
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

verifyTables();
