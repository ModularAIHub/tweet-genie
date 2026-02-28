-- Migration: Add approval workflow to tweets table
-- Date: 2026-02-02
-- Purpose: Enable approval workflow where Editors need approval before scheduling

-- Add approval fields to tweets table (tweet-genie)
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved';
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMP;
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add FK only when users.id is UUID and FK is not already present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
      AND udt_name = 'uuid'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tweets_approved_by_fkey'
  ) THEN
    ALTER TABLE tweets
      ADD CONSTRAINT tweets_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES users(id);
  END IF;
END $$;

-- Add comments
COMMENT ON COLUMN tweets.approval_status IS 'Values: approved, pending_approval, rejected';
COMMENT ON COLUMN tweets.approved_by IS 'User ID of admin/owner who approved';

-- Create index for faster approval queries
CREATE INDEX IF NOT EXISTS idx_tweets_approval_status ON tweets(approval_status) WHERE approval_status = 'pending_approval';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tweets'
      AND column_name = 'team_id'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_tweets_team_approval
      ON tweets(team_id, approval_status)
      WHERE team_id IS NOT NULL
    ';
  END IF;
END $$;

-- Ensure existing tweets are marked as approved
UPDATE tweets SET approval_status = 'approved' WHERE approval_status IS NULL;
