-- Improve scheduled list query performance (team + personal scopes)

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_team_status_scheduled_for
  ON scheduled_tweets(team_id, status, scheduled_for)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_personal_status_scheduled_for
  ON scheduled_tweets(user_id, status, scheduled_for)
  WHERE team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_tweets_personal_author_status_scheduled_for
  ON scheduled_tweets(user_id, author_id, status, scheduled_for)
  WHERE team_id IS NULL AND author_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_active_lookup
  ON team_members(team_id, user_id)
  WHERE status = 'active';
