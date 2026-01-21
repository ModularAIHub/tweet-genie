-- Migration: Fix team_accounts id column to be SERIAL integer instead of UUID

-- Drop the existing UUID id column
ALTER TABLE team_accounts DROP COLUMN IF EXISTS id CASCADE;

-- Add proper SERIAL id column
ALTER TABLE team_accounts ADD COLUMN id SERIAL PRIMARY KEY;

-- Add indexes for common queries (if they don't exist)
CREATE INDEX IF NOT EXISTS idx_team_accounts_id ON team_accounts(id);
CREATE INDEX IF NOT EXISTS idx_team_accounts_team_id ON team_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_team_accounts_user_id ON team_accounts(user_id);

-- Add unique constraint on the old composite key (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'team_accounts_team_twitter_unique'
    ) THEN
        ALTER TABLE team_accounts
        ADD CONSTRAINT team_accounts_team_twitter_unique 
        UNIQUE (team_id, twitter_user_id);
    END IF;
END $$;

COMMENT ON COLUMN team_accounts.id IS 'Auto-increment integer primary key for team accounts';
