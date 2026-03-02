import pool from './config/database.js';

// Check recent profile_analyses - any errors?
try {
  const { rows } = await pool.query(`SELECT id, user_id, status, error_message, tweets_analysed, created_at FROM profile_analyses ORDER BY created_at DESC LIMIT 5`);
  console.log('Recent profile_analyses:', JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('profile_analyses query error:', e.message);
}

process.exit(0);
