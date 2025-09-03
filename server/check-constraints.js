import { pool } from './config/database.js';

try {
  // Check the constraint on credit_transactions table
  const constraints = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) as definition 
    FROM pg_constraint 
    WHERE conrelid = 'credit_transactions'::regclass 
    AND contype = 'c'
  `);
  
  console.log('Check constraints on credit_transactions:');
  constraints.rows.forEach(row => {
    console.log(`- ${row.conname}: ${row.definition}`);
  });
  
  // Also check existing transaction types
  const types = await pool.query('SELECT DISTINCT type FROM credit_transactions LIMIT 10');
  console.log('\nExisting transaction types:');
  types.rows.forEach(row => console.log(`- ${row.type}`));
  
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
