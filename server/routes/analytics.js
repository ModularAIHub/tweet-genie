import express from 'express';
import pool from '../config/database.js';
import { validateRequest, analyticsQuerySchema } from '../middleware/validation.js';
import { TwitterApi } from 'twitter-api-v2';
import { authenticateToken, validateTwitterConnection } from '../middleware/auth.js';

const router = express.Router();

// Get analytics overview
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get comprehensive tweet metrics (both platform and external tweets)
    const { rows: tweetMetrics } = await pool.query(
      `SELECT 
        COUNT(*) as total_tweets,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        SUM(impressions) as total_impressions,
        SUM(likes) as total_likes,
        SUM(retweets) as total_retweets,
        SUM(replies) as total_replies,
        SUM(COALESCE(quote_count, 0)) as total_quotes,
        SUM(COALESCE(bookmark_count, 0)) as total_bookmarks,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        SUM(impressions + likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)) as total_engagement,
        CASE WHEN SUM(impressions) > 0 THEN 
          ROUND((SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0))::DECIMAL / SUM(impressions)) * 100, 2) 
        ELSE 0 END as engagement_rate,
        COUNT(CASE WHEN likes > 0 OR retweets > 0 OR replies > 0 OR COALESCE(quote_count, 0) > 0 OR COALESCE(bookmark_count, 0) > 0 THEN 1 END) as engaging_tweets,
        MAX(impressions) as max_impressions,
        MAX(likes) as max_likes,
        MAX(retweets) as max_retweets,
        MAX(replies) as max_replies,
        MAX(COALESCE(quote_count, 0)) as max_quotes,
        MAX(COALESCE(bookmark_count, 0)) as max_bookmarks
       FROM tweets 
       WHERE user_id = $1 
       AND (created_at >= $2 OR external_created_at >= $2) 
       AND status = 'posted'`,
      [userId, startDate]
    );

    // Get daily metrics for chart with engagement calculations (both platform and external)
    const { rows: dailyMetrics } = await pool.query(
      `SELECT 
        DATE(COALESCE(external_created_at, created_at)) as date,
        COUNT(*) as tweets_count,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        SUM(impressions) as impressions,
        SUM(likes) as likes,
        SUM(retweets) as retweets,
        SUM(replies) as replies,
        SUM(COALESCE(quote_count, 0)) as quotes,
        SUM(COALESCE(bookmark_count, 0)) as bookmarks,
        SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)) as total_engagement,
        CASE WHEN SUM(impressions) > 0 THEN 
          ROUND((SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0))::DECIMAL / SUM(impressions)) * 100, 2) 
        ELSE 0 END as engagement_rate,
        AVG(impressions) as avg_impressions_per_tweet,
        AVG(likes) as avg_likes_per_tweet
       FROM tweets 
       WHERE user_id = $1 
       AND (created_at >= $2 OR external_created_at >= $2) 
       AND status = 'posted'
       GROUP BY DATE(COALESCE(external_created_at, created_at))
       ORDER BY date DESC`,
      [userId, startDate]
    );

    // Get top performing tweets with engagement scores (both platform and external)
    const { rows: topTweets } = await pool.query(
      `SELECT 
        id, content, impressions, likes, retweets, replies, 
        COALESCE(quote_count, 0) as quote_count, 
        COALESCE(bookmark_count, 0) as bookmark_count,
        source, COALESCE(external_created_at, created_at) as created_at,
        (impressions + likes * 2 + retweets * 3 + replies * 2 + COALESCE(quote_count, 0) * 2 + COALESCE(bookmark_count, 0)) as engagement_score,
        CASE WHEN impressions > 0 THEN 
          ROUND(((likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0))::DECIMAL / impressions) * 100, 2) 
        ELSE 0 END as tweet_engagement_rate
       FROM tweets 
       WHERE user_id = $1 
       AND (created_at >= $2 OR external_created_at >= $2) 
       AND status = 'posted'
       ORDER BY engagement_score DESC
       LIMIT 10`,
      [userId, startDate]
    );

    // Get engagement breakdown by hour to find best posting times
    const { rows: hourlyEngagement } = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        AVG(likes + retweets + replies) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY avg_engagement DESC`,
      [userId, startDate]
    );

    // Get thread vs single tweet performance
    const { rows: contentTypeMetrics } = await pool.query(
      `SELECT 
        CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread' ELSE 'single' END as content_type,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        AVG(likes + retweets + replies) as avg_total_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread' ELSE 'single' END`,
      [userId, startDate]
    );

    // Get growth metrics (compare with previous period)
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - parseInt(days));

    const { rows: previousMetrics } = await pool.query(
      `SELECT 
        COUNT(*) as prev_total_tweets,
        SUM(impressions) as prev_total_impressions,
        SUM(likes) as prev_total_likes,
        SUM(retweets) as prev_total_retweets,
        SUM(replies) as prev_total_replies
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND created_at < $3 AND status = 'posted'`,
      [userId, previousStartDate, startDate]
    );

    res.json({
      overview: tweetMetrics[0],
      daily_metrics: dailyMetrics,
      top_tweets: topTweets,
      hourly_engagement: hourlyEngagement,
      content_type_metrics: contentTypeMetrics,
      growth: {
        current: tweetMetrics[0],
        previous: previousMetrics[0] || {}
      }
    });

  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// Sync comprehensive analytics from Twitter (both platform and external tweets)
router.post('/sync', validateTwitterConnection, async (req, res) => {
  try {
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

    // Use OAuth 2.0 Bearer token for analytics (Twitter API v2)
    const twitterClient = new TwitterApi(twitterAccount.access_token);

    console.log('🔄 Starting comprehensive analytics sync...');

    // Only update metrics for tweets posted from our platform
    console.log('📊 Updating analytics for platform tweets only...');
    const { rows: tweetsToUpdate } = await pool.query(
      `SELECT id, tweet_id, content FROM tweets 
       WHERE user_id = $1 AND status = 'posted' AND source = 'platform'
       AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC LIMIT 200`,
      [userId]
    );

    let updatedCount = 0;
    let errorCount = 0;
    const updatePromises = [];

    // Process tweets in batches to avoid rate limiting
    const batchSize = 25;
    for (let i = 0; i < tweetsToUpdate.length; i += batchSize) {
      const batch = tweetsToUpdate.slice(i, i + batchSize);
      for (const tweet of batch) {
        if (!tweet.tweet_id) continue;
        try {
          // Get basic tweet metrics from Twitter API v2 (public metrics only)
          const tweetData = await twitterClient.v2.singleTweet(tweet.tweet_id, {
            'tweet.fields': [
              'public_metrics',
              'created_at'
            ]
          });
          if (tweetData.data) {
            const data = tweetData.data;
            const publicMetrics = data.public_metrics || {};
            // Update metrics in database with public data
            const updatePromise = pool.query(
              `UPDATE tweets SET 
                impressions = $1,
                likes = $2,
                retweets = $3,
                replies = $4,
                quote_count = $5,
                bookmark_count = $6,
                updated_at = CURRENT_TIMESTAMP
               WHERE id = $7`,
              [
                publicMetrics.impression_count || 0,
                publicMetrics.like_count || 0,
                publicMetrics.retweet_count || 0,
                publicMetrics.reply_count || 0,
                publicMetrics.quote_count || 0,
                publicMetrics.bookmark_count || 0,
                tweet.id
              ]
            );
            updatePromises.push(updatePromise);
            updatedCount++;
          }
        } catch (tweetError) {
          console.error(`Error updating metrics for tweet ${tweet.tweet_id}:`, tweetError.message);
          errorCount++;
          // If tweet is deleted or not found, mark it
          if (tweetError.code === 144 || tweetError.status === 404) {
            await pool.query(
              `UPDATE tweets SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [tweet.id]
            );
          }
        }
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Wait between batches
      if (i + batchSize < tweetsToUpdate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    // Execute all updates
    await Promise.all(updatePromises);
    // Get user's Twitter profile for additional insights
    try {
      const userProfile = await twitterClient.v2.me({
        'user.fields': ['public_metrics', 'verified', 'created_at']
      });
      const profileMetrics = userProfile.data?.public_metrics || {};
      const followerInsights = {
        followers_count: profileMetrics.followers_count || 0,
        following_count: profileMetrics.following_count || 0,
        tweet_count: profileMetrics.tweet_count || 0,
        listed_count: profileMetrics.listed_count || 0,
        verified: userProfile.data?.verified || false
      };
      console.log(`✅ Platform analytics sync complete:
       Metrics updated: ${updatedCount}
      ❌ Errors: ${errorCount}`);
      res.json({
        success: true,
        message: `Platform analytics sync completed. Updated ${updatedCount} metrics${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
        stats: {
          metrics_updated: updatedCount,
          errors: errorCount,
          total_processed: tweetsToUpdate.length
        },
        profile_insights: followerInsights
      });
    } catch (profileError) {
      console.error('Error fetching profile metrics:', profileError);
      res.json({
        success: true,
        message: `Platform sync completed. Updated ${updatedCount} metrics${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
        stats: {
          metrics_updated: updatedCount,
          errors: errorCount,
          total_processed: tweetsToUpdate.length
        },
        profile_error: 'Could not fetch profile insights'
      });
    }

  } catch (error) {
    console.error('Comprehensive sync analytics error:', error);
    
    // Handle Twitter API rate limiting
    if (error.code === 429) {
      const resetTime = error.rateLimit?.reset ? new Date(error.rateLimit.reset * 1000) : null;
      const waitMinutes = resetTime ? Math.ceil((resetTime - new Date()) / 60000) : 15;
      
      return res.status(429).json({ 
        error: 'Twitter API rate limit exceeded',
        message: `Please wait ${waitMinutes} minutes before trying again`,
        resetTime: resetTime?.toISOString(),
        waitMinutes: waitMinutes,
        type: 'rate_limit'
      });
    }
    
    // Handle other Twitter API errors
    if (error.code && error.code >= 400) {
      return res.status(error.code).json({ 
        error: 'Twitter API error',
        message: error.data?.detail || error.message || 'Unknown Twitter API error',
        type: 'twitter_api_error'
      });
    }
    
    // Handle generic errors
    res.status(500).json({ 
      error: 'Failed to sync comprehensive analytics data',
      message: error.message || 'Unknown error occurred',
      type: 'server_error'
    });
  }
});

// Get detailed engagement insights
router.get('/engagement', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get engagement patterns by content type
    const { rows: engagementPatterns } = await pool.query(
      `SELECT 
        CASE 
          WHEN content LIKE '%#%' THEN 'with_hashtags'
          ELSE 'no_hashtags'
        END as hashtag_usage,
        CASE 
          WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread'
          ELSE 'single'
        END as content_type,
        CASE 
          WHEN LENGTH(content) <= 100 THEN 'short'
          WHEN LENGTH(content) <= 200 THEN 'medium'
          ELSE 'long'
        END as content_length,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        AVG(likes + retweets + replies) as avg_total_engagement,
        CASE WHEN AVG(impressions) > 0 THEN 
          ROUND((AVG(likes + retweets + replies) / AVG(impressions)) * 100, 2) 
        ELSE 0 END as avg_engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY hashtag_usage, content_type, content_length
       ORDER BY avg_total_engagement DESC`,
      [userId, startDate]
    );

    // Get best performing times
    const { rows: timeAnalysis } = await pool.query(
      `SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        EXTRACT(HOUR FROM created_at) as hour_of_day,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes + retweets + replies) as avg_engagement,
        CASE WHEN AVG(impressions) > 0 THEN 
          ROUND((AVG(likes + retweets + replies) / AVG(impressions)) * 100, 2) 
        ELSE 0 END as avg_engagement_rate
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
       HAVING COUNT(*) >= 2
       ORDER BY avg_engagement DESC
       LIMIT 20`,
      [userId, startDate]
    );

    // Get content performance insights
    const { rows: contentInsights } = await pool.query(
      `SELECT 
        'hashtag_performance' as insight_type,
        CASE WHEN content LIKE '%#%' THEN 'with_hashtags' ELSE 'without_hashtags' END as category,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes + retweets + replies) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY CASE WHEN content LIKE '%#%' THEN 'with_hashtags' ELSE 'without_hashtags' END
       
       UNION ALL
       
       SELECT 
        'thread_performance' as insight_type,
        CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'threads' ELSE 'single_tweets' END as category,
        COUNT(*) as tweets_count,
        AVG(impressions) as avg_impressions,
        AVG(likes + retweets + replies) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'threads' ELSE 'single_tweets' END`,
      [userId, startDate]
    );

    res.json({
      engagement_patterns: engagementPatterns,
      optimal_times: timeAnalysis,
      content_insights: contentInsights
    });

  } catch (error) {
    console.error('Engagement analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch engagement analytics' });
  }
});

// Get follower and reach analytics
router.get('/audience', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get reach and impression distribution
    const { rows: reachMetrics } = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        SUM(impressions) as total_impressions,
        SUM(likes + retweets + replies) as total_engagement,
        COUNT(DISTINCT CASE WHEN impressions > 0 THEN id END) as tweets_with_impressions,
        AVG(impressions) as avg_impressions_per_tweet,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY impressions) as median_impressions,
        MAX(impressions) as max_impressions,
        MIN(impressions) as min_impressions
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [userId, startDate]
    );

    // Get engagement distribution
    const { rows: engagementDistribution } = await pool.query(
      `SELECT 
        CASE 
          WHEN impressions = 0 THEN 'no_impressions'
          WHEN impressions < 100 THEN 'low_reach'
          WHEN impressions < 1000 THEN 'medium_reach'
          WHEN impressions < 10000 THEN 'high_reach'
          ELSE 'viral_reach'
        END as reach_category,
        COUNT(*) as tweets_count,
        AVG(likes) as avg_likes,
        AVG(retweets) as avg_retweets,
        AVG(replies) as avg_replies,
        AVG(impressions) as avg_impressions
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY reach_category
       ORDER BY avg_impressions DESC`,
      [userId, startDate]
    );

    res.json({
      reach_metrics: reachMetrics,
      engagement_distribution: engagementDistribution
    });

  } catch (error) {
    console.error('Audience analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch audience analytics' });
  }
});

export default router;
