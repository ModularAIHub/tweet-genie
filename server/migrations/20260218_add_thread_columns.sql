-- Add thread-related columns to tweets table
-- Migration: 20260218_add_thread_columns.sql

-- Add is_thread column to mark tweets that are part of a thread
ALTER TABLE tweets 
ADD COLUMN IF NOT EXISTS is_thread BOOLEAN DEFAULT FALSE;

-- Add thread_count column to store the number of tweets in the thread
ALTER TABLE tweets 
ADD COLUMN IF NOT EXISTS thread_count INTEGER DEFAULT 1;

-- Create index for faster thread queries
CREATE INDEX IF NOT EXISTS idx_tweets_is_thread ON tweets(is_thread) WHERE is_thread = TRUE;

-- Update existing threads (if they have thread_tweets data)
UPDATE tweets 
SET is_thread = TRUE, 
    thread_count = CASE 
        WHEN thread_tweets IS NOT NULL AND thread_tweets::text != '[]' 
        THEN jsonb_array_length(thread_tweets::jsonb) + 1 
        ELSE 1 
    END
WHERE thread_tweets IS NOT NULL AND thread_tweets::text != '[]';

-- Add comment for documentation
COMMENT ON COLUMN tweets.is_thread IS 'Indicates if this tweet is part of a thread';
COMMENT ON COLUMN tweets.thread_count IS 'Total number of tweets in the thread (including this one)';
