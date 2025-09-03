import { pool } from './config/database.js';

try {
  // Remove the extra 100 credits I added for testing
  console.log('Removing test credits added earlier...');
  const result = await pool.query('UPDATE users SET credits_remaining = credits_remaining - 100 WHERE credits_remaining > 50');
  console.log(`Updated ${result.rowCount} users`);
  
  // Show current balances
  const users = await pool.query('SELECT email, credits_remaining FROM users');
  console.log('Current balances after cleanup:');
  users.rows.forEach(user => console.log(`- ${user.email}: ${user.credits_remaining} credits`));
  
  // Remove any test credit transactions from tweet-genie
  const cleanupResult = await pool.query("DELETE FROM credit_transactions WHERE service_name = 'tweet-genie'");
  console.log(`Removed ${cleanupResult.rowCount} test transactions`);
  
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
