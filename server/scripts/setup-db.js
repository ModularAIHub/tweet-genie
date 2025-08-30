import { pool } from '../config/database.js';

async function createTables() {
  const client = await pool.connect();
  
  try {
    console.log('Creating Tweet Genie database tables...');

    // Create migration_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_history (
        version INTEGER PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Migration history table created');

    // Create twitter_accounts table
    await client.query(`
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
    `);
    console.log('✓ Twitter accounts table created');

    // Create tweets table
    await client.query(`
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
      CREATE INDEX IF NOT EXISTS idx_tweets_status ON tweets(status);
      CREATE INDEX IF NOT EXISTS idx_tweets_posted_at ON tweets(posted_at);
    `);
    console.log('✓ Tweets table created');

    // Create scheduled_tweets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_tweets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        twitter_account_id UUID NOT NULL REFERENCES twitter_accounts(id),
        content TEXT NOT NULL,
        media_urls JSONB DEFAULT '[]',
        thread_tweets JSONB DEFAULT '[]',
        scheduled_time TIMESTAMP NOT NULL,
        timezone VARCHAR(50) DEFAULT 'UTC',
        status VARCHAR(20) DEFAULT 'scheduled',
        tweet_id VARCHAR(50),
        posted_at TIMESTAMP,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_user_id ON scheduled_tweets(user_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_scheduled_time ON scheduled_tweets(scheduled_time);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_status ON scheduled_tweets(status);
    `);
    console.log('✓ Scheduled tweets table created');

    // Create tweet_analytics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tweet_analytics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tweet_id UUID NOT NULL REFERENCES tweets(id),
        user_id UUID NOT NULL,
        impressions INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        retweets INTEGER DEFAULT 0,
        replies INTEGER DEFAULT 0,
        quotes INTEGER DEFAULT 0,
        bookmarks INTEGER DEFAULT 0,
        engagement_rate DECIMAL(5,2) DEFAULT 0,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_tweet_analytics_tweet_id ON tweet_analytics(tweet_id);
      CREATE INDEX IF NOT EXISTS idx_tweet_analytics_user_id ON tweet_analytics(user_id);
      CREATE INDEX IF NOT EXISTS idx_tweet_analytics_recorded_at ON tweet_analytics(recorded_at);
    `);
    console.log('✓ Tweet analytics table created');

    // Create user_ai_providers table
    await client.query(`
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
    `);
    console.log('✓ User AI providers table created');

    console.log('🎉 All Tweet Genie database tables created successfully!');

  } catch (error) {
    console.error('Database setup error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the setup
createTables()
  .then(() => {
    console.log('Database setup completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database setup failed:', error);
    process.exit(1);
  });
