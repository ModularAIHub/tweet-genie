import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkTokens() {
  try {
    // Get the user ID from the logs
    const userId = '6834ca4a-22b4-4553-bf72-cebccb191df3';
    
    console.log('Checking tokens for user:', userId);
    
    const result = await pool.query(`
      SELECT 
        user_id,
        twitter_username,
        token_expires_at,
        oauth1_access_token IS NOT NULL as has_oauth1_token,
        oauth1_access_token_secret IS NOT NULL as has_oauth1_secret,
        access_token IS NOT NULL as has_oauth2_token,
        refresh_token IS NOT NULL as has_refresh_token,
        created_at,
        updated_at
      FROM twitter_auth 
      WHERE user_id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      console.log('❌ No Twitter connection found for this user');
    } else {
      console.log('\n✅ Twitter connection found:');
      const data = result.rows[0];
      console.log('Username:', data.twitter_username);
      console.log('Has OAuth 1.0a token:', data.has_oauth1_token);
      console.log('Has OAuth 1.0a secret:', data.has_oauth1_secret);
      console.log('Has OAuth 2.0 token:', data.has_oauth2_token);
      console.log('Has refresh token:', data.has_refresh_token);
      console.log('Token expires at:', data.token_expires_at);
      console.log('Created at:', data.created_at);
      console.log('Updated at:', data.updated_at);
      
      if (data.token_expires_at) {
        const now = new Date();
        const expiresAt = new Date(data.token_expires_at);
        const isExpired = expiresAt <= now;
        const minutesRemaining = Math.floor((expiresAt - now) / (60 * 1000));
        
        console.log('\nOAuth 2.0 Token Status:');
        console.log('Is expired:', isExpired);
        console.log('Minutes until expiry:', minutesRemaining);
      }
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
}

checkTokens();
