-- Phase 5: Feedback Loop — Performance Scoring & Weekly Summaries
-- Created: 2026-03-03

-- ─── Performance score per tweet ──────────────────────────────────────────
-- Computed after analytics sync, normalised against the user's own averages.
ALTER TABLE tweets
  ADD COLUMN IF NOT EXISTS performance_score TEXT CHECK (performance_score IN ('above_average', 'average', 'below_average')),
  ADD COLUMN IF NOT EXISTS performance_ratio DECIMAL(8,4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS topic_tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scored_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_tweets_performance_score
  ON tweets (user_id, performance_score)
  WHERE performance_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tweets_strategy_scored
  ON tweets (strategy_id, scored_at DESC)
  WHERE strategy_id IS NOT NULL AND scored_at IS NOT NULL;

-- ─── Weekly performance summaries ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_performance_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES user_strategies(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,

  -- Aggregate metrics
  total_tweets INTEGER DEFAULT 0,
  total_impressions BIGINT DEFAULT 0,
  total_engagement INTEGER DEFAULT 0,
  avg_engagement_rate DECIMAL(8,4) DEFAULT 0,

  -- Category breakdown (JSONB: { "educational": { count, avg_engagement }, ... })
  category_performance JSONB DEFAULT '{}',

  -- Format breakdown
  threads_count INTEGER DEFAULT 0,
  threads_avg_engagement DECIMAL(8,4) DEFAULT 0,
  singles_count INTEGER DEFAULT 0,
  singles_avg_engagement DECIMAL(8,4) DEFAULT 0,

  -- Time breakdown (JSONB: { "9": { count, avg_engagement }, "14": { count, ... } })
  hour_performance JSONB DEFAULT '{}',

  -- Topic performance (JSONB: { "topic_name": { count, avg_engagement, trend } })
  topic_performance JSONB DEFAULT '{}',

  -- Best / worst
  best_tweet_id TEXT,
  best_tweet_engagement INTEGER DEFAULT 0,
  worst_tweet_id TEXT,
  worst_tweet_engagement INTEGER DEFAULT 0,

  -- Strategy adjustment suggestions (populated by auto-update logic)
  suggested_adjustments JSONB DEFAULT '{}',

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_performance_user_week
  ON weekly_performance_summaries (user_id, strategy_id, week_start);

CREATE INDEX IF NOT EXISTS idx_weekly_performance_strategy
  ON weekly_performance_summaries (strategy_id, week_start DESC);

-- ─── Strategy auto-update tracking ───────────────────────────────────────
-- Tracks what the feedback loop has changed in a strategy over time.
CREATE TABLE IF NOT EXISTS strategy_auto_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL, -- 'format', 'topic_priority', 'posting_time', 'tone'
  previous_value JSONB,
  new_value JSONB,
  reason TEXT,
  weeks_of_data INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_strategy_auto_updates_strategy
  ON strategy_auto_updates (strategy_id, created_at DESC);

-- ─── Deferred analytics sync queue ───────────────────────────────────────
-- After a tweet is posted, schedule an analytics sync 24-48h later.
CREATE TABLE IF NOT EXISTS deferred_analytics_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tweet_id TEXT NOT NULL,
  account_id TEXT,
  sync_after TIMESTAMP NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deferred_analytics_sync_pending
  ON deferred_analytics_sync (sync_after ASC)
  WHERE status = 'pending';
