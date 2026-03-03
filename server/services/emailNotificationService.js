/**
 * Email Notification Service for SuiteGenie Tweet-Genie
 * 
 * Sends non-spammy, consolidated email notifications for:
 * - Tweet posting failures / partial thread posts
 * - Autopilot paused (prompts exhausted / insufficient credits)
 * - Low credit balance warnings
 * - Weekly digest summary
 * 
 * Uses Resend for email delivery.
 * Respects user notification preferences stored in `email_notification_prefs`.
 */

import { Resend } from 'resend';
import pool from '../config/database.js';

// ── Configuration ──────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'SuiteGenie <noreply@suitegenie.in>';
const PLATFORM_NAME = process.env.PLATFORM_NAME || 'SuiteGenie';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5174';

// Minimum hours between same-type emails to avoid spam
const COOLDOWN_HOURS = {
  tweet_failed: 1,         // At most one failure email per hour
  tweet_partial: 1,        // At most one partial email per hour
  prompts_exhausted: 24,   // Once a day max
  low_credits: 24,         // Once a day max
  weekly_digest: 168,      // Once a week (7 days)
};

let resend = null;

function getResend() {
  if (!RESEND_API_KEY) {
    return null;
  }
  if (!resend) {
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

// ── Notification Preference Helpers ────────────────────────────────────────

/**
 * Get or create email notification preferences for a user
 */
async function getNotificationPrefs(userId) {
  try {
    let result = await pool.query(
      'SELECT * FROM email_notification_prefs WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      // Create default prefs (all enabled)
      result = await pool.query(
        `INSERT INTO email_notification_prefs (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING *`,
        [userId]
      );
      if (result.rows.length === 0) {
        result = await pool.query(
          'SELECT * FROM email_notification_prefs WHERE user_id = $1',
          [userId]
        );
      }
    }
    return result.rows[0];
  } catch (error) {
    console.error('[EmailNotif] Error getting prefs:', error.message);
    // Return defaults if table doesn't exist yet
    return {
      user_id: userId,
      notify_tweet_failures: true,
      notify_autopilot_paused: true,
      notify_low_credits: true,
      notify_weekly_digest: true,
    };
  }
}

/**
 * Update notification preferences
 */
export async function updateNotificationPrefs(userId, updates) {
  const allowed = ['notify_tweet_failures', 'notify_autopilot_paused', 'notify_low_credits', 'notify_weekly_digest'];
  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = $${i}`);
      values.push(value);
      i++;
    }
  }
  if (fields.length === 0) return null;

  values.push(userId);
  const result = await pool.query(
    `UPDATE email_notification_prefs SET ${fields.join(', ')}, updated_at = NOW() WHERE user_id = $${i} RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * Get notification prefs for API response
 */
export async function getNotificationPrefsForUser(userId) {
  return getNotificationPrefs(userId);
}

// ── Cooldown Check ─────────────────────────────────────────────────────────

/**
 * Check if we recently sent this type of email to this user (cooldown)
 */
async function isOnCooldown(userId, notificationType) {
  try {
    const cooldownHours = COOLDOWN_HOURS[notificationType] || 1;
    const result = await pool.query(
      `SELECT id FROM email_notification_log
       WHERE user_id = $1 AND notification_type = $2
         AND sent_at > NOW() - ($3 || ' hours')::INTERVAL
       LIMIT 1`,
      [userId, notificationType, cooldownHours.toString()]
    );
    return result.rows.length > 0;
  } catch {
    return false; // If log table doesn't exist, don't block
  }
}

/**
 * Log that we sent an email
 */
async function logEmailSent(userId, notificationType, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO email_notification_log (user_id, notification_type, metadata)
       VALUES ($1, $2, $3)`,
      [userId, notificationType, JSON.stringify(metadata)]
    );
  } catch (error) {
    console.error('[EmailNotif] Error logging email:', error.message);
  }
}

// ── Core Send Function ─────────────────────────────────────────────────────

async function sendEmail(to, subject, html, text) {
  const client = getResend();
  if (!client) {
    console.warn('[EmailNotif] Resend not configured (RESEND_API_KEY missing) — skipping email.');
    return null;
  }
  try {
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      console.error('[EmailNotif] Resend API error:', error);
      return null;
    }
    console.log(`📧 Email sent: "${subject}" → ${to} (id: ${data.id})`);
    return data;
  } catch (error) {
    console.error('[EmailNotif] Failed to send email:', error.message);
    return null;
  }
}

// ── Get User Email ─────────────────────────────────────────────────────────

async function getUserEmail(userId) {
  try {
    const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.email || null;
  } catch {
    return null;
  }
}

// ── Notification Functions ─────────────────────────────────────────────────

/**
 * Send tweet failure notification
 */
export async function notifyTweetFailed(userId, { tweetId, content, errorMessage, isPartial = false }) {
  try {
    const prefs = await getNotificationPrefs(userId);
    if (!prefs.notify_tweet_failures) return;

    const type = isPartial ? 'tweet_partial' : 'tweet_failed';
    if (await isOnCooldown(userId, type)) return;

    const email = await getUserEmail(userId);
    if (!email) return;

    const preview = (content || '').slice(0, 100) + ((content || '').length > 100 ? '...' : '');
    const subject = isPartial
      ? `⚠️ Thread partially posted — ${PLATFORM_NAME}`
      : `❌ Scheduled tweet failed to post — ${PLATFORM_NAME}`;

    const html = wrapHtmlTemplate(`
      <h2 style="color: ${isPartial ? '#d97706' : '#dc2626'}; margin: 0 0 16px 0;">
        ${isPartial ? '⚠️ Thread Partially Posted' : '❌ Tweet Failed to Post'}
      </h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        ${isPartial
          ? 'Your scheduled thread was posted, but not all parts made it through.'
          : 'A scheduled tweet failed to post. Here are the details:'}
      </p>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">Tweet content:</p>
        <p style="color: #111827; font-size: 14px; margin: 0; white-space: pre-wrap;">${escapeHtml(preview)}</p>
      </div>
      ${errorMessage ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin: 12px 0;">
        <p style="color: #991b1b; font-size: 13px; margin: 0;"><strong>Error:</strong> ${escapeHtml(errorMessage)}</p>
      </div>` : ''}
      <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
        Check your <a href="${CLIENT_URL}/calendar" style="color: #2563eb;">Calendar</a> for details.
      </p>
    `);

    const text = `${isPartial ? 'Thread Partially Posted' : 'Tweet Failed to Post'}\n\nContent: ${preview}\n${errorMessage ? `Error: ${errorMessage}\n` : ''}\nCheck your calendar at ${CLIENT_URL}/calendar`;

    await sendEmail(email, subject, html, text);
    await logEmailSent(userId, type, { tweetId, errorMessage });
  } catch (error) {
    console.error('[EmailNotif] Error in notifyTweetFailed:', error.message);
  }
}

/**
 * Send autopilot paused notification (prompts exhausted or credits)
 */
export async function notifyAutopilotPaused(userId, { reason, strategyNiche }) {
  try {
    const prefs = await getNotificationPrefs(userId);
    if (!prefs.notify_autopilot_paused) return;

    if (await isOnCooldown(userId, reason)) return;

    const email = await getUserEmail(userId);
    if (!email) return;

    const isPrompts = reason === 'prompts_exhausted';
    const subject = isPrompts
      ? `⏸️ Autopilot paused — all prompts used — ${PLATFORM_NAME}`
      : `⏸️ Autopilot paused — insufficient credits — ${PLATFORM_NAME}`;

    const html = wrapHtmlTemplate(`
      <h2 style="color: #d97706; margin: 0 0 16px 0;">
        ⏸️ Autopilot Paused
      </h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        Autopilot for your <strong>${escapeHtml(strategyNiche || 'strategy')}</strong> has been automatically paused.
      </p>
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #92400e; font-size: 14px; margin: 0;">
          <strong>Reason:</strong> ${isPrompts
            ? 'All prompts have been used. Generate more prompts in Strategy Builder to continue.'
            : 'Insufficient credits to generate content. Purchase more credits to resume.'}
        </p>
      </div>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">
        <strong>To resume:</strong>
      </p>
      <ol style="color: #374151; font-size: 14px; line-height: 1.8; padding-left: 20px;">
        ${isPrompts
          ? '<li>Go to <a href="' + CLIENT_URL + '/strategy" style="color: #2563eb;">Strategy Builder</a> and generate more prompts</li>'
          : '<li>Purchase more credits from your <a href="' + CLIENT_URL + '/settings" style="color: #2563eb;">account settings</a></li>'}
        <li>Toggle Autopilot off and back on in <a href="${CLIENT_URL}/settings" style="color: #2563eb;">Settings</a></li>
      </ol>
    `);

    const text = `Autopilot Paused\n\nYour autopilot for "${strategyNiche || 'strategy'}" has been paused.\nReason: ${isPrompts ? 'All prompts used' : 'Insufficient credits'}\n\nTo resume:\n${isPrompts ? '1. Generate more prompts in Strategy Builder\n' : '1. Purchase more credits\n'}2. Toggle Autopilot off and back on in Settings\n\n${CLIENT_URL}/settings`;

    await sendEmail(email, subject, html, text);
    await logEmailSent(userId, reason, { strategyNiche });
  } catch (error) {
    console.error('[EmailNotif] Error in notifyAutopilotPaused:', error.message);
  }
}

/**
 * Send low credits warning
 */
export async function notifyLowCredits(userId, { creditsRemaining, threshold = 5 }) {
  try {
    const prefs = await getNotificationPrefs(userId);
    if (!prefs.notify_low_credits) return;

    if (await isOnCooldown(userId, 'low_credits')) return;

    const email = await getUserEmail(userId);
    if (!email) return;

    const subject = `⚠️ Low credit balance (${creditsRemaining} remaining) — ${PLATFORM_NAME}`;

    const html = wrapHtmlTemplate(`
      <h2 style="color: #d97706; margin: 0 0 16px 0;">
        ⚠️ Low Credit Balance
      </h2>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        Your credit balance is running low.
      </p>
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 20px; margin: 16px 0; text-align: center;">
        <p style="color: #92400e; font-size: 32px; font-weight: bold; margin: 0;">
          ${creditsRemaining}
        </p>
        <p style="color: #92400e; font-size: 14px; margin: 4px 0 0 0;">credits remaining</p>
      </div>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">
        Each autopilot generation uses <strong>1.2 credits</strong>. At this rate, you can generate
        approximately <strong>${Math.floor(creditsRemaining / 1.2)}</strong> more posts before running out.
      </p>
      <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
        If credits run out, autopilot will pause automatically.
      </p>
    `);

    const text = `Low Credit Balance\n\nYou have ${creditsRemaining} credits remaining.\nEach autopilot generation uses 1.2 credits.\nYou can generate approximately ${Math.floor(creditsRemaining / 1.2)} more posts.\n\n${CLIENT_URL}/settings`;

    await sendEmail(email, subject, html, text);
    await logEmailSent(userId, 'low_credits', { creditsRemaining });
  } catch (error) {
    console.error('[EmailNotif] Error in notifyLowCredits:', error.message);
  }
}

/**
 * Send weekly digest email
 */
export async function sendWeeklyDigest(userId) {
  try {
    const prefs = await getNotificationPrefs(userId);
    if (!prefs.notify_weekly_digest) return;

    if (await isOnCooldown(userId, 'weekly_digest')) return;

    const email = await getUserEmail(userId);
    if (!email) return;

    // Gather stats for the past 7 days
    const [postsResult, failedResult, generatedResult, creditsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as count FROM scheduled_tweets
         WHERE user_id = $1 AND status = 'completed' AND posted_at > NOW() - INTERVAL '7 days'`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM scheduled_tweets
         WHERE user_id = $1 AND status IN ('failed', 'partially_completed') AND updated_at > NOW() - INTERVAL '7 days'`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM content_review_queue
         WHERE user_id = $1 AND source = 'autopilot' AND created_at > NOW() - INTERVAL '7 days'`,
        [userId]
      ),
      pool.query(
        'SELECT credits_remaining FROM users WHERE id = $1',
        [userId]
      ),
    ]);

    const posted = parseInt(postsResult.rows[0]?.count || 0);
    const failed = parseInt(failedResult.rows[0]?.count || 0);
    const generated = parseInt(generatedResult.rows[0]?.count || 0);
    const credits = parseFloat(creditsResult.rows[0]?.credits_remaining || 0);

    // Only send if there's something to report
    if (posted === 0 && failed === 0 && generated === 0) return;

    const subject = `📊 Your weekly summary — ${posted} posted, ${failed} failed — ${PLATFORM_NAME}`;

    const statBlock = (label, value, color) => `
      <div style="text-align: center; flex: 1; min-width: 100px;">
        <p style="color: ${color}; font-size: 28px; font-weight: bold; margin: 0;">${value}</p>
        <p style="color: #6b7280; font-size: 12px; margin: 4px 0 0 0;">${label}</p>
      </div>`;

    const html = wrapHtmlTemplate(`
      <h2 style="color: #111827; margin: 0 0 16px 0;">
        📊 Weekly Summary
      </h2>
      <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">
        Here's how your tweets performed this past week.
      </p>
      <div style="display: flex; gap: 8px; margin: 20px 0; padding: 20px; background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
        ${statBlock('Posted', posted, '#059669')}
        ${statBlock('Failed', failed, failed > 0 ? '#dc2626' : '#6b7280')}
        ${statBlock('Generated', generated, '#2563eb')}
      </div>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
        <p style="color: #166534; font-size: 14px; margin: 0;">
          💳 Credits remaining: <strong>${credits}</strong>
        </p>
      </div>
      ${failed > 0 ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin: 12px 0;">
        <p style="color: #991b1b; font-size: 13px; margin: 0;">
          ${failed} tweet(s) failed or partially posted. Check your
          <a href="${CLIENT_URL}/calendar" style="color: #dc2626;">Calendar</a> for details.
        </p>
      </div>` : ''}
      <p style="color: #6b7280; font-size: 13px; margin-top: 20px; text-align: center;">
        <a href="${CLIENT_URL}/calendar" style="color: #2563eb;">View Calendar</a> ·
        <a href="${CLIENT_URL}/settings" style="color: #2563eb;">Manage Settings</a>
      </p>
    `);

    const text = `Weekly Summary\n\nPosted: ${posted}\nFailed: ${failed}\nGenerated by Autopilot: ${generated}\nCredits remaining: ${credits}\n\n${CLIENT_URL}/calendar`;

    await sendEmail(email, subject, html, text);
    await logEmailSent(userId, 'weekly_digest', { posted, failed, generated, credits });
  } catch (error) {
    console.error('[EmailNotif] Error in sendWeeklyDigest:', error.message);
  }
}

/**
 * Send weekly digest to all active users (called by worker)
 */
export async function sendAllWeeklyDigests() {
  try {
    // Get users who have autopilot enabled or had activity in the last 7 days
    const result = await pool.query(`
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.email IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM scheduled_tweets st
            WHERE st.user_id = u.id AND st.updated_at > NOW() - INTERVAL '7 days'
          )
          OR EXISTS (
            SELECT 1 FROM autopilot_config ac
            JOIN user_strategies us ON ac.strategy_id = us.id
            WHERE us.user_id = u.id AND ac.is_enabled = true
          )
        )
    `);

    console.log(`📧 Sending weekly digests to ${result.rows.length} active users`);
    let sent = 0;
    for (const row of result.rows) {
      try {
        await sendWeeklyDigest(row.id);
        sent++;
        // Small delay to respect Resend rate limits
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`[EmailNotif] Failed digest for user ${row.id}:`, err.message);
      }
    }
    console.log(`📧 Weekly digests: ${sent}/${result.rows.length} sent`);
  } catch (error) {
    console.error('[EmailNotif] Error sending weekly digests:', error.message);
  }
}

// ── Low Credits Check (called after each credit deduction) ─────────────────

const LOW_CREDIT_THRESHOLD = 5;

/**
 * Check credits and send low-credit warning if below threshold.
 * Call this after any credit deduction.
 */
export async function checkAndNotifyLowCredits(userId) {
  try {
    const result = await pool.query(
      'SELECT credits_remaining FROM users WHERE id = $1',
      [userId]
    );
    const credits = parseFloat(result.rows[0]?.credits_remaining || 0);
    if (credits > 0 && credits <= LOW_CREDIT_THRESHOLD) {
      await notifyLowCredits(userId, { creditsRemaining: credits });
    }
  } catch (error) {
    console.error('[EmailNotif] Error checking low credits:', error.message);
  }
}

// ── HTML Template Wrapper ──────────────────────────────────────────────────

function wrapHtmlTemplate(bodyContent) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1d4ed8, #2563eb); padding: 24px 32px;">
      <h1 style="color: white; font-size: 20px; margin: 0; font-weight: 600;">${PLATFORM_NAME}</h1>
    </div>
    <!-- Body -->
    <div style="padding: 32px;">
      ${bodyContent}
    </div>
    <!-- Footer -->
    <div style="padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">
        You're receiving this because you have email notifications enabled.
        <a href="${CLIENT_URL}/settings" style="color: #6b7280;">Manage preferences</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default {
  notifyTweetFailed,
  notifyAutopilotPaused,
  notifyLowCredits,
  checkAndNotifyLowCredits,
  sendWeeklyDigest,
  sendAllWeeklyDigests,
  updateNotificationPrefs,
  getNotificationPrefsForUser,
};
