ALTER TABLE scheduled_tweets
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
