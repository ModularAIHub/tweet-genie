import { pool } from '../config/database.js';

const twitterTables = [
  {
    name: 'twitter_auth',
    sql: `
      CREATE TABLE IF NOT EXISTS twitter_auth (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        twitter_user_id VARCHAR(50) NOT NULL,
        twitter_username VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_twitter_auth_user_id ON twitter_auth(user_id);
      CREATE INDEX IF NOT EXISTS idx_twitter_auth_twitter_user_id ON twitter_auth(twitter_user_id);
      
      COMMENT ON TABLE twitter_auth IS 'Stores Twitter OAuth 2.0 authentication tokens and user information';
      COMMENT ON COLUMN twitter_auth.user_id IS 'Reference to the platform user';
      COMMENT ON COLUMN twitter_auth.access_token IS 'Twitter OAuth 2.0 access token';
      COMMENT ON COLUMN twitter_auth.refresh_token IS 'Twitter OAuth 2.0 refresh token';
      COMMENT ON COLUMN twitter_auth.token_expires_at IS 'When the access token expires';
      COMMENT ON COLUMN twitter_auth.twitter_user_id IS 'Twitter user ID from Twitter API';
      COMMENT ON COLUMN twitter_auth.twitter_username IS 'Twitter username from Twitter API';
    `
  },
  {
    name: 'twitter_oauth_state',
    sql: `
      CREATE TABLE IF NOT EXISTS twitter_oauth_state (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        state VARCHAR(100) NOT NULL UNIQUE,
        user_id UUID NOT NULL,
        code_verifier TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes')
      );
      
      CREATE INDEX IF NOT EXISTS idx_twitter_oauth_state_state ON twitter_oauth_state(state);
      CREATE INDEX IF NOT EXISTS idx_twitter_oauth_state_user_id ON twitter_oauth_state(user_id);
      CREATE INDEX IF NOT EXISTS idx_twitter_oauth_state_expires_at ON twitter_oauth_state(expires_at);
      
      COMMENT ON TABLE twitter_oauth_state IS 'Temporary storage for Twitter OAuth 2.0 PKCE flow state';
      COMMENT ON COLUMN twitter_oauth_state.state IS 'OAuth state parameter for CSRF protection';
      COMMENT ON COLUMN twitter_oauth_state.user_id IS 'Reference to the platform user initiating OAuth';
      COMMENT ON COLUMN twitter_oauth_state.code_verifier IS 'PKCE code verifier for secure token exchange';
      COMMENT ON COLUMN twitter_oauth_state.expires_at IS 'When this OAuth state expires (10 minutes)';
    `
  }
];

// Function to create cleanup procedure for expired OAuth states
const createCleanupFunction = `
  CREATE OR REPLACE FUNCTION delete_expired_oauth_states() 
  RETURNS TRIGGER AS $$
  BEGIN
    DELETE FROM twitter_oauth_state WHERE expires_at < CURRENT_TIMESTAMP;
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;
  
  DROP TRIGGER IF EXISTS trigger_delete_expired_oauth_states ON twitter_oauth_state;
  CREATE TRIGGER trigger_delete_expired_oauth_states
    AFTER INSERT ON twitter_oauth_state
    EXECUTE FUNCTION delete_expired_oauth_states();
`;

async function createTwitterTables() {
  const client = await pool.connect();
  
  try {
    console.log('Creating Twitter authentication tables...');

    // Create tables
    for (const table of twitterTables) {
      console.log(`Creating table: ${table.name}`);
      await client.query(table.sql);
      console.log(`✅ Table ${table.name} created successfully`);
    }

    // Create cleanup function and trigger
    console.log('Creating OAuth state cleanup function...');
    await client.query(createCleanupFunction);
    console.log('✅ OAuth state cleanup function created successfully');

    // Check if tables exist and show their structure
    console.log('\n📋 Verifying table creation:');
    
    for (const table of twitterTables) {
      const result = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position
      `, [table.name]);
      
      console.log(`\n🔍 Table: ${table.name}`);
      console.log('Columns:');
      result.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
      });
    }

    console.log('\n🎉 All Twitter authentication tables created successfully!');

  } catch (error) {
    console.error('❌ Error creating Twitter tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Function to drop Twitter tables (for development/testing)
async function dropTwitterTables() {
  const client = await pool.connect();
  
  try {
    console.log('Dropping Twitter authentication tables...');
    
    // Drop trigger and function first
    await client.query('DROP TRIGGER IF EXISTS trigger_delete_expired_oauth_states ON twitter_oauth_state');
    await client.query('DROP FUNCTION IF EXISTS delete_expired_oauth_states()');
    
    // Drop tables in reverse order
    await client.query('DROP TABLE IF EXISTS twitter_oauth_state CASCADE');
    await client.query('DROP TABLE IF EXISTS twitter_auth CASCADE');
    
    console.log('✅ Twitter tables dropped successfully');
    
  } catch (error) {
    console.error('❌ Error dropping Twitter tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the appropriate function based on command line arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  if (command === 'drop') {
    console.log('🗑️  Dropping Twitter tables...');
    dropTwitterTables()
      .then(() => {
        console.log('✅ Drop operation completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Drop operation failed:', error);
        process.exit(1);
      });
  } else {
    console.log('🚀 Creating Twitter tables...');
    createTwitterTables()
      .then(() => {
        console.log('✅ Setup completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Setup failed:', error);
        process.exit(1);
      });
  }
}

export { createTwitterTables, dropTwitterTables };
