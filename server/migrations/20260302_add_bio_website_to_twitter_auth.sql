-- Add bio and website_url columns to twitter_auth table for profile analysis
ALTER TABLE twitter_auth ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE twitter_auth ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Also add to team_accounts for completeness
ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Create profile_analyses table for storing analysis results
CREATE TABLE IF NOT EXISTS profile_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES user_strategies(id) ON DELETE CASCADE,
  twitter_user_id TEXT,
  analysis_data JSONB NOT NULL DEFAULT '{}',
  trending_topics JSONB DEFAULT '[]',
  reference_accounts JSONB DEFAULT '[]',
  confidence TEXT DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  confidence_reason TEXT,
  tweets_analysed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'analysing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_analyses_user_id ON profile_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_analyses_strategy_id ON profile_analyses(strategy_id);
