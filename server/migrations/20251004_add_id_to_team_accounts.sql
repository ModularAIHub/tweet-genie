-- Migration: Add auto-increment id column to team_accounts table

-- Add id column as SERIAL (auto-increment)
ALTER TABLE team_accounts 
ADD COLUMN IF NOT EXISTS id SERIAL;

-- Make id the primary key and remove the old composite primary key
ALTER TABLE team_accounts
DROP CONSTRAINT IF EXISTS team_accounts_pkey;

ALTER TABLE team_accounts
ADD PRIMARY KEY (id);

-- Add unique constraint on the old primary key columns
ALTER TABLE team_accounts
ADD CONSTRAINT team_accounts_team_twitter_unique 
UNIQUE (team_id, twitter_user_id);

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_team_accounts_team_id ON team_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_team_accounts_user_id ON team_accounts(user_id);

COMMENT ON COLUMN team_accounts.id IS 'Auto-increment primary key for team accounts';
