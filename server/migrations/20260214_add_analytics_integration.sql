-- Analytics Integration for Strategy Builder (Phase 3)
-- Created: 2026-02-14

-- Add analytics columns to tweets table (if not already present)
ALTER TABLE tweets
  ADD COLUMN IF NOT EXISTS impressions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retweets INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replies INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quotes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bookmarks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS url_clicks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_clicks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_rate DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS analytics_fetched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES user_strategies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_id UUID REFERENCES strategy_prompts(id) ON DELETE SET NULL;

-- Strategy Analytics Table - Aggregated insights per strategy
CREATE TABLE IF NOT EXISTS strategy_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    
    -- Time period for this analysis
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Performance metrics
    total_posts INTEGER DEFAULT 0,
    total_impressions BIGINT DEFAULT 0,
    total_engagements BIGINT DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
    
    -- Best performing times (hour of day, 0-23)
    best_posting_hours INTEGER[] DEFAULT '{}',
    
    -- Best performing days (0=Sunday, 6=Saturday)
    best_posting_days INTEGER[] DEFAULT '{}',
    
    -- Top performing themes/topics
    top_themes JSONB DEFAULT '{}',
    
    -- Detailed metrics by category
    metrics_by_category JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(strategy_id, period_start, period_end)
);

-- Content Performance Insights Table
CREATE TABLE IF NOT EXISTS content_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    
    -- Content analysis
    content_type TEXT, -- 'thread', 'tweet', 'quote', 'poll'
    themes TEXT[],
    sentiment TEXT, -- 'positive', 'negative', 'neutral'
    
    -- Performance
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
    total_posts INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0, -- % above avg engagement
    
    -- Recommendations
    recommendation TEXT,
    confidence_score DECIMAL(5,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optimal Posting Schedule Table
CREATE TABLE IF NOT EXISTS optimal_posting_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    
    day_of_week INTEGER NOT NULL, -- 0=Sunday, 6=Saturday
    hour INTEGER NOT NULL, -- 0-23
    
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
    post_count INTEGER DEFAULT 0,
    confidence_score DECIMAL(5,2) DEFAULT 0,
    
    is_recommended BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(strategy_id, day_of_week, hour)
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_tweets_strategy_id ON tweets(strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tweets_prompt_id ON tweets(prompt_id) WHERE prompt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweets_engagement ON tweets(engagement_rate DESC) WHERE engagement_rate > 0;

CREATE INDEX IF NOT EXISTS idx_strategy_analytics_strategy_period ON strategy_analytics(strategy_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_strategy_analytics_period_end ON strategy_analytics(period_end DESC);

CREATE INDEX IF NOT EXISTS idx_content_insights_strategy_id ON content_insights(strategy_id);
CREATE INDEX IF NOT EXISTS idx_content_insights_success ON content_insights(success_rate DESC);

CREATE INDEX IF NOT EXISTS idx_optimal_schedule_strategy ON optimal_posting_schedule(strategy_id);
CREATE INDEX IF NOT EXISTS idx_optimal_schedule_recommended ON optimal_posting_schedule(strategy_id, is_recommended) WHERE is_recommended = true;

-- Triggers for updated_at
CREATE TRIGGER update_strategy_analytics_updated_at BEFORE UPDATE ON strategy_analytics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_insights_updated_at BEFORE UPDATE ON content_insights
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_optimal_posting_schedule_updated_at BEFORE UPDATE ON optimal_posting_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
