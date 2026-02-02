-- Migration: Add approval workflow to tweets table
-- Date: 2026-02-02
-- Purpose: Enable approval workflow where Editors need approval before scheduling

-- Add approval fields to tweets table (tweet-genie)
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved';
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMP;
ALTER TABLE tweets ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add comments
COMMENT ON COLUMN tweets.approval_status IS 'Values: approved, pending_approval, rejected';
COMMENT ON COLUMN tweets.approved_by IS 'User ID of admin/owner who approved';

-- Create index for faster approval queries
CREATE INDEX IF NOT EXISTS idx_tweets_approval_status ON tweets(approval_status) WHERE approval_status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_tweets_team_approval ON tweets(team_id, approval_status) WHERE team_id IS NOT NULL;

-- Ensure existing tweets are marked as approved
UPDATE tweets SET approval_status = 'approved' WHERE approval_status IS NULL;
