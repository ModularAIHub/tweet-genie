import { pool } from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { creditService } from './creditService.js';
import { mediaService } from './mediaService.js';

class ScheduledTweetService {
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

      // Handle media upload if present
      let mediaIds = [];
      if (scheduledTweet.media_urls && scheduledTweet.media_urls.length > 0) {
        try {
          // Re-upload media for scheduled tweets
          // Note: In production, you might want to store media temporarily
          mediaIds = await this.reuploadMedia(scheduledTweet.media_urls, twitterClient);
        } catch (mediaError) {
          console.error('Media upload error for scheduled tweet:', mediaError);
          // Continue without media rather than failing the entire tweet
        }
      }

      // Post main tweet
      const tweetData = {
        text: scheduledTweet.content,
        ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
      };

      const tweetResponse = await twitterClient.v2.tweet(tweetData);

      // Handle thread if present
      if (scheduledTweet.thread_tweets && scheduledTweet.thread_tweets.length > 0) {
        let previousTweetId = tweetResponse.data.id;

        for (const threadTweet of scheduledTweet.thread_tweets) {
          const threadTweetData = {
            text: threadTweet.content,
            reply: { in_reply_to_tweet_id: previousTweetId }
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
