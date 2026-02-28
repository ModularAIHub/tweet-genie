-- Migration: Normalize team_accounts.id to SERIAL integer primary key.
-- Safe on reruns: skips destructive rebuild when id is already integer.

DO $$
DECLARE
  id_udt_name TEXT;
  id_is_primary_key BOOLEAN;
BEGIN
  SELECT c.udt_name
  INTO id_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'team_accounts'
    AND c.column_name = 'id';

  IF id_udt_name IS NULL THEN
    -- id does not exist yet; create it directly.
    EXECUTE 'ALTER TABLE team_accounts ADD COLUMN id SERIAL PRIMARY KEY';
  ELSIF id_udt_name = 'int4' THEN
    -- Already integer; only ensure primary key exists on id.
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
      EXECUTE 'ALTER TABLE team_accounts DROP CONSTRAINT IF EXISTS team_accounts_pkey';
      EXECUTE 'ALTER TABLE team_accounts ADD PRIMARY KEY (id)';
    END IF;
  ELSE
    -- id exists but is not integer (legacy UUID case): rebuild once.
    EXECUTE 'ALTER TABLE team_accounts DROP CONSTRAINT IF EXISTS team_accounts_pkey';
    EXECUTE 'ALTER TABLE team_accounts DROP COLUMN IF EXISTS id CASCADE';
    EXECUTE 'ALTER TABLE team_accounts ADD COLUMN id SERIAL PRIMARY KEY';
  END IF;
END $$;

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
