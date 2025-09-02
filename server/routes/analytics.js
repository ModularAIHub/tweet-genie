import express from 'express';
import pool from '../config/database.js';
import { validateRequest, analyticsQuerySchema } from '../middleware/validation.js';
import { TwitterApi } from 'twitter-api-v2';
import { validateTwitterConnection } from '../middleware/auth.js';

const router = express.Router();

// Get analytics overview
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get tweet metrics
    const { rows: tweetMetrics } = await pool.query(
      `SELECT 
        COUNT(*) as total_tweets,
        SUM(impressions) as total_impressions,
        SUM(likes) as total_likes,
        SUM(retweets) as total_retweets,
        SUM(replies) as total_replies,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'`,
      [userId, startDate]
    );

    // Get daily metrics for chart
    const { rows: dailyMetrics } = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as tweets_count,
        SUM(impressions) as impressions,
        SUM(likes) as likes,
        SUM(retweets) as retweets
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [userId, startDate]
    );

    // Get top performing tweets
    const { rows: topTweets } = await pool.query(
      `SELECT id, content, impressions, likes, retweets, replies, created_at
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       ORDER BY (impressions + likes * 2 + retweets * 3 + replies * 2) DESC
       LIMIT 5`,
      [userId, startDate]
    );

    res.json({
      overview: tweetMetrics[0],
      daily_metrics: dailyMetrics,
      top_tweets: topTweets
    });

  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// Sync latest metrics from Twitter
router.post('/sync', validateTwitterConnection, async (req, res) => {
  try {
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

    // Create Twitter client
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: twitterAccount.access_token,
      accessSecret: twitterAccount.access_token_secret,
    });

    // Get recent tweets that need metric updates
    const { rows: tweetsToUpdate } = await pool.query(
      `SELECT id, tweet_id FROM tweets 
       WHERE user_id = $1 AND status = 'posted' 
       AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    let updatedCount = 0;

    for (const tweet of tweetsToUpdate) {
      try {
        // Get tweet metrics from Twitter API
        const tweetData = await twitterClient.v2.singleTweet(tweet.tweet_id, {
          'tweet.fields': ['public_metrics']
        });

        if (tweetData.data && tweetData.data.public_metrics) {
          const metrics = tweetData.data.public_metrics;

          // Update metrics in database
          await pool.query(
            `UPDATE tweets SET 
              impressions = $1,
              likes = $2,
              retweets = $3,
              replies = $4,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [
              metrics.impression_count || 0,
              metrics.like_count || 0,
              metrics.retweet_count || 0,
              metrics.reply_count || 0,
              tweet.id
            ]
          );

          updatedCount++;
        }
      } catch (tweetError) {
        console.error(`Error updating metrics for tweet ${tweet.tweet_id}:`, tweetError);
        // Continue with other tweets
      }
    }

    res.json({
      success: true,
      message: `Updated metrics for ${updatedCount} tweets`,
      updated_count: updatedCount
    });

  } catch (error) {
    console.error('Sync analytics error:', error);
    res.status(500).json({ error: 'Failed to sync analytics data' });
  }
});

export default router;
