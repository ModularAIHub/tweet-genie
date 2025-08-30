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

    // Get credit usage
    const { rows: creditUsage } = await pool.query(
      `SELECT 
        SUM(credits_used) as total_credits_used,
        COUNT(*) as total_operations
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2`,
      [userId, startDate]
    );

    res.json({
      overview: tweetMetrics[0],
      daily_metrics: dailyMetrics,
      top_tweets: topTweets,
      credit_usage: creditUsage[0]
    });

  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// Get detailed analytics
router.post('/detailed', validateRequest(analyticsQuerySchema), async (req, res) => {
  try {
    const { start_date, end_date, metrics = ['impressions', 'likes', 'retweets', 'replies'] } = req.body;
    const userId = req.user.id;

    // Build dynamic query based on requested metrics
    const metricColumns = metrics.map(metric => `SUM(${metric}) as total_${metric}`).join(', ');
    const avgColumns = metrics.map(metric => `AVG(${metric}) as avg_${metric}`).join(', ');

    const { rows: aggregatedMetrics } = await pool.query(
      `SELECT 
        COUNT(*) as total_tweets,
        ${metricColumns},
        ${avgColumns}
       FROM tweets 
       WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 AND status = 'posted'`,
      [userId, start_date, end_date]
    );

    // Get time series data
    const { rows: timeSeriesData } = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as tweets_count,
        ${metricColumns}
       FROM tweets 
       WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [userId, start_date, end_date]
    );

    // Get engagement rate trends
    const { rows: engagementTrends } = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        CASE 
          WHEN SUM(impressions) > 0 
          THEN ROUND((SUM(likes) + SUM(retweets) + SUM(replies)) * 100.0 / SUM(impressions), 2)
          ELSE 0 
        END as engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [userId, start_date, end_date]
    );

    res.json({
      aggregated_metrics: aggregatedMetrics[0],
      time_series: timeSeriesData,
      engagement_trends: engagementTrends
    });

  } catch (error) {
    console.error('Detailed analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch detailed analytics' });
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
       WHERE user_id = $1 AND twitter_account_id = $2 
       AND status = 'posted' AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 20`,
      [userId, twitterAccount.id]
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

// Get hashtag performance
router.get('/hashtags', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Extract hashtags from tweet content and calculate performance
    const { rows: hashtagData } = await pool.query(
      `SELECT 
        hashtag,
        COUNT(*) as usage_count,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        SUM(impressions + likes + retweets + replies) as total_engagement
       FROM (
         SELECT 
           LOWER(TRIM(regexp_split_to_table(content, '#[\\w]+', 'g'))) as hashtag,
           impressions, likes, retweets, replies
         FROM tweets 
         WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
         AND content ~ '#[\\w]+'
       ) hashtag_tweets
       WHERE hashtag != ''
       GROUP BY hashtag
       HAVING COUNT(*) >= 2
       ORDER BY total_engagement DESC
       LIMIT 20`,
      [userId, startDate]
    );

    res.json({ hashtag_performance: hashtagData });

  } catch (error) {
    console.error('Hashtag analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch hashtag analytics' });
  }
});

export default router;
