import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkSchema() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name='tweets' 
      ORDER BY ordinal_position
    `);
    
    console.log('Tweets table columns:');
    result.rows.forEach(c => console.log(`- ${c.column_name} (${c.data_type})`));
    
    // Also check if there are any tweets
    const count = await pool.query('SELECT COUNT(*) FROM tweets');
    console.log('\nTotal tweets:', count.rows[0].count);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
}

checkSchema();
