-- Only add new columns that do not exist yet!
ALTER TABLE scheduled_tweets
  ADD COLUMN IF NOT EXISTS thread_media JSONB;
