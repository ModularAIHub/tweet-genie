import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

console.log('🗑️  Starting database reset...');
console.log('📂 Script path:', __filename);
console.log('📍 Current working directory:', process.cwd());
console.log('🔗 Import meta URL:', import.meta.url);

// Check DATABASE_URL
if (process.env.DATABASE_URL) {
  console.log('🔧 DATABASE_URL: Found');
} else {
  console.log('❌ DATABASE_URL: Not found');
}

console.log('🔧 NODE_ENV:', process.env.NODE_ENV);

async function resetDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Connected to Tweet Genie database');
    console.log('🗑️  Dropping all existing tables...');

    // Drop all tables (order matters due to foreign keys)
    const dropQueries = [
      'DROP TABLE IF EXISTS migration_history CASCADE;',
      'DROP TABLE IF EXISTS twitter_auth CASCADE;',
      'DROP TABLE IF EXISTS scheduled_tweets CASCADE;',
      'DROP TABLE IF EXISTS tweets CASCADE;',
      'DROP TABLE IF EXISTS twitter_accounts CASCADE;',
      'DROP TABLE IF EXISTS ai_generations CASCADE;',
      'DROP TABLE IF EXISTS user_ai_providers CASCADE;',
      'DROP TABLE IF EXISTS twitter_oauth_state CASCADE;',
      'DROP TABLE IF EXISTS api_keys CASCADE;',
      'DROP TABLE IF EXISTS credit_transactions CASCADE;',
      'DROP TABLE IF EXISTS team_members CASCADE;',
      'DROP TABLE IF EXISTS tweet_analytics CASCADE;',
      'DROP TABLE IF EXISTS users CASCADE;'
    ];

    for (const query of dropQueries) {
      await client.query(query);
      console.log('✅ Executed:', query);
    }

    console.log('🏗️  Creating fresh database schema...');

    // Create tables in correct order
    const createQueries = [
      // Migration history table
      `CREATE TABLE migration_history (
        version INTEGER PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,

      // Twitter auth table for OAuth credentials
      `CREATE TABLE twitter_auth (
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
        UNIQUE(user_id),
        UNIQUE(twitter_user_id)
      );`,



      // Tweets table
      `CREATE TABLE tweets (
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
      );`,

      // Scheduled tweets table
      `CREATE TABLE scheduled_tweets (
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
      );`,

      // AI generations table
      `CREATE TABLE ai_generations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        prompt TEXT NOT NULL,
        provider VARCHAR(20) NOT NULL,
        generated_content JSONB,
        credits_used INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,

      // User AI providers table
      `CREATE TABLE user_ai_providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        provider VARCHAR(20) NOT NULL,
        encrypted_api_key TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider)
      );`
    ];

    for (const query of createQueries) {
      await client.query(query);
      console.log('✅ Created table');
    }

    console.log('🔗 Creating indexes...');

    const indexQueries = [
      // Twitter auth indexes
      'CREATE INDEX IF NOT EXISTS idx_twitter_auth_user_id ON twitter_auth(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_twitter_auth_twitter_user_id ON twitter_auth(twitter_user_id);',
      
      // Tweets indexes
      'CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_tweets_tweet_id ON tweets(tweet_id);',
      'CREATE INDEX IF NOT EXISTS idx_tweets_status ON tweets(status);',
      'CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at);',
      
      // Scheduled tweets indexes
      'CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_user_id ON scheduled_tweets(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_scheduled_for ON scheduled_tweets(scheduled_for);',
      'CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_status ON scheduled_tweets(status);',
      
      // AI generations indexes
      'CREATE INDEX IF NOT EXISTS idx_ai_generations_user_id ON ai_generations(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_ai_generations_provider ON ai_generations(provider);',
      'CREATE INDEX IF NOT EXISTS idx_ai_generations_created_at ON ai_generations(created_at);',
      
      // User AI providers indexes
      'CREATE INDEX IF NOT EXISTS idx_user_ai_providers_user_id ON user_ai_providers(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_user_ai_providers_provider ON user_ai_providers(provider);'
    ];

    for (const query of indexQueries) {
      await client.query(query);
    }

    console.log('📝 Recording migration history...');
    
    // Record all migrations as completed
    const migrations = [
      { version: 1, name: 'create_migration_history_table' },
      { version: 2, name: 'create_twitter_auth_table' },
      { version: 3, name: 'create_tweets_table' },
      { version: 4, name: 'create_scheduled_tweets_table' },
      { version: 5, name: 'create_ai_generations_table' },
      { version: 6, name: 'create_user_ai_providers_table' }
    ];

    for (const migration of migrations) {
      await client.query(
        'INSERT INTO migration_history (version, name) VALUES ($1, $2)',
        [migration.version, migration.name]
      );
    }

    console.log('✅ Database reset completed successfully!');
    console.log('🎉 Fresh database with proper schema is ready');
    
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

// Run the reset
resetDatabase().catch(console.error);
