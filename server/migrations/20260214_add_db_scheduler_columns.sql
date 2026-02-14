-- DB scheduler support columns/indexes for scheduled_tweets
-- Safe to run multiple times.

ALTER TABLE scheduled_tweets
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_due_db_scheduler
  ON scheduled_tweets(status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_due_approval_db_scheduler
  ON scheduled_tweets(status, approval_status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_processing_watchdog
  ON scheduled_tweets(status, processing_started_at)
  WHERE status = 'processing';
