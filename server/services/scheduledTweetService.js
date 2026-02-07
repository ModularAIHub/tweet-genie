import { pool } from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { creditService } from './creditService.js';
import { mediaService } from './mediaService.js';
import { decodeHTMLEntities } from '../utils/decodeHTMLEntities.js';

// Helper function to strip markdown formatting
function stripMarkdown(text) {
  if (!text) return text;
  
  let cleaned = text;
  
  // Remove bold: **text** or __text__
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  
  // Remove italic: *text* or _text_ (but not underscores in URLs or middle of words)
  cleaned = cleaned.replace(/\*([^*\s][^*]*[^*\s])\*/g, '$1');
  cleaned = cleaned.replace(/(?<!\w)_([^_\s][^_]*[^_\s])_(?!\w)/g, '$1');
  
  // Remove headers: # text, ## text, etc.
  cleaned = cleaned.replace(/^#{1,6}\s+(.+)$/gm, '$1');
  
  // Remove strikethrough: ~~text~~
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
  
  // Remove code blocks: `code` or ```code```
  cleaned = cleaned.replace(/```[^`]*```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  
  return cleaned.trim();
}

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

    // Extract team_id and account_id from options
    const teamId = options.teamId || options.team_id || null;
    const accountId = options.accountId || options.account_id || null;

    // Insert into scheduled_tweets with team_id and account_id
    const insertQuery = `
      INSERT INTO scheduled_tweets
        (user_id, scheduled_for, timezone, status, content, media_urls, thread_tweets, team_id, account_id, created_at, updated_at)
      VALUES
        ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, scheduled_for;
    `;
    const values = [
      userId,
      scheduledFor,
      timezone,
      mainContent,
      JSON.stringify(mediaUrls),
      JSON.stringify(threadTweets),
      teamId,
      accountId
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
    // Use account_id for team scheduled tweets
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
    } else if (scheduledTweet.team_id) {
      // Fallback: find team account by team_id
      const teamAccountRes = await pool.query(
        `SELECT * FROM team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
        [scheduledTweet.team_id]
      );
      if (!teamAccountRes.rows.length) {
        throw new Error(`Team account not found or inactive: ${scheduledTweet.team_id}`);
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
      // Get tweets scheduled for now or earlier that are approved
      const { rows: scheduledTweets } = await pool.query(
        `SELECT st.*, ta.access_token, ta.twitter_username
         FROM scheduled_tweets st
         JOIN twitter_auth ta ON st.user_id = ta.user_id
         WHERE st.status = 'pending' 
         AND st.scheduled_for <= NOW()
         AND st.approval_status = 'approved'
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

      // Validate access token exists
      if (!scheduledTweet.access_token) {
        throw new Error('No Twitter access token found. Please reconnect your Twitter account.');
      }

      // Create Twitter client with OAuth 2.0
      let twitterClient;
      try {
        twitterClient = new TwitterApi(scheduledTweet.access_token);
        // Test the connection
        await twitterClient.v2.me();
      } catch (authError) {
        if (authError.code === 401 || authError.status === 401) {
          throw new Error('Twitter authentication failed (401). Token may be expired. Please reconnect your Twitter account.');
        }
        throw authError;
      }


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
      const cleanContent = stripMarkdown(scheduledTweet.content);
      console.log('[Thread Unicode Debug] Posting main tweet:', cleanContent);
      const tweetData = {
        text: decodeHTMLEntities(cleanContent),
        ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
      };

      const tweetResponse = await twitterClient.v2.tweet(tweetData);
      console.log(`✅ Main tweet posted successfully: ${tweetResponse.data.id}`);

      // Handle thread if present
      let threadSuccess = true;
      let threadError = null;
      const threadTweetIds = []; // Store all thread tweet IDs and content for inserting into history
      
      if (scheduledTweet.thread_tweets && scheduledTweet.thread_tweets.length > 0) {
        let previousTweetId = tweetResponse.data.id;
        for (let i = 0; i < scheduledTweet.thread_tweets.length; i++) {
          try {
            // Add delay between thread tweets to avoid rate limiting (2 seconds)
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            const threadTweet = scheduledTweet.thread_tweets[i];
            // Log for debugging encoding issues
            const cleanThreadContent = stripMarkdown(threadTweet.content);
            console.log(`[Thread ${i + 1}/${scheduledTweet.thread_tweets.length}] Posting:`, cleanThreadContent);
            let threadMediaIds = Array.isArray(threadMediaArr) && threadMediaArr[i + 1] ? threadMediaArr[i + 1] : [];
            // threadMediaArr[0] is for main tweet, [1] for first thread tweet, etc.
            const threadTweetData = {
              text: decodeHTMLEntities(cleanThreadContent),
              reply: { in_reply_to_tweet_id: previousTweetId },
              ...(Array.isArray(threadMediaIds) && threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
            };
            const threadResponse = await twitterClient.v2.tweet(threadTweetData);
            previousTweetId = threadResponse.data.id;
            
            // Store thread tweet info for history insertion
            threadTweetIds.push({
              tweetId: threadResponse.data.id,
              content: cleanThreadContent,
              mediaIds: threadMediaIds
            });
            
            console.log(`✅ Thread tweet ${i + 1} posted successfully: ${threadResponse.data.id}`);
          } catch (threadErr) {
            console.error(`❌ Error posting thread tweet ${i + 1}:`, threadErr);
            threadSuccess = false;
            threadError = threadErr;
            
            // Check if it's a 403 duplicate error
            if (threadErr.code === 403 || (threadErr.data && threadErr.data.status === 403)) {
              console.error('⚠️ Thread failed with 403 - likely duplicate content. Main tweet was posted successfully.');
            }
            break; // Stop posting remaining thread tweets
          }
        }
      }

      // Insert into tweets table for history tracking
      const tweetInsertQuery = `
        INSERT INTO tweets (
          user_id, content, tweet_id, status, posted_at, 
          source, account_id, created_at, updated_at
        ) VALUES ($1, $2, $3, 'posted', CURRENT_TIMESTAMP, 'platform', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `;
      
      const accountId = scheduledTweet.account_id || null;
      const { rows: insertedTweet } = await pool.query(tweetInsertQuery, [
        scheduledTweet.user_id,
        cleanContent,
        tweetResponse.data.id,
        accountId
      ]);
      
      console.log(`Inserted main tweet into history with ID: ${insertedTweet[0].id}`);
      
      // Insert each thread tweet as a separate record in history
      if (threadTweetIds.length > 0) {
        for (const threadTweet of threadTweetIds) {
          await pool.query(tweetInsertQuery, [
            scheduledTweet.user_id,
            threadTweet.content,
            threadTweet.tweetId,
            accountId
          ]);
        }
        console.log(`Inserted ${threadTweetIds.length} additional thread tweets into history`);
      }

      // Mark scheduled tweet as completed or partially completed
      const finalStatus = threadSuccess ? 'completed' : 'partially_completed';
      const errorMsg = threadSuccess ? null : `Main tweet posted, but thread failed: ${threadError?.message || 'Unknown error'}`;
      
      await pool.query(
        'UPDATE scheduled_tweets SET status = $1, posted_at = CURRENT_TIMESTAMP, error_message = $2 WHERE id = $3',
        [finalStatus, errorMsg, scheduledTweet.id]
      );

      if (threadSuccess) {
        console.log(`✅ Successfully posted scheduled tweet and thread: ${scheduledTweet.id}`);
      } else {
        console.log(`⚠️ Main tweet posted but thread failed: ${scheduledTweet.id}`);
      }
      
      // Return early to prevent any further processing
      return;

    } catch (error) {
      console.error(`❌ Error posting scheduled tweet ${scheduledTweet.id}:`, error);
      
      // Log detailed error information
      let errorMessage = error.message || 'Unknown error';
      if (error.code === 401 || error.status === 401) {
        console.error('❌ Twitter 401 Error - Authentication failed');
        console.error('   - Access token may be expired or invalid');
        console.error('   - User needs to reconnect their Twitter account');
        errorMessage = 'Twitter authentication failed (401). Please reconnect your Twitter account.';
      } else if (error.code === 403) {
        console.error('❌ Twitter 403 Error - This is usually caused by:');
        console.error('   - Duplicate content (same tweet posted recently)');
        console.error('   - Rate limit exceeded');
        console.error('   - Tweet violates Twitter rules');
        errorMessage = `Twitter error (403): ${error.data?.detail || error.message || 'Forbidden - likely duplicate or rate limit'}`;
        
        // Mark as failed and DON'T retry for duplicate content
        await pool.query(
          'UPDATE scheduled_tweets SET status = $1, error_message = $2 WHERE id = $3',
          ['failed', errorMessage, scheduledTweet.id]
        );
        
        // Don't throw error - this prevents BullMQ from retrying
        console.log('🛑 Not retrying 403 error (likely duplicate content)');
        return;
      } else if (error.code === 429) {
        console.error('❌ Twitter 429 Error - Rate limit exceeded');
        errorMessage = 'Twitter rate limit exceeded. Will retry later.';
      }
      
      console.error('   Full error:', JSON.stringify(error, null, 2));

      // Mark as failed
      await pool.query(
        'UPDATE scheduled_tweets SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', errorMessage, scheduledTweet.id]
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
