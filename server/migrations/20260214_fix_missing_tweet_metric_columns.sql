-- Ensures analytics sync columns exist on tweets table.
-- Safe to run multiple times.

ALTER TABLE tweets
  ADD COLUMN IF NOT EXISTS impressions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retweets INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replies INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bookmark_count INTEGER DEFAULT 0;

-- Backfill from legacy column names if they exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tweets'
      AND column_name = 'quotes'
  ) THEN
    EXECUTE '
      UPDATE tweets
      SET quote_count = COALESCE(NULLIF(quote_count, 0), quotes, 0)
      WHERE COALESCE(quote_count, 0) = 0
        AND COALESCE(quotes, 0) > 0
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tweets'
      AND column_name = 'bookmarks'
  ) THEN
    EXECUTE '
      UPDATE tweets
      SET bookmark_count = COALESCE(NULLIF(bookmark_count, 0), bookmarks, 0)
      WHERE COALESCE(bookmark_count, 0) = 0
        AND COALESCE(bookmarks, 0) > 0
    ';
  END IF;
END $$;
