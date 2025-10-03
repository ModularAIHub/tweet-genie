-- Migration: Create team_accounts table for team Twitter OAuth

CREATE TABLE IF NOT EXISTS team_accounts (
  team_id UUID NOT NULL,
  user_id UUID NOT NULL,
  twitter_user_id VARCHAR(32) NOT NULL,
  twitter_username VARCHAR(64),
  twitter_display_name VARCHAR(128),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  twitter_profile_image_url TEXT,
  followers_count INTEGER,
  following_count INTEGER,
  tweet_count INTEGER,
  verified BOOLEAN,
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, twitter_user_id)
);
