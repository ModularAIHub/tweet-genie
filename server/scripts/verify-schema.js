import { pool } from '../config/database.js';

async function verifySchema() {
  try {
    const result = await pool.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'tweets' ORDER BY ordinal_position;");
    console.log('Current tweets table schema:');
    result.rows.forEach(row => {
      const defaultVal = row.column_default ? ` (default: ${row.column_default})` : '';
      console.log(`- ${row.column_name}: ${row.data_type}${defaultVal}`);
    });
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifySchema();
