import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const result = await pool.query(`
      SELECT id, LEFT(prompt_text, 150) as prompt_preview, category
      FROM strategy_prompts
      LIMIT 10
    `);
    
    console.log('\n=== Sample Strategy Prompts ===\n');
    result.rows.forEach(p => {
      console.log(`ID: ${p.id}`);
      console.log(`Category: ${p.category}`);
      console.log(`Prompt: ${p.prompt_preview}...`);
      console.log(`Contains "thread": ${p.prompt_preview.toLowerCase().includes('thread')}`);
      console.log(`Contains "---": ${p.prompt_preview.includes('---')}`);
      console.log('');
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
