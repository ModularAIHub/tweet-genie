// Analytics Service for Strategy Builder (Phase 3)
import pool from '../config/database.js';

/**
 * Fetch tweet analytics from Twitter API and store in database
 * @param {string} userId - User ID
 * @param {string} tweetId - Tweet ID to fetch analytics for
 * @param {string} accessToken - Twitter OAuth access token
 */
export async function fetchTweetAnalytics(userId, tweetId, accessToken) {
  try {
    // TODO: Integrate with Twitter API v2 to fetch tweet metrics
    // For now, this is a placeholder structure
    
    const analyticsData = {
      impressions: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      quote_count: 0,
      bookmark_count: 0,
      url_clicks: 0,
      profile_clicks: 0
    };
    
    // Calculate engagement rate
    const totalEngagement = analyticsData.likes + analyticsData.retweets + 
                           analyticsData.replies + analyticsData.quote_count;
    const engagementRate = analyticsData.impressions > 0 
      ? (totalEngagement / analyticsData.impressions * 100).toFixed(2)
      : 0;
    
    // Update tweet with analytics
    await pool.query(
      `UPDATE tweets 
       SET impressions = $1, likes = $2, retweets = $3, replies = $4,
           quote_count = $5, bookmark_count = $6, url_clicks = $7, profile_clicks = $8,
           engagement_rate = $9, analytics_fetched_at = NOW()
       WHERE id = $10 AND user_id = $11`,
      [
        analyticsData.impressions,
        analyticsData.likes,
        analyticsData.retweets,
        analyticsData.replies,
        analyticsData.quote_count,
        analyticsData.bookmark_count,
        analyticsData.url_clicks,
        analyticsData.profile_clicks,
        engagementRate,
        tweetId,
        userId
      ]
    );
    
    return { success: true, analyticsData };
  } catch (error) {
    console.error('Error fetching tweet analytics:', error);
    throw error;
  }
}

/**
 * Calculate optimal posting times based on historical performance
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Object>} Optimal posting schedule
 */
export async function calculateOptimalPostingTimes(strategyId) {
  try {
    const result = await pool.query(
      `SELECT 
         EXTRACT(DOW FROM created_at) as day_of_week,
         EXTRACT(HOUR FROM created_at) as hour,
         AVG(engagement_rate) as avg_engagement,
         COUNT(*) as post_count
       FROM tweets
       WHERE strategy_id = $1 
         AND engagement_rate > 0
         AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY day_of_week, hour
       HAVING COUNT(*) >= 3
       ORDER BY avg_engagement DESC
       LIMIT 10`,
      [strategyId]
    );
    
    // Upsert optimal posting schedule
    for (const row of result.rows) {
      const confidenceScore = Math.min(100, (row.post_count / 10) * 100);
      const isRecommended = row.avg_engagement > 2.0 && row.post_count >= 5;
      
      await pool.query(
        `INSERT INTO optimal_posting_schedule 
           (strategy_id, day_of_week, hour, avg_engagement_rate, post_count, 
            confidence_score, is_recommended)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (strategy_id, day_of_week, hour) 
         DO UPDATE SET 
           avg_engagement_rate = $4,
           post_count = $5,
           confidence_score = $6,
           is_recommended = $7,
           updated_at = NOW()`,
        [
          strategyId,
          row.day_of_week,
          row.hour,
          row.avg_engagement,
          row.post_count,
          confidenceScore,
          isRecommended
        ]
      );
    }
    
    return result.rows;
  } catch (error) {
    console.error('Error calculating optimal posting times:', error);
    throw error;
  }
}

/**
 * Get recommended posting times for a strategy
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Array>} Recommended posting times
 */
export async function getRecommendedPostingTimes(strategyId) {
  try {
    const result = await pool.query(
      `SELECT day_of_week, hour, avg_engagement_rate, confidence_score
       FROM optimal_posting_schedule
       WHERE strategy_id = $1 AND is_recommended = true
       ORDER BY avg_engagement_rate DESC, confidence_score DESC`,
      [strategyId]
    );
    
    return result.rows;
  } catch (error) {
    console.error('Error getting recommended posting times:', error);
    throw error;
  }
}

/**
 * Generate strategy analytics for a given period
 * @param {string} strategyId - Strategy ID
 * @param {Date} startDate - Period start date
 * @param {Date} endDate - Period end date
 * @returns {Promise<Object>} Analytics data
 */
export async function generateStrategyAnalytics(strategyId, startDate, endDate) {
  try {
    // Get overall metrics
    const metricsResult = await pool.query(
      `SELECT 
         COUNT(*) as total_posts,
         SUM(impressions) as total_impressions,
         SUM(likes + retweets + replies + COALESCE(quote_count, 0) + COALESCE(bookmark_count, 0)) as total_engagements,
         AVG(engagement_rate) as avg_engagement_rate
       FROM tweets
       WHERE strategy_id = $1
         AND created_at BETWEEN $2 AND $3
         AND engagement_rate > 0`,
      [strategyId, startDate, endDate]
    );
    
    const metrics = metricsResult.rows[0];
    
    // Get best performing hours
    const hoursResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at) as hour
       FROM tweets
       WHERE strategy_id = $1
         AND created_at BETWEEN $2 AND $3
         AND engagement_rate > 0
       GROUP BY hour
       ORDER BY AVG(engagement_rate) DESC
       LIMIT 5`,
      [strategyId, startDate, endDate]
    );
    
    const bestHours = hoursResult.rows.map(r => parseInt(r.hour));
    
    // Get best performing days
    const daysResult = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at) as day
       FROM tweets
       WHERE strategy_id = $1
         AND created_at BETWEEN $2 AND $3
         AND engagement_rate > 0
       GROUP BY day
       ORDER BY AVG(engagement_rate) DESC
       LIMIT 3`,
      [strategyId, startDate, endDate]
    );
    
    const bestDays = daysResult.rows.map(r => parseInt(r.day));
    
    // Get metrics by category
    const categoryResult = await pool.query(
      `SELECT 
         sp.category,
         COUNT(t.id) as post_count,
         AVG(t.engagement_rate) as avg_engagement,
         SUM(t.impressions) as total_impressions
       FROM tweets t
       JOIN strategy_prompts sp ON t.prompt_id = sp.id
       WHERE t.strategy_id = $1
         AND t.created_at BETWEEN $2 AND $3
       GROUP BY sp.category
       ORDER BY avg_engagement DESC`,
      [strategyId, startDate, endDate]
    );
    
    const metricsByCategory = {};
    categoryResult.rows.forEach(row => {
      metricsByCategory[row.category] = {
        postCount: parseInt(row.post_count),
        avgEngagement: parseFloat(row.avg_engagement),
        totalImpressions: parseInt(row.total_impressions)
      };
    });
    
    // Upsert analytics
    await pool.query(
      `INSERT INTO strategy_analytics 
         (strategy_id, period_start, period_end, total_posts, total_impressions,
          total_engagements, avg_engagement_rate, best_posting_hours, 
          best_posting_days, metrics_by_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (strategy_id, period_start, period_end)
       DO UPDATE SET
         total_posts = $4,
         total_impressions = $5,
         total_engagements = $6,
         avg_engagement_rate = $7,
         best_posting_hours = $8,
         best_posting_days = $9,
         metrics_by_category = $10,
         updated_at = NOW()`,
      [
        strategyId,
        startDate,
        endDate,
        metrics.total_posts || 0,
        metrics.total_impressions || 0,
        metrics.total_engagements || 0,
        metrics.avg_engagement_rate || 0,
        bestHours,
        bestDays,
        JSON.stringify(metricsByCategory)
      ]
    );
    
    return {
      metrics,
      bestHours,
      bestDays,
      metricsByCategory
    };
  } catch (error) {
    console.error('Error generating strategy analytics:', error);
    throw error;
  }
}

/**
 * Get content performance insights
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Array>} Content insights
 */
export async function getContentInsights(strategyId) {
  try {
    const result = await pool.query(
      `SELECT 
         sp.category as content_type,
         AVG(t.engagement_rate) as avg_engagement,
         COUNT(t.id) as total_posts,
         array_agg(DISTINCT sp.category) as themes,
         CASE 
           WHEN AVG(t.engagement_rate) > 
             (SELECT AVG(engagement_rate) FROM tweets WHERE strategy_id = $1)
           THEN 100.0
           ELSE (AVG(t.engagement_rate) / NULLIF(
             (SELECT AVG(engagement_rate) FROM tweets WHERE strategy_id = $1), 0
           ) * 100)
         END as success_rate
       FROM tweets t
       JOIN strategy_prompts sp ON t.prompt_id = sp.id
       WHERE t.strategy_id = $1
         AND t.engagement_rate > 0
       GROUP BY sp.category
       HAVING COUNT(t.id) >= 3
       ORDER BY avg_engagement DESC`,
      [strategyId]
    );
    
    const insights = [];
    
    for (const row of result.rows) {
      const confidenceScore = Math.min(100, (row.total_posts / 10) * 100);
      let recommendation = '';
      
      if (row.success_rate > 120) {
        recommendation = `${row.content_type} performs exceptionally well! Post more of this content.`;
      } else if (row.success_rate > 100) {
        recommendation = `${row.content_type} performs above average. Continue with current frequency.`;
      } else if (row.success_rate > 80) {
        recommendation = `${row.content_type} performs adequately. Consider testing new approaches.`;
      } else {
        recommendation = `${row.content_type} underperforms. Try different angles or reduce frequency.`;
      }
      
      insights.push({
        content_type: row.content_type,
        avg_engagement: parseFloat(row.avg_engagement),
        total_posts: parseInt(row.total_posts),
        success_rate: parseFloat(row.success_rate),
        confidence_score: confidenceScore,
        recommendation
      });
      
      // Store insights
      await pool.query(
        `INSERT INTO content_insights 
           (strategy_id, content_type, themes, avg_engagement_rate, total_posts,
            success_rate, recommendation, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          strategyId,
          row.content_type,
          row.themes,
          row.avg_engagement,
          row.total_posts,
          row.success_rate,
          recommendation,
          confidenceScore
        ]
      );
    }
    
    return insights;
  } catch (error) {
    console.error('Error getting content insights:', error);
    throw error;
  }
}

/**
 * Get analytics dashboard data for a strategy
 * @param {string} strategyId - Strategy ID
 * @param {number} days - Number of days to analyze (default: 30)
 * @returns {Promise<Object>} Dashboard data
 */
export async function getAnalyticsDashboard(strategyId, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date();
    
    const [analytics, optimalTimes, insights] = await Promise.all([
      generateStrategyAnalytics(strategyId, startDate, endDate),
      calculateOptimalPostingTimes(strategyId),
      getContentInsights(strategyId)
    ]);
    
    return {
      period: { start: startDate, end: endDate, days },
      performance: analytics.metrics,
      optimalTimes: {
        hours: analytics.bestHours,
        days: analytics.bestDays,
        detailed: optimalTimes
      },
      categoryPerformance: analytics.metricsByCategory,
      insights
    };
  } catch (error) {
    console.error('Error getting analytics dashboard:', error);
    throw error;
  }
}

export default {
  fetchTweetAnalytics,
  calculateOptimalPostingTimes,
  getRecommendedPostingTimes,
  generateStrategyAnalytics,
  getContentInsights,
  getAnalyticsDashboard
};
