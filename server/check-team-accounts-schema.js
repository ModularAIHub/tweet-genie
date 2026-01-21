import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkSchema() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'team_accounts' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nteam_accounts columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (default: ${row.column_default || 'none'})`);
    });
    
    // Also check if there are any rows and show their id values
    const dataResult = await pool.query('SELECT id, team_id, twitter_user_id FROM team_accounts LIMIT 5');
    console.log('\nSample data:');
    dataResult.rows.forEach(row => {
      console.log(`  id: ${row.id} (type: ${typeof row.id}), team_id: ${row.team_id}, twitter_user_id: ${row.twitter_user_id}`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkSchema();
