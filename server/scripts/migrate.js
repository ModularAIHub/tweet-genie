import { pool } from '../config/database.js';

const migrations = [
  {
    version: 1,
    name: 'create_twitter_accounts_table',
    sql: `
      CREATE TABLE IF NOT EXISTS twitter_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        twitter_user_id VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        display_name VARCHAR(100),
        profile_image_url TEXT,
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        access_token TEXT NOT NULL,
        access_token_secret TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_twitter_accounts_user_id ON twitter_accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_twitter_accounts_twitter_user_id ON twitter_accounts(twitter_user_id);
    `
  },
  {
    version: 2,
    name: 'create_tweets_table',
    sql: `
      CREATE TABLE IF NOT EXISTS tweets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        twitter_account_id UUID NOT NULL REFERENCES twitter_accounts(id),
        tweet_id VARCHAR(50),
        content TEXT NOT NULL,
        media_urls JSONB DEFAULT '[]',
        thread_tweets JSONB DEFAULT '[]',
        credits_used INTEGER DEFAULT 0,
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
      CREATE INDEX IF NOT EXISTS idx_tweets_twitter_account_id ON tweets(twitter_account_id);
      CREATE INDEX IF NOT EXISTS idx_tweets_tweet_id ON tweets(tweet_id);
      CREATE INDEX IF NOT EXISTS idx_tweets_status ON tweets(status);
      CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at);
    `
  },
  {
    version: 3,
    name: 'create_scheduled_tweets_table',
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_tweets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        tweet_id UUID NOT NULL REFERENCES tweets(id),
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
    version: 4,
    name: 'create_ai_generations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_generations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        prompt TEXT NOT NULL,
        provider VARCHAR(20) NOT NULL,
        generated_content JSONB,
        credits_used INTEGER DEFAULT 0,
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
    version: 5,
    name: 'create_user_ai_providers_table',
    sql: `
      CREATE TABLE IF NOT EXISTS user_ai_providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        provider VARCHAR(20) NOT NULL,
        encrypted_api_key TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider)
      );
      
      CREATE INDEX IF NOT EXISTS idx_user_ai_providers_user_id ON user_ai_providers(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_ai_providers_provider ON user_ai_providers(provider);
    `
  },
  {
    version: 6,
    name: 'create_migration_history_table',
    sql: `
      CREATE TABLE IF NOT EXISTS migration_history (
        version INTEGER PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Starting migrations...');
  runMigrations()
    .then(() => {
      console.log('Migrations finished successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export { runMigrations };
