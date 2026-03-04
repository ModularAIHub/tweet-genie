import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Check for triggers
    const triggers = await pool.query(`
      SELECT trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'content_review_queue'
    `);
    
    console.log('\n=== Triggers on content_review_queue ===');
    if (triggers.rows.length === 0) {
      console.log('No triggers found');
    } else {
      console.log(JSON.stringify(triggers.rows, null, 2));
    }
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
