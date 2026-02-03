import express from 'express';
import pool from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';
import { authenticateToken, validateTwitterConnection } from '../middleware/auth.js';

const router = express.Router();

// Get analytics overview
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;
    const accountId = req.headers['x-selected-account-id'];

    console.log('📊 Fetching analytics overview for user:', userId, 'account:', accountId, 'days:', days);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get comprehensive tweet metrics (both platform and external tweets)
    const { rows: tweetMetrics } = await pool.query(
      `SELECT 
        COUNT(*) as total_tweets,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(retweets), 0) as total_retweets,
        COALESCE(SUM(replies), 0) as total_replies,
        COALESCE(SUM(quote_count), 0) as total_quotes,
        COALESCE(SUM(bookmark_count), 0) as total_bookmarks,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0) as total_engagement,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN 
          ROUND((COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0)::DECIMAL / COALESCE(SUM(impressions), 1)::DECIMAL) * 100, 2) 
        ELSE 0 END as engagement_rate,
        COUNT(CASE WHEN likes > 0 OR retweets > 0 OR replies > 0 OR COALESCE(quote_count, 0) > 0 OR COALESCE(bookmark_count, 0) > 0 THEN 1 END) as engaging_tweets,
        COALESCE(MAX(impressions), 0) as max_impressions,
        COALESCE(MAX(likes), 0) as max_likes,
        COALESCE(MAX(retweets), 0) as max_retweets,
        COALESCE(MAX(replies), 0) as max_replies,
        COALESCE(MAX(quote_count), 0) as max_quotes,
        COALESCE(MAX(bookmark_count), 0) as max_bookmarks
       FROM tweets 
       WHERE user_id = $1 
       AND (created_at >= $2 OR external_created_at >= $2) 
       AND status = 'posted'
       ${accountId ? 'AND account_id::TEXT = $3' : ''}`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
    );

    // Get daily metrics for chart
    const { rows: dailyMetrics } = await pool.query(
      `SELECT 
        DATE(COALESCE(external_created_at, created_at)) as date,
        COUNT(*) as tweets_count,
        COUNT(CASE WHEN source = 'platform' THEN 1 END) as platform_tweets,
        COUNT(CASE WHEN source = 'external' THEN 1 END) as external_tweets,
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(likes), 0) as likes,
        COALESCE(SUM(retweets), 0) as retweets,
        COALESCE(SUM(replies), 0) as replies,
        COALESCE(SUM(quote_count), 0) as quotes,
        COALESCE(SUM(bookmark_count), 0) as bookmarks,
        COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0) as total_engagement,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN 
          ROUND((COALESCE(SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)), 0)::DECIMAL / COALESCE(SUM(impressions), 1)::DECIMAL) * 100, 2) 
        ELSE 0 END as engagement_rate,
        COALESCE(AVG(impressions), 0) as avg_impressions_per_tweet,
        COALESCE(AVG(likes), 0) as avg_likes_per_tweet
       FROM tweets 
       WHERE user_id = $1 
       AND (created_at >= $2 OR external_created_at >= $2) 
       AND status = 'posted'
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY DATE(COALESCE(external_created_at, created_at))
       ORDER BY date DESC
       LIMIT 30`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
    );

    // Get all tweets for analytics (not just top performing)
    const { rows: tweets } = await pool.query(
      `SELECT 
        id, content, 
        COALESCE(impressions, 0) as impressions, 
        COALESCE(likes, 0) as likes, 
        COALESCE(retweets, 0) as retweets, 
        COALESCE(replies, 0) as replies, 
        COALESCE(quote_count, 0) as quote_count, 
        COALESCE(bookmark_count, 0) as bookmark_count,
        source, COALESCE(external_created_at, created_at) as created_at,
        (COALESCE(impressions, 0) + COALESCE(likes, 0) * 2 + COALESCE(retweets, 0) * 3 + COALESCE(replies, 0) * 2 + COALESCE(quote_count, 0) * 2 + COALESCE(bookmark_count, 0)) as engagement_score,
        CASE WHEN COALESCE(impressions, 0) > 0 THEN 
          ROUND(((COALESCE(likes, 0) + COALESCE(retweets, 0) + COALESCE(replies, 0) + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0))::DECIMAL / impressions::DECIMAL) * 100, 2) 
        ELSE 0 END as tweet_engagement_rate
       FROM tweets 
       WHERE user_id = $1 
       AND (created_at >= $2 OR external_created_at >= $2) 
       AND status = 'posted'
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       ORDER BY created_at DESC`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
    );

    // Get hourly engagement patterns
    const { rows: hourlyEngagement } = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as tweets_count,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(AVG(likes + retweets + replies), 0) as avg_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY avg_engagement DESC`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
    );

    // Get content type performance
    const { rows: contentTypeMetrics } = await pool.query(
      `SELECT 
        CASE WHEN content IS NOT NULL AND array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread' ELSE 'single' END as content_type,
        COUNT(*) as tweets_count,
        COALESCE(AVG(impressions), 0) as avg_impressions,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(retweets), 0) as avg_retweets,
        COALESCE(AVG(replies), 0) as avg_replies,
        COALESCE(AVG(likes + retweets + replies), 0) as avg_total_engagement
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted' AND content IS NOT NULL
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY CASE WHEN content IS NOT NULL AND array_length(string_to_array(content, '---'), 1) > 1 THEN 'thread' ELSE 'single' END`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
    );

    // Get growth metrics (compare with previous period)
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - parseInt(days));

    const { rows: previousMetrics } = await pool.query(
      `SELECT 
        COUNT(*) as prev_total_tweets,
        COALESCE(SUM(impressions), 0) as prev_total_impressions,
        COALESCE(SUM(likes), 0) as prev_total_likes,
        COALESCE(SUM(retweets), 0) as prev_total_retweets,
        COALESCE(SUM(replies), 0) as prev_total_replies
       FROM tweets 
       WHERE user_id = $1 AND created_at >= $2 AND created_at < $3 AND status = 'posted'
       ${accountId ? 'AND account_id::TEXT = $4' : ''}`,
      accountId ? [userId, previousStartDate, startDate, accountId] : [userId, previousStartDate, startDate]
    );

    console.log('✅ Analytics overview data fetched successfully');

    res.json({
      overview: tweetMetrics[0] || {},
      daily_metrics: dailyMetrics || [],
      tweets: tweets || [],
      hourly_engagement: hourlyEngagement || [],
      content_type_metrics: contentTypeMetrics || [],
      growth: {
        current: tweetMetrics[0] || {},
        previous: previousMetrics[0] || {}
      }
    });

  } catch (error) {
    console.error('❌ Analytics overview error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch analytics overview',
      message: error.message 
    });
  }
});

// Sync analytics from Twitter (SEPARATE ROUTE)
// Enhanced Sync Analytics Route with Proper Rate Limiting
router.post('/sync', validateTwitterConnection, async (req, res) => {
  let updatedCount = 0;
  let errorCount = 0;
  let rateLimitExceeded = false;
  const updatedTweetIds = [];
  const skippedTweetIds = [];

  try {
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

    console.log('� Starting ENHANCED Twitter sync with rate limiting...');

    // Initialize Twitter client
    let twitterClient;
    if (twitterAccount.access_token) {
      try {
        twitterClient = new TwitterApi(twitterAccount.access_token);
      } catch (oauth2Error) {
        console.error('OAuth 2.0 initialization failed:', oauth2Error);
        return res.status(401).json({
          error: 'Twitter authentication failed',
          message: 'Please reconnect your Twitter account.',
          type: 'twitter_auth_error'
        });
      }
    } else {
      throw new Error('No OAuth 2.0 access token found');
    }

    // Test connection with rate limit awareness
    try {
      await twitterClient.v2.me();
      console.log('✅ Connection test successful');
    } catch (testError) {
      if (testError.code === 429) {
        // ENHANCED: Use real reset time here too
        let resetTimestamp = Date.now() + 15 * 60 * 1000;
        if (testError.rateLimit?.reset) {
          resetTimestamp = testError.rateLimit.reset * 1000;
        } else if (testError.headers?.['x-rate-limit-reset']) {
          resetTimestamp = parseInt(testError.headers['x-rate-limit-reset'], 10) * 1000;
        } else if (testError.response?.headers?.['x-rate-limit-reset']) {
          resetTimestamp = parseInt(testError.response.headers['x-rate-limit-reset'], 10) * 1000;
        }
        const resetTime = new Date(resetTimestamp);
        const waitMinutes = Math.ceil((resetTimestamp - Date.now()) / 60000);
        return res.status(429).json({
          error: 'Twitter API rate limit exceeded during connection test',
          message: `Please wait until ${resetTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST before trying again.`,
          resetTime: resetTime.toISOString(),
          waitMinutes: waitMinutes,
          type: 'rate_limit'
        });
      }
      throw testError;
    }

    // Get tweets to sync with conservative limits to avoid rate limits
    const { rows: tweetsToUpdate } = await pool.query(
      `SELECT id, tweet_id, content, created_at FROM tweets 
       WHERE user_id = $1 AND status = 'posted' AND source = 'platform'
       AND created_at >= NOW() - INTERVAL '7 days'
       AND tweet_id IS NOT NULL
       AND (impressions IS NULL OR impressions = 0 OR updated_at < NOW() - INTERVAL '6 hours')
       ORDER BY created_at DESC LIMIT 15`,  // Reduced from 20 to 15 tweets per sync
      [userId]
    );

    console.log(`Found ${tweetsToUpdate.length} tweets to sync`);

    if (tweetsToUpdate.length === 0) {
      return res.json({
        success: true,
        message: 'No tweets need syncing at this time',
        stats: { metrics_updated: 0, errors: 0, total_processed: 0 }
      });
    }

    // Conservative batching to avoid rate limits
    const batchSize = 3; // Reduced from 5 to 3
    const requestDelay = 2000; // 2 seconds between requests (increased from 1s)
    const batchDelay = 5000;  // 5 seconds between batches (increased from 3s)

    for (let i = 0; i < tweetsToUpdate.length; i += batchSize) {
      const batch = tweetsToUpdate.slice(i, i + batchSize);
      console.log(`Processing tweet ${i + 1}/${tweetsToUpdate.length}`);
      for (const tweet of batch) {
        if (!tweet.tweet_id || rateLimitExceeded) {
          skippedTweetIds.push(tweet.id);
          continue;
        }
        try {
          // Add random jitter to avoid predictable patterns (1-2 seconds)
          const jitter = 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, requestDelay + jitter));
          console.log(`⏳ [${i + 1}/${tweetsToUpdate.length}] Fetching metrics for tweet ${tweet.tweet_id}...`);
          const tweetData = await twitterClient.v2.singleTweet(tweet.tweet_id, {
            'tweet.fields': ['public_metrics', 'created_at']
          });
          if (tweetData.data && tweetData.data.public_metrics) {
            const publicMetrics = tweetData.data.public_metrics;
            await pool.query(
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
            updatedCount++;
            updatedTweetIds.push(tweet.id);
            console.log(`✅ Updated tweet ${tweet.tweet_id}: ${publicMetrics.impression_count} impressions`);
          } else {
            console.log(`⚠️ No metrics data for tweet ${tweet.tweet_id}`);
            skippedTweetIds.push(tweet.id);
          }
        } catch (tweetError) {
          console.error(`❌ Error for tweet ${tweet.tweet_id}:`, {
            message: tweetError.message,
            code: tweetError.code,
            status: tweetError.status
          });
          errorCount++;
          if (tweetError.code === 429) {
            console.log('🛑 Rate limit hit, stopping sync completely');
            // Debug logging to see what headers we get
            console.log('Available reset sources:', {
              rateLimit: !!tweetError.rateLimit?.reset,
              headers: !!tweetError.headers?.['x-rate-limit-reset'],
              responseHeaders: !!tweetError.response?.headers?.['x-rate-limit-reset']
            });
            rateLimitExceeded = true;
            // Mark all remaining tweets as skipped
            for (let j = i + 1; j < tweetsToUpdate.length; j++) {
              skippedTweetIds.push(tweetsToUpdate[j].id);
            }
            // Try to get x-rate-limit-reset from error headers
            let resetTimestamp = Date.now() + 15 * 60 * 1000;
            if (tweetError.rateLimit?.reset) {
              resetTimestamp = tweetError.rateLimit.reset * 1000;
            } else if (tweetError.headers?.['x-rate-limit-reset']) {
              resetTimestamp = parseInt(tweetError.headers['x-rate-limit-reset'], 10) * 1000;
            } else if (tweetError.response?.headers?.['x-rate-limit-reset']) {
              resetTimestamp = parseInt(tweetError.response.headers['x-rate-limit-reset'], 10) * 1000;
            }
            const resetTime = new Date(resetTimestamp);
            const waitMinutes = Math.ceil((resetTimestamp - Date.now()) / 60000);
            return res.status(429).json({
              error: 'Twitter API rate limit exceeded',
              message: `Sync stopped due to rate limits. ${updatedCount} tweets were updated successfully. Please wait ${waitMinutes} minutes before trying again.`,
              type: 'rate_limit',
              resetTime: resetTime.toISOString(),
              waitMinutes: waitMinutes,
              updatedTweetIds,
              skippedTweetIds,
              stats: {
                metrics_updated: updatedCount,
                errors: errorCount,
                total_processed: i + 1
              }
            });
          } else if (tweetError.code === 144 || tweetError.status === 404) {
            console.log(`Tweet ${tweet.tweet_id} not found, marking as deleted`);
            await pool.query(
              `UPDATE tweets SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [tweet.id]
            );
            skippedTweetIds.push(tweet.id);
          } else {
            skippedTweetIds.push(tweet.id);
          }
        }
      }
      // Long delay between batches to respect rate limits
      if (i + batchSize < tweetsToUpdate.length && !rateLimitExceeded) {
        const nextBatch = Math.min(i + batchSize, tweetsToUpdate.length);
        console.log(`⏸️ Batch complete (${i + batch.length}/${tweetsToUpdate.length}). Waiting ${batchDelay/1000}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    console.log(`✅ Sync complete: ${updatedCount} updated, ${errorCount} errors`);

    res.json({
      success: true,
      message: `Analytics sync completed! Updated ${updatedCount} tweets${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
      updatedTweetIds,
      skippedTweetIds,
      stats: {
        metrics_updated: updatedCount,
        errors: errorCount,
        total_processed: tweetsToUpdate.length
      }
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    
    if (error.code === 429) {
      // Try to get x-rate-limit-reset from error headers
      let resetTimestamp = Date.now() + 15 * 60 * 1000;
      if (error.rateLimit?.reset) {
        resetTimestamp = error.rateLimit.reset * 1000;
      } else if (error.headers?.['x-rate-limit-reset']) {
        resetTimestamp = parseInt(error.headers['x-rate-limit-reset'], 10) * 1000;
      } else if (error.response?.headers?.['x-rate-limit-reset']) {
        resetTimestamp = parseInt(error.response.headers['x-rate-limit-reset'], 10) * 1000;
      }
      const resetTime = new Date(resetTimestamp);
      const waitMinutes = Math.ceil((resetTimestamp - Date.now()) / 60000);
      return res.status(429).json({ 
        error: 'Twitter API rate limit exceeded',
        message: `Please wait ${waitMinutes} minutes before trying again. We updated ${updatedCount} tweets so far.`,
        resetTime: resetTime.toISOString(),
        waitMinutes: waitMinutes,
        type: 'rate_limit',
        stats: { metrics_updated: updatedCount, errors: errorCount }
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to sync analytics data',
      message: error.message || 'Unknown error occurred',
      type: 'server_error',
      stats: { metrics_updated: updatedCount, errors: errorCount }
    });
  }
});

// Debug route to check what Twitter tokens are available for the user
router.get('/debug-tokens', validateTwitterConnection, async (req, res) => {
  const twitterAccount = req.twitterAccount;
  res.json({
    tokenTypes: {
      oauth2_access: !!twitterAccount.access_token,
      oauth1_access: !!twitterAccount.oauth1_access_token,
      oauth1_secret: !!twitterAccount.oauth1_access_token_secret,
    },
    tokenLengths: {
      oauth2: twitterAccount.access_token?.length,
      oauth1: twitterAccount.oauth1_access_token?.length,
    }
  });
});

// Get detailed engagement insights
router.get('/engagement', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;
    const accountId = req.headers['x-selected-account-id'];

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
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY hashtag_usage, content_type, content_length
       ORDER BY avg_total_engagement DESC`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
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
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
       HAVING COUNT(*) >= 2
       ORDER BY avg_engagement DESC
       LIMIT 20`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
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
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
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
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY CASE WHEN array_length(string_to_array(content, '---'), 1) > 1 THEN 'threads' ELSE 'single_tweets' END`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
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
router.get('/audience', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;
    const accountId = req.headers['x-selected-account-id'];

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
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
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
       ${accountId ? 'AND account_id::TEXT = $3' : ''}
       GROUP BY reach_category
       ORDER BY avg_impressions DESC`,
      accountId ? [userId, startDate, accountId] : [userId, startDate]
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
