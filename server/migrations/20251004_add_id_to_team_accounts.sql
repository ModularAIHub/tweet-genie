-- Migration: Add auto-increment id column to team_accounts table

-- Add id column as SERIAL (auto-increment)
ALTER TABLE team_accounts 
ADD COLUMN IF NOT EXISTS id SERIAL;

DO $$
DECLARE
  id_is_primary_key BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'team_accounts'
      AND con.contype = 'p'
      AND att.attname = 'id'
  )
  INTO id_is_primary_key;

  IF NOT id_is_primary_key THEN
    -- Drop any legacy PK before moving to id.
    ALTER TABLE team_accounts DROP CONSTRAINT IF EXISTS team_accounts_pkey;
    ALTER TABLE team_accounts ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Add unique constraint on the old primary key columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_accounts_team_twitter_unique'
  ) THEN
    ALTER TABLE team_accounts
    ADD CONSTRAINT team_accounts_team_twitter_unique
    UNIQUE (team_id, twitter_user_id);
  END IF;
END $$;

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_team_accounts_team_id ON team_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_team_accounts_user_id ON team_accounts(user_id);

COMMENT ON COLUMN team_accounts.id IS 'Auto-increment primary key for team accounts';
