import 'dotenv/config';
import pool from './config/database.js';

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_notification_prefs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      notify_tweet_failures BOOLEAN DEFAULT true,
      notify_autopilot_paused BOOLEAN DEFAULT true,
      notify_low_credits BOOLEAN DEFAULT true,
      notify_weekly_digest BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_email_notif_prefs_user ON email_notification_prefs(user_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_notification_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_email_notif_log_user_type ON email_notification_log(user_id, notification_type, sent_at DESC)');

  console.log('Migration OK: email_notification_prefs and email_notification_log created');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
