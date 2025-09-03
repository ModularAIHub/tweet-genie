import { pool } from './config/database.js';

try {
  // Check users
  const users = await pool.query('SELECT id, email, credits_remaining FROM users LIMIT 5');
  console.log('Users in database:');
  users.rows.forEach(user => console.log(`- ${user.email}: ${user.credits_remaining} credits`));
  
  // Add 100 credits to all users for testing
  if (users.rows.length > 0) {
    console.log('\nAdding 100 credits to all users for testing...');
    await pool.query('UPDATE users SET credits_remaining = COALESCE(credits_remaining, 0) + 100');
    console.log('✅ Credits added successfully');
    
    // Show updated balances
    const updated = await pool.query('SELECT id, email, credits_remaining FROM users LIMIT 5');
    console.log('\nUpdated balances:');
    updated.rows.forEach(user => console.log(`- ${user.email}: ${user.credits_remaining} credits`));
  }
  
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
