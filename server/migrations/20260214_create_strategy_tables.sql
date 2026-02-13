-- Strategy Builder Tables Migration
-- Created: 2026-02-14

-- User Strategies Table
CREATE TABLE IF NOT EXISTS user_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    team_id UUID,
    niche TEXT,
    target_audience TEXT,
    content_goals TEXT[],
    posting_frequency TEXT,
    tone_style TEXT,
    topics TEXT[],
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Chat History Table
CREATE TABLE IF NOT EXISTS strategy_chat_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Prompts Table
CREATE TABLE IF NOT EXISTS strategy_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    variables JSONB DEFAULT '{}',
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    is_favorite BOOLEAN DEFAULT false,
    performance_score DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Queue Table (for auto-pilot)
CREATE TABLE IF NOT EXISTS strategy_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
    prompt_id UUID REFERENCES strategy_prompts(id) ON DELETE SET NULL,
    generated_content TEXT NOT NULL,
    scheduled_for TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'posted', 'failed')),
    approval_required BOOLEAN DEFAULT true,
    twitter_account_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_strategies_user_id ON user_strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_strategies_team_id ON user_strategies(team_id);
CREATE INDEX IF NOT EXISTS idx_user_strategies_status ON user_strategies(status);

CREATE INDEX IF NOT EXISTS idx_strategy_chat_strategy_id ON strategy_chat_history(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_chat_created_at ON strategy_chat_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_prompts_strategy_id ON strategy_prompts(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_prompts_category ON strategy_prompts(category);
CREATE INDEX IF NOT EXISTS idx_strategy_prompts_favorite ON strategy_prompts(is_favorite) WHERE is_favorite = true;

CREATE INDEX IF NOT EXISTS idx_strategy_queue_strategy_id ON strategy_queue(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_queue_status ON strategy_queue(status);
CREATE INDEX IF NOT EXISTS idx_strategy_queue_scheduled_for ON strategy_queue(scheduled_for);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_strategies_updated_at BEFORE UPDATE ON user_strategies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategy_prompts_updated_at BEFORE UPDATE ON strategy_prompts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
