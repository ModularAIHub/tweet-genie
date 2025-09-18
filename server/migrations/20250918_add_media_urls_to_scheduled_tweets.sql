-- Migration: Add media_urls column to scheduled_tweets
ALTER TABLE scheduled_tweets ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]';
