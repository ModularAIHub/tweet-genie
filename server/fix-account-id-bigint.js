import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function fixAccountIdColumns() {
  try {
    console.log('Checking current column types...\n');
    
    // Check team_accounts table
    const teamAccountsCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'team_accounts' 
      AND column_name IN ('id', 'twitter_user_id')
    `);
    
    console.log('team_accounts columns:');
    teamAccountsCheck.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    
    // Check tweets table
    const tweetsCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tweets' 
      AND column_name IN ('account_id', 'twitter_tweet_id')
    `);
    
    console.log('\ntweets columns:');
    tweetsCheck.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    
    console.log('\n=== Starting Migration ===\n');
    
    // Start transaction
    await pool.query('BEGIN');
    
    // Fix team_accounts.id if needed
    const needsFixTeamAccountsId = teamAccountsCheck.rows.some(
      r => r.column_name === 'id' && r.data_type === 'integer'
    );
    
    if (needsFixTeamAccountsId) {
      console.log('Converting team_accounts.id to BIGINT...');
      await pool.query('ALTER TABLE team_accounts ALTER COLUMN id TYPE BIGINT USING id::bigint');
      console.log('✅ team_accounts.id converted to BIGINT');
    } else {
      console.log('✓ team_accounts.id is already BIGINT');
    }
    
    // Fix team_accounts.twitter_user_id if needed
    const needsFixTwitterUserId = teamAccountsCheck.rows.some(
      r => r.column_name === 'twitter_user_id' && r.data_type === 'character varying'
    );
    
    if (!needsFixTwitterUserId) {
      console.log('Converting team_accounts.twitter_user_id to VARCHAR...');
      await pool.query('ALTER TABLE team_accounts ALTER COLUMN twitter_user_id TYPE VARCHAR(50) USING twitter_user_id::varchar');
      console.log('✅ team_accounts.twitter_user_id converted to VARCHAR');
    } else {
      console.log('✓ team_accounts.twitter_user_id is already VARCHAR');
    }
    
    // Fix tweets.account_id if needed
    const needsFixTweetsAccountId = tweetsCheck.rows.some(
      r => r.column_name === 'account_id' && r.data_type === 'integer'
    );
    
    if (needsFixTweetsAccountId) {
      console.log('Converting tweets.account_id to BIGINT...');
      await pool.query('ALTER TABLE tweets ALTER COLUMN account_id TYPE BIGINT USING account_id::bigint');
      console.log('✅ tweets.account_id converted to BIGINT');
    } else {
      console.log('✓ tweets.account_id is already BIGINT');
    }
    
    // Commit transaction
    await pool.query('COMMIT');
    
    console.log('\n=== Migration Complete ===\n');
    
    // Verify changes
    console.log('Verifying changes...\n');
    
    const verifyTeamAccounts = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'team_accounts' 
      AND column_name IN ('id', 'twitter_user_id')
    `);
    
    console.log('team_accounts columns (after):');
    verifyTeamAccounts.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    
    const verifyTweets = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tweets' 
      AND column_name IN ('account_id', 'twitter_tweet_id')
    `);
    
    console.log('\ntweets columns (after):');
    verifyTweets.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    
    await pool.end();
    console.log('\n✅ All done!');
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

fixAccountIdColumns();
