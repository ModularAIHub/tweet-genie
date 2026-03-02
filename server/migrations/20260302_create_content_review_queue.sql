-- Content Review Queue: stores weekly AI-generated tweets awaiting user review
CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES user_strategies(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  suggested_time TIMESTAMPTZ,
  timezone TEXT DEFAULT 'UTC',
  reason TEXT,
  source TEXT DEFAULT 'weekly_generation' CHECK (source IN ('weekly_generation', 'manual_generation', 'strategy_completion')),
  category TEXT,
  prompt_id UUID,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'scheduled')),
  scheduled_tweet_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_review_queue_user_status ON content_review_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_content_review_queue_strategy ON content_review_queue(strategy_id);
CREATE INDEX IF NOT EXISTS idx_content_review_queue_created ON content_review_queue(created_at DESC);
