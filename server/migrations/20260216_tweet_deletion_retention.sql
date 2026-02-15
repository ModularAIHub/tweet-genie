-- Tweet deletion retention support
-- Keep deleted tweets visible for a retention window, then purge.

ALTER TABLE tweets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_tweets_deleted_retention
  ON tweets(deleted_at)
  WHERE status = 'deleted';

