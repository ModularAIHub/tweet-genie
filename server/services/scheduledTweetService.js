import { pool } from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { creditService } from './creditService.js';
import { mediaService } from './mediaService.js';
import { decodeHTMLEntities } from '../utils/decodeHTMLEntities.js';

class ScheduledTweetService {
  /**
   * Schedule a tweet or thread for future posting.
   * @param {Object} params
   *   - userId: UUID of the user
   *   - tweets: array of tweet strings (for thread) or single tweet
   *   - options: { scheduledFor, timezone, mediaUrls, ... }
   * @returns {Object} { scheduledId, scheduledTime }
   */
  async scheduleTweets({ userId, tweets, options = {} }) {
    // Accepts: array of strings, array of objects, or mixed
    if (!userId || !Array.isArray(tweets)) {
      throw new Error('Missing userId or tweets for scheduling');
    }

    // Flatten and sanitize tweets: allow [{content: "..."}, "..."] or ["..."]
    let flatTweets = tweets
      .map(t => (typeof t === 'string' ? t : (t && typeof t.content === 'string' ? t.content : '')))
      .map(t => (t || '').trim())
      .filter(t => t.length > 0);

    if (flatTweets.length === 0) {
      throw new Error('No valid tweets to schedule');
    }

    const scheduledFor = options.scheduledFor || options.scheduled_for || new Date();
    const timezone = options.timezone || 'UTC';
    const mediaUrls = options.mediaUrls || options.media_urls || [];

    // Main tweet is first, rest are thread
    const mainContent = flatTweets[0];
    const threadTweets = flatTweets.length > 1 ? flatTweets.slice(1).map(content => ({ content })) : [];

    // Insert into scheduled_tweets
    const insertQuery = `
      INSERT INTO scheduled_tweets
        (user_id, scheduled_for, timezone, status, content, media_urls, thread_tweets, created_at, updated_at)
      VALUES
        ($1, $2, $3, 'pending', $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, scheduled_for;
    `;
    const values = [
      userId,
      scheduledFor,
      timezone,
      mainContent,
      JSON.stringify(mediaUrls),
      JSON.stringify(threadTweets)
    ];

    const { rows } = await pool.query(insertQuery, values);
    return {
      scheduledId: rows[0].id,
      scheduledTime: rows[0].scheduled_for
    };
  }
  // For BullMQ worker: process a scheduled tweet by its ID
  async processSingleScheduledTweetById(scheduledTweetId) {
    // Fetch the scheduled tweet and related info
    // First, get the scheduled tweet row
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_tweets WHERE id = $1`,
      [scheduledTweetId]
    );
    if (!rows.length) {
      throw new Error(`Scheduled tweet not found: ${scheduledTweetId}`);
    }
    const scheduledTweet = rows[0];

    let accountRow = null;
    let accountType = 'personal';
    // If account_id is present, it's a team account
    if (scheduledTweet.account_id) {
      // Team account
      const teamAccountRes = await pool.query(
        `SELECT * FROM team_accounts WHERE id = $1 AND active = true`,
        [scheduledTweet.account_id]
      );
      if (!teamAccountRes.rows.length) {
        throw new Error(`Team account not found or inactive: ${scheduledTweet.account_id}`);
      }
      accountRow = teamAccountRes.rows[0];
      accountType = 'team';
    } else {
      // Personal account
      const personalRes = await pool.query(
        `SELECT * FROM twitter_auth WHERE user_id = $1`,
        [scheduledTweet.user_id]
      );
      if (!personalRes.rows.length) {
        throw new Error(`Personal twitter_auth not found for user: ${scheduledTweet.user_id}`);
      }
      accountRow = personalRes.rows[0];
    }

    // Attach credentials to scheduledTweet for posting
    scheduledTweet.access_token = accountRow.access_token;
    scheduledTweet.twitter_username = accountRow.twitter_username || accountRow.username;
    scheduledTweet.oauth1_access_token = accountRow.oauth1_access_token;
    scheduledTweet.oauth1_access_token_secret = accountRow.oauth1_access_token_secret;
    scheduledTweet.isTeamAccount = accountType === 'team';

    await this.processSingleScheduledTweet(scheduledTweet);
  }
  async processScheduledTweets() {
    try {
      // Get tweets scheduled for now or earlier
      const { rows: scheduledTweets } = await pool.query(
        `SELECT st.*, ta.access_token, ta.twitter_username
         FROM scheduled_tweets st
         JOIN twitter_auth ta ON st.user_id = ta.user_id
         WHERE st.status = 'pending' 
         AND st.scheduled_for <= NOW()
         ORDER BY st.scheduled_for ASC
         LIMIT 10`
      );

      for (const scheduledTweet of scheduledTweets) {
        await this.processSingleScheduledTweet(scheduledTweet);
      }

      if (scheduledTweets.length > 0) {
        console.log(`Processed ${scheduledTweets.length} scheduled tweets`);
      }

    } catch (error) {
      console.error('Error processing scheduled tweets:', error);
    }
  }

  async processSingleScheduledTweet(scheduledTweet) {
    try {
      // Mark as processing
      await pool.query(
        'UPDATE scheduled_tweets SET status = $1 WHERE id = $2',
        ['processing', scheduledTweet.id]
      );

      // Create Twitter client with OAuth 2.0
      const twitterClient = new TwitterApi(scheduledTweet.access_token);


      // Use stored media IDs directly if present
      let mediaIds = [];
      if (scheduledTweet.media_urls) {
        try {
          // Parse media_urls if it's a JSON string or array
          let parsed = scheduledTweet.media_urls;
          if (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed);
            } catch (e) {
              // fallback: treat as comma-separated string
              parsed = parsed.split(',').map(x => x.trim()).filter(Boolean);
            }
          }
          if (Array.isArray(parsed)) {
            // Only use as media IDs if all are strings and look like Twitter media IDs (digits)
            if (parsed.every(x => typeof x === 'string' && /^\d+$/.test(x))) {
              mediaIds = parsed;
            }
          }
        } catch (mediaParseError) {
          console.error('Error parsing media_urls for scheduled tweet:', mediaParseError);
        }
      }

      // Parse per-tweet media for thread tweets
      let threadMediaArr = [];
      if (scheduledTweet.thread_media) {
        try {
          if (typeof scheduledTweet.thread_media === 'string') {
            threadMediaArr = JSON.parse(scheduledTweet.thread_media);
          } else if (Array.isArray(scheduledTweet.thread_media)) {
            threadMediaArr = scheduledTweet.thread_media;
          }
        } catch (e) {
          threadMediaArr = [];
        }
      }

      // Post main tweet with media IDs if present, decode HTML entities ONCE
      // Log for debugging encoding issues
      console.log('[Thread Unicode Debug] Posting main tweet:', scheduledTweet.content);
      const tweetData = {
        text: decodeHTMLEntities(scheduledTweet.content),
        ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
      };

      const tweetResponse = await twitterClient.v2.tweet(tweetData);

      // Handle thread if present
      if (scheduledTweet.thread_tweets && scheduledTweet.thread_tweets.length > 0) {
        let previousTweetId = tweetResponse.data.id;
        for (let i = 0; i < scheduledTweet.thread_tweets.length; i++) {
          const threadTweet = scheduledTweet.thread_tweets[i];
          // Log for debugging encoding issues
          console.log('[Thread Unicode Debug] Posting thread tweet:', threadTweet.content);
          let threadMediaIds = Array.isArray(threadMediaArr) && threadMediaArr[i + 1] ? threadMediaArr[i + 1] : [];
          // threadMediaArr[0] is for main tweet, [1] for first thread tweet, etc.
          const threadTweetData = {
            text: decodeHTMLEntities(threadTweet.content),
            reply: { in_reply_to_tweet_id: previousTweetId },
            ...(Array.isArray(threadMediaIds) && threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
          };
          const threadResponse = await twitterClient.v2.tweet(threadTweetData);
          previousTweetId = threadResponse.data.id;
        }
      }

      // Update tweet with actual Twitter ID
      await pool.query(
        `UPDATE tweets SET 
          tweet_id = $1, 
          status = 'posted', 
          posted_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [tweetResponse.data.id, scheduledTweet.tweet_id]
      );

      // Mark scheduled tweet as completed
      await pool.query(
        'UPDATE scheduled_tweets SET status = $1, posted_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['completed', scheduledTweet.id]
      );

      console.log(`Successfully posted scheduled tweet: ${scheduledTweet.id}`);

    } catch (error) {
      console.error(`Error posting scheduled tweet ${scheduledTweet.id}:`, error);

      // Mark as failed and optionally refund credits
      await pool.query(
        'UPDATE scheduled_tweets SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message, scheduledTweet.id]
      );

      // Refund credits if the tweet failed to post
      try {
        const { rows: tweetRows } = await pool.query(
          'SELECT user_id, credits_used FROM tweets WHERE id = $1',
          [scheduledTweet.tweet_id]
        );

        if (tweetRows.length > 0) {
          await creditService.refundCredits(
            tweetRows[0].user_id,
            'scheduled_tweet_failed',
            tweetRows[0].credits_used
          );
        }
      } catch (refundError) {
        console.error('Error refunding credits for failed scheduled tweet:', refundError);
      }
    }
  }

  async reuploadMedia(mediaUrls, twitterClient) {
    // This is a simplified implementation
    // In production, you'd want to store media files temporarily
    // and retrieve them here for re-upload
    const mediaIds = [];

    for (const mediaUrl of mediaUrls) {
      try {
        // For now, skip media re-upload in scheduled tweets
        // This would need proper media storage implementation
        console.log(`Skipping media re-upload for scheduled tweet: ${mediaUrl}`);
      } catch (error) {
        console.error('Media re-upload error:', error);
      }
    }

    return mediaIds;
  }

  async getScheduledCount(userId) {
    try {
      const { rows } = await pool.query(
        'SELECT COUNT(*) FROM scheduled_tweets WHERE user_id = $1 AND status = $2',
        [userId, 'pending']
      );

      return parseInt(rows[0].count);
    } catch (error) {
      console.error('Error getting scheduled count:', error);
      return 0;
    }
  }

  async cancelExpiredSchedules() {
    try {
      // Cancel schedules that are more than 24 hours overdue
      const { rows } = await pool.query(
        `UPDATE scheduled_tweets 
         SET status = 'expired', error_message = 'Schedule expired'
         WHERE status = 'pending' 
         AND scheduled_for < NOW() - INTERVAL '24 hours'
         RETURNING id`
      );

      if (rows.length > 0) {
        console.log(`Cancelled ${rows.length} expired scheduled tweets`);
      }
    } catch (error) {
      console.error('Error cancelling expired schedules:', error);
    }
  }
}

export const scheduledTweetService = new ScheduledTweetService();
