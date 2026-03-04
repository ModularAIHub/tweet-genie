import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const result = await pool.query(`
      SELECT sp.prompt_text, crq.content, crq.created_at
      FROM content_review_queue crq
      JOIN strategy_prompts sp ON crq.prompt_id = sp.id
      WHERE crq.source = 'autopilot'
      ORDER BY crq.created_at DESC
      LIMIT 5
    `);
    
    console.log('\n=== Last 5 Autopilot Generations ===\n');
    result.rows.forEach((row, i) => {
      console.log(`\n--- Generation ${i + 1} (${row.created_at}) ---`);
      console.log(`Prompt: ${row.prompt_text.substring(0, 150)}...`);
      console.log(`\nGenerated Content:`);
      console.log(row.content.substring(0, 300));
      console.log(`\nHas thread separator: ${row.content.includes('---')}`);
      console.log('---');
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
