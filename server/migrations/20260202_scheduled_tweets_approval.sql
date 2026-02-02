-- Migration: Add approval workflow to scheduled_tweets table
-- Date: 2026-02-02
-- Purpose: Enable approval workflow for scheduled tweets (Editor needs approval before posting)

-- Add team_id and approval fields to scheduled_tweets table
ALTER TABLE scheduled_tweets ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE scheduled_tweets ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved';
ALTER TABLE scheduled_tweets ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE scheduled_tweets ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMP;
ALTER TABLE scheduled_tweets ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add comments
COMMENT ON COLUMN scheduled_tweets.team_id IS 'Team ID if scheduled for team, NULL for personal';
COMMENT ON COLUMN scheduled_tweets.approval_status IS 'Values: approved, pending_approval, rejected';
COMMENT ON COLUMN scheduled_tweets.approved_by IS 'User ID of admin/owner who approved';

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_team_id ON scheduled_tweets(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_approval_status ON scheduled_tweets(approval_status) WHERE approval_status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_team_approval ON scheduled_tweets(team_id, approval_status) WHERE team_id IS NOT NULL;

-- Ensure existing scheduled_tweets are marked as approved
UPDATE scheduled_tweets SET approval_status = 'approved' WHERE approval_status IS NULL;
