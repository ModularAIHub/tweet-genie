-- Analytics performance indexes for posted tweet scans and sync candidate selection
CREATE INDEX IF NOT EXISTS idx_tweets_posted_scope_time
  ON tweets (user_id, COALESCE(external_created_at, created_at) DESC)
  WHERE status = 'posted'
    AND tweet_id IS NOT NULL
    AND source IN ('platform', 'external');

CREATE INDEX IF NOT EXISTS idx_tweets_posted_scope_account_time
  ON tweets (user_id, account_id, COALESCE(external_created_at, created_at) DESC)
  WHERE status = 'posted'
    AND tweet_id IS NOT NULL
    AND source IN ('platform', 'external');

CREATE INDEX IF NOT EXISTS idx_tweets_posted_scope_author_time
  ON tweets (user_id, author_id, COALESCE(external_created_at, created_at) DESC)
  WHERE status = 'posted'
    AND tweet_id IS NOT NULL
    AND source IN ('platform', 'external');

CREATE INDEX IF NOT EXISTS idx_tweets_sync_stale_selector
  ON tweets (user_id, updated_at, impressions)
  WHERE status = 'posted'
    AND tweet_id IS NOT NULL
    AND source IN ('platform', 'external');
