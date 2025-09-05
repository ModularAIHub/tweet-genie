-- Migration: Add content and media columns to scheduled_tweets
ALTER TABLE scheduled_tweets
  ADD COLUMN content TEXT,
  ADD COLUMN media JSONB;
-- Optional: Remove tweet_id column if not needed
-- ALTER TABLE scheduled_tweets DROP COLUMN tweet_id;
