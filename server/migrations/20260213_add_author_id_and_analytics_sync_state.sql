ALTER TABLE scheduled_tweets
  ADD COLUMN IF NOT EXISTS author_id VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_author_id
  ON scheduled_tweets(author_id);

CREATE TABLE IF NOT EXISTS analytics_sync_state (
  sync_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT,
  in_progress BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMP,
  last_sync_at TIMESTAMP,
  next_allowed_at TIMESTAMP,
  last_result VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_sync_state_user_account
  ON analytics_sync_state(user_id, account_id);
