-- Phase 4: Autopilot Mode Enhancements
-- Created: 2026-03-03

-- Add autopilot scheduling fields to scheduled_tweets
ALTER TABLE scheduled_tweets
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS undo_deadline TIMESTAMP,
  ADD COLUMN IF NOT EXISTS autopilot_strategy_id UUID REFERENCES user_strategies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_review_item_id UUID;

-- Index for undo window queries (find tweets within undo window)
CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_undo_deadline
  ON scheduled_tweets (undo_deadline)
  WHERE undo_deadline IS NOT NULL AND status = 'pending';

-- Index for autopilot source lookups
CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_source
  ON scheduled_tweets (source)
  WHERE source = 'autopilot';

-- Add notification tracking to autopilot_history
ALTER TABLE autopilot_history
  ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS tweets_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}';
