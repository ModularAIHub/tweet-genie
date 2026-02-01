import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkColumnTypes() {
  try {
    // Check tweets table
    const tweetsResult = await pool.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'tweets' 
      AND column_name IN ('account_id', 'id')
      ORDER BY ordinal_position
    `);
    
    console.log('=== tweets table ===');
    tweetsResult.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''}`);
    });
    
    // Check team_accounts table
    const teamAccountsResult = await pool.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'team_accounts' 
      AND column_name IN ('id', 'twitter_user_id')
      ORDER BY ordinal_position
    `);
    
    console.log('\n=== team_accounts table ===');
    teamAccountsResult.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''}`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
}

checkColumnTypes();
