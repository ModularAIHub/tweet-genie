import { pool } from './config/database.js';

try {
  // Check users table structure
  const usersResult = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position");
  console.log('Users table structure:');
  usersResult.rows.forEach(row => console.log(`- ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`));
  
  console.log('\n');
  
  // Check credit_transactions table structure
  const creditResult = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'credit_transactions' ORDER BY ordinal_position");
  console.log('Credit_transactions table structure:');
  creditResult.rows.forEach(row => console.log(`- ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`));
  
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
