-- Migration: Add account_id column to tweets table for team account association

-- Add account_id column to tweets table
ALTER TABLE tweets 
ADD COLUMN IF NOT EXISTS account_id INTEGER;

-- Add index for faster queries filtered by account_id
CREATE INDEX IF NOT EXISTS idx_tweets_account_id ON tweets(account_id);

-- Add index for user_id + account_id combination (common query pattern)
CREATE INDEX IF NOT EXISTS idx_tweets_user_account ON tweets(user_id, account_id);

-- Update existing tweets to have NULL account_id (individual user tweets)
-- Team tweets will have account_id populated when posted

COMMENT ON COLUMN tweets.account_id IS 'Links to team_accounts table for team tweets. NULL for individual user tweets.';
