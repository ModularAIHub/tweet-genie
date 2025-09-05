  
import { pool } from '../config/database.js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the parent directory
dotenv.config({ path: path.join(process.cwd(), '..', '.env') });

const migrations = [
  {
    version: 1,
    name: 'create_migration_history_table',
    sql: `
      CREATE TABLE IF NOT EXISTS migration_history (
        version INTEGER PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    version: 2,
    name: 'create_twitter_auth_table',
    sql: `
      CREATE TABLE IF NOT EXISTS twitter_auth (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        twitter_user_id VARCHAR(255) NOT NULL,
        twitter_username VARCHAR(255) NOT NULL,
        twitter_display_name VARCHAR(255),
        twitter_profile_image_url TEXT,
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        tweet_count INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_twitter_auth_user_id ON twitter_auth(user_id);
      CREATE INDEX IF NOT EXISTS idx_twitter_auth_twitter_user_id ON twitter_auth(twitter_user_id);
    `
  },
  {
    version: 3,
    name: 'create_tweets_table',
    sql: `
      CREATE TABLE IF NOT EXISTS tweets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        tweet_id VARCHAR(50),
        content TEXT NOT NULL,
        media_urls JSONB DEFAULT '[]',
        thread_tweets JSONB DEFAULT '[]',
        credits_used NUMERIC(10,2) DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        retweets INTEGER DEFAULT 0,
        replies INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft',
        posted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id);
      CREATE INDEX IF NOT EXISTS idx_tweets_tweet_id ON tweets(tweet_id);
      CREATE INDEX IF NOT EXISTS idx_tweets_status ON tweets(status);
      CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at);
    `
  },
  {
    version: 4,
    name: 'create_scheduled_tweets_table',
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_tweets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        tweet_id UUID,
        scheduled_for TIMESTAMP NOT NULL,
        timezone VARCHAR(50) DEFAULT 'UTC',
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        posted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_user_id ON scheduled_tweets(user_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_scheduled_for ON scheduled_tweets(scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_status ON scheduled_tweets(status);
    `
  },
  {
    version: 9,
    name: 'add_content_and_media_to_scheduled_tweets',
    sql: `
      ALTER TABLE scheduled_tweets
        ADD COLUMN IF NOT EXISTS content TEXT,
        ADD COLUMN IF NOT EXISTS media JSONB;
    `
  },
  {
    version: 10,
    name: 'remove_tweet_id_from_scheduled_tweets',
    sql: `
      ALTER TABLE scheduled_tweets
        DROP COLUMN IF EXISTS tweet_id;
    `
  },
  {
    version: 5,
    name: 'create_ai_generations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_generations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        prompt TEXT NOT NULL,
        provider VARCHAR(20) NOT NULL,
        generated_content JSONB,
        credits_used NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_ai_generations_user_id ON ai_generations(user_id);
      CREATE INDEX IF NOT EXISTS idx_ai_generations_provider ON ai_generations(provider);
      CREATE INDEX IF NOT EXISTS idx_ai_generations_created_at ON ai_generations(created_at);
    `
  },
  {
    version: 6,
    name: 'drop_twitter_accounts_table',
    sql: `
      -- Remove twitter_account_id references from tweets table
      ALTER TABLE tweets DROP COLUMN IF EXISTS twitter_account_id;
      
      -- Update credits_used to use NUMERIC for fractional credits
      ALTER TABLE tweets ALTER COLUMN credits_used TYPE NUMERIC(10,2);
      ALTER TABLE ai_generations ALTER COLUMN credits_used TYPE NUMERIC(10,2);
      
      -- Drop the redundant twitter_accounts table
      DROP TABLE IF EXISTS twitter_accounts CASCADE;
    `
  },
  {
    version: 7,
    name: 'add_oauth1_fields_to_twitter_auth',
    sql: `
      -- Add OAuth 1.0a fields for media upload capability
      ALTER TABLE twitter_auth ADD COLUMN IF NOT EXISTS oauth1_access_token TEXT;
      ALTER TABLE twitter_auth ADD COLUMN IF NOT EXISTS oauth1_access_token_secret TEXT;
      
      -- Add index for OAuth 1.0a tokens
      CREATE INDEX IF NOT EXISTS idx_twitter_auth_oauth1_token ON twitter_auth(oauth1_access_token);
    `
  },
  {
    version: 8,
    name: 'enhance_tweets_for_external_analytics',
    sql: `
      -- Add fields to support external tweets (posted outside our platform)
      ALTER TABLE tweets ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'platform';
      ALTER TABLE tweets ADD COLUMN IF NOT EXISTS external_created_at TIMESTAMP;
      ALTER TABLE tweets ADD COLUMN IF NOT EXISTS author_id VARCHAR(50);
      ALTER TABLE tweets ADD COLUMN IF NOT EXISTS lang VARCHAR(10);
      ALTER TABLE tweets ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0;
      ALTER TABLE tweets ADD COLUMN IF NOT EXISTS bookmark_count INTEGER DEFAULT 0;
      
      -- Make content optional for external tweets (we might not have full content)
      ALTER TABLE tweets ALTER COLUMN content DROP NOT NULL;
      
      -- Add indexes for new fields
      CREATE INDEX IF NOT EXISTS idx_tweets_source ON tweets(source);
      CREATE INDEX IF NOT EXISTS idx_tweets_external_created_at ON tweets(external_created_at);
      CREATE INDEX IF NOT EXISTS idx_tweets_author_id ON tweets(author_id);
      
      -- Add constraint to ensure either platform or external data is present
      ALTER TABLE tweets ADD CONSTRAINT check_tweet_data 
        CHECK (
          (source = 'platform' AND content IS NOT NULL) OR 
          (source = 'external' AND tweet_id IS NOT NULL)
        );
    `
  }
];

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('Starting Tweet Genie database migrations...');

    // Create migration history table first if it doesn't exist
    const migrationHistoryMigration = migrations.find(m => m.name === 'create_migration_history_table');
    if (migrationHistoryMigration) {
      console.log('Creating migration history table...');
      await client.query(migrationHistoryMigration.sql);
    }

    // Get already executed migrations
    const { rows: executedMigrations } = await client.query(
      'SELECT version FROM migration_history ORDER BY version'
    );
    
    const executedVersions = executedMigrations.map(row => row.version);
    console.log('Already executed migrations:', executedVersions);

    // Run pending migrations in version order
    const sortedMigrations = migrations.sort((a, b) => a.version - b.version);
    
    for (const migration of sortedMigrations) {
      if (!executedVersions.includes(migration.version)) {
        console.log(`Running migration ${migration.version}: ${migration.name}`);
        
        await client.query('BEGIN');
        
        try {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO migration_history (version, name) VALUES ($1, $2)',
            [migration.version, migration.name]
          );
          
          await client.query('COMMIT');
          console.log(`✓ Migration ${migration.version} completed`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } else {
        console.log(`⏭ Migration ${migration.version} already executed`);
      }
    }

    console.log('All migrations completed successfully!');

  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migrations if this file is executed directly
console.log('🚀 Starting migrations...');
console.log('📂 Script path:', process.argv[1]);
console.log('📍 Current working directory:', process.cwd());
console.log('🔗 Import meta URL:', import.meta.url);
console.log('🔧 DATABASE_URL:', process.env.DATABASE_URL ? 'Found' : 'Missing');
console.log('🔧 NODE_ENV:', process.env.NODE_ENV);

runMigrations()
  .then(() => {
    console.log('✅ Migrations finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });

export { runMigrations };
