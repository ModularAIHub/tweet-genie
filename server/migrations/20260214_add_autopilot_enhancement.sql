-- Auto-Pilot Enhancement for Strategy Builder (Phase 4)
-- Created: 2026-02-14

-- Auto-Pilot Configuration Table
CREATE TABLE IF NOT EXISTS autopilot_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE UNIQUE,
    
    is_enabled BOOLEAN DEFAULT false,
    
    -- Generation settings
    posts_per_day INTEGER DEFAULT 3,
    generation_mode TEXT DEFAULT 'smart' CHECK (generation_mode IN ('smart', 'scheduled', 'manual')),
    
    -- Scheduling settings
    use_optimal_times BOOLEAN DEFAULT true,
    custom_posting_hours INTEGER[] DEFAULT '{}', -- If not using optimal times
    timezone TEXT DEFAULT 'UTC',
    
    -- Content settings
    require_approval BOOLEAN DEFAULT true,
    auto_thread BOOLEAN DEFAULT false, -- Auto-generate threads for certain topics
    max_queue_size INTEGER DEFAULT 10,
    
    -- Diversity settings
    category_rotation BOOLEAN DEFAULT true, -- Rotate through categories
    avoid_repetition_days INTEGER DEFAULT 7, -- Don't repeat similar content within X days
    
    -- Safety settings
    pause_on_low_engagement BOOLEAN DEFAULT false,
    min_engagement_threshold DECIMAL(5,2) DEFAULT 0,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auto-Pilot Generation History
CREATE TABLE IF NOT EXISTS autopilot_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    queue_id UUID REFERENCES strategy_queue(id) ON DELETE SET NULL,
    
    action TEXT NOT NULL, -- 'generated', 'scheduled', 'approved', 'rejected', 'posted', 'failed'
    actor TEXT, -- 'system', 'user_id'
    
    -- Context
    prompt_used UUID REFERENCES strategy_prompts(id) ON DELETE SET NULL,
    category TEXT,
    
    -- Result
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Content Variations Table (for A/B testing)
CREATE TABLE IF NOT EXISTS content_variations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id UUID NOT NULL REFERENCES strategy_queue(id) ON DELETE CASCADE,
    
    variation_type TEXT DEFAULT 'ab_test', -- 'ab_test', 'hook_variation', 'cta_variation'
    content TEXT NOT NULL,
    
    -- Test parameters
    is_primary BOOLEAN DEFAULT false,
    test_weight DECIMAL(3,2) DEFAULT 0.50, -- For weighted testing
    
    -- Results
    used_count INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhance strategy_queue with additional fields
ALTER TABLE strategy_queue
  ADD COLUMN IF NOT EXISTS generation_mode TEXT DEFAULT 'manual' CHECK (generation_mode IN ('manual', 'auto', 'smart')),
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS ideal_posting_time TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS engagement_prediction DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5, -- 1-10, 10=highest
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_autopilot_config_strategy ON autopilot_config(strategy_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_config_enabled ON autopilot_config(is_enabled) WHERE is_enabled = true;

CREATE INDEX IF NOT EXISTS idx_autopilot_history_strategy ON autopilot_history(strategy_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_history_action ON autopilot_history(action);
CREATE INDEX IF NOT EXISTS idx_autopilot_history_created ON autopilot_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_variations_queue ON content_variations(queue_id);
CREATE INDEX IF NOT EXISTS idx_content_variations_primary ON content_variations(is_primary) WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_strategy_queue_generation_mode ON strategy_queue(generation_mode);
CREATE INDEX IF NOT EXISTS idx_strategy_queue_category ON strategy_queue(category);
CREATE INDEX IF NOT EXISTS idx_strategy_queue_ideal_time ON strategy_queue(ideal_posting_time);
CREATE INDEX IF NOT EXISTS idx_strategy_queue_priority ON strategy_queue(priority DESC, scheduled_for ASC);

-- Triggers
CREATE TRIGGER update_autopilot_config_updated_at BEFORE UPDATE ON autopilot_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
