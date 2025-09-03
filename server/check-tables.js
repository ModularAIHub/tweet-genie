import { pool } from './config/database.js';

try {
  const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log('Tables in Tweet Genie database:');
  result.rows.forEach(row => console.log('- ' + row.table_name));
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
