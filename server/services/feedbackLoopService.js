// Phase 5 — Feedback Loop Service
// Handles: tweet performance scoring, weekly summaries, strategy auto-updates,
// deferred analytics sync scheduling, and informed generation data.
import pool from '../config/database.js';

// ─── Constants ──────────────────────────────────────────────────────────────
const MIN_TWEETS_FOR_SCORING = 3;
const WEEKS_FOR_AUTO_UPDATE = 3;
const DEFERRED_SYNC_DELAY_HOURS = 24;

class FeedbackLoopService {

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.1 — Performance scoring
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Score a single tweet against the user's own engagement average.
   * Called after analytics sync fetches new metrics.
   */
  async scoreTweet(tweetId) {
    const { rows: [tweet] } = await pool.query(
      `SELECT t.*, us.niche, us.topics
       FROM tweets t
       LEFT JOIN user_strategies us ON t.strategy_id = us.id
       WHERE t.id = $1`,
      [tweetId]
    );
    if (!tweet || !tweet.user_id) return null;

    const engagement = this.calculateEngagement(tweet);
    const avg = await this.getUserAverageEngagement(tweet.user_id);

    if (avg === null || avg === 0) return null;

    const ratio = engagement / avg;
    let score;
    if (ratio >= 1.3) score = 'above_average';
    else if (ratio >= 0.7) score = 'average';
    else score = 'below_average';

    // Tag topics from strategy if available
    const topicTags = this.extractTopicTags(tweet);

    await pool.query(
      `UPDATE tweets
       SET performance_score = $1, performance_ratio = $2, topic_tags = $3, scored_at = NOW()
       WHERE id = $4`,
      [score, ratio, topicTags, tweetId]
    );

    return { tweetId, score, ratio, topicTags };
  }

  /**
   * Batch-score all unscored tweets for a user that have analytics data.
   */
  async scoreUnscoredTweets(userId) {
    const { rows: unscored } = await pool.query(
      `SELECT id FROM tweets
       WHERE user_id = $1
         AND analytics_fetched_at IS NOT NULL
         AND scored_at IS NULL
         AND (impressions > 0 OR likes > 0 OR retweets > 0)
       ORDER BY posted_at DESC
       LIMIT 50`,
      [userId]
    );

    const results = [];
    for (const t of unscored) {
      try {
        const result = await this.scoreTweet(t.id);
        if (result) results.push(result);
      } catch (err) {
        console.error(`[FeedbackLoop] Failed to score tweet ${t.id}:`, err.message);
      }
    }

    if (results.length > 0) {
      console.log(`[FeedbackLoop] Scored ${results.length} tweets for user=${userId}`);
    }
    return results;
  }

  /**
   * Get the user's average engagement across their tweets.
   */
  async getUserAverageEngagement(userId) {
    const { rows: [row] } = await pool.query(
      `SELECT 
         AVG(likes + retweets + replies + COALESCE(quote_count,0) + COALESCE(bookmark_count,0)) as avg_engagement,
         COUNT(*) as tweet_count
       FROM tweets
       WHERE user_id = $1
         AND analytics_fetched_at IS NOT NULL
         AND (impressions > 0 OR likes > 0 OR retweets > 0)
         AND posted_at > NOW() - INTERVAL '90 days'`,
      [userId]
    );

    if (!row || parseInt(row.tweet_count) < MIN_TWEETS_FOR_SCORING) return null;
    return parseFloat(row.avg_engagement) || 0;
  }

  calculateEngagement(tweet) {
    return (tweet.likes || 0)
      + (tweet.retweets || 0)
      + (tweet.replies || 0)
      + (tweet.quote_count || 0)
      + (tweet.bookmark_count || 0);
  }

  extractTopicTags(tweet) {
    // Try to extract from strategy topics or content review category
    const tags = [];
    if (tweet.topics && Array.isArray(tweet.topics)) {
      tags.push(...tweet.topics.slice(0, 5));
    }
    // Simple keyword extraction from content
    const content = (tweet.content || '').toLowerCase();
    if (content.includes('thread') || tweet.is_thread) tags.push('thread');
    return [...new Set(tags)];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.2 — Weekly performance summaries
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a weekly performance summary for a strategy.
   * Typically run Sunday night or Monday morning before new content generation.
   */
  async generateWeeklySummary(userId, strategyId) {
    const weekEnd = new Date();
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 7);

    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    // Check if summary already exists for this week
    const { rows: existing } = await pool.query(
      `SELECT id FROM weekly_performance_summaries
       WHERE user_id = $1 AND strategy_id = $2 AND week_start = $3`,
      [userId, strategyId, weekStartStr]
    );
    if (existing.length > 0) {
      console.log(`[FeedbackLoop] Weekly summary already exists for week=${weekStartStr}`);
      return existing[0];
    }

    // Get all scored tweets from this week for this strategy
    const { rows: tweets } = await pool.query(
      `SELECT * FROM tweets
       WHERE user_id = $1
         AND strategy_id = $2
         AND posted_at BETWEEN $3 AND $4
         AND analytics_fetched_at IS NOT NULL`,
      [userId, strategyId, weekStart.toISOString(), weekEnd.toISOString()]
    );

    if (tweets.length === 0) {
      console.log(`[FeedbackLoop] No tweets to summarise for week=${weekStartStr}`);
      return null;
    }

    // Aggregate metrics
    const totalImpressions = tweets.reduce((s, t) => s + (t.impressions || 0), 0);
    const totalEngagement = tweets.reduce((s, t) => s + this.calculateEngagement(t), 0);
    const avgEngagementRate = tweets.length > 0
      ? tweets.reduce((s, t) => s + (parseFloat(t.engagement_rate) || 0), 0) / tweets.length
      : 0;

    // Category breakdown
    const categoryPerf = {};
    for (const t of tweets) {
      const cat = (t.topic_tags?.[0]) || 'general';
      if (!categoryPerf[cat]) categoryPerf[cat] = { count: 0, total_engagement: 0 };
      categoryPerf[cat].count++;
      categoryPerf[cat].total_engagement += this.calculateEngagement(t);
    }
    for (const cat of Object.keys(categoryPerf)) {
      categoryPerf[cat].avg_engagement = categoryPerf[cat].total_engagement / categoryPerf[cat].count;
    }

    // Format breakdown (threads vs singles)
    const threads = tweets.filter(t => t.is_thread);
    const singles = tweets.filter(t => !t.is_thread);
    const threadsAvg = threads.length > 0
      ? threads.reduce((s, t) => s + this.calculateEngagement(t), 0) / threads.length
      : 0;
    const singlesAvg = singles.length > 0
      ? singles.reduce((s, t) => s + this.calculateEngagement(t), 0) / singles.length
      : 0;

    // Hour breakdown
    const hourPerf = {};
    for (const t of tweets) {
      const hour = t.posted_at ? new Date(t.posted_at).getHours() : null;
      if (hour === null) continue;
      if (!hourPerf[hour]) hourPerf[hour] = { count: 0, total_engagement: 0 };
      hourPerf[hour].count++;
      hourPerf[hour].total_engagement += this.calculateEngagement(t);
    }
    for (const h of Object.keys(hourPerf)) {
      hourPerf[h].avg_engagement = hourPerf[h].total_engagement / hourPerf[h].count;
    }

    // Topic performance from topic_tags
    const topicPerf = {};
    for (const t of tweets) {
      for (const tag of (t.topic_tags || [])) {
        if (!topicPerf[tag]) topicPerf[tag] = { count: 0, total_engagement: 0 };
        topicPerf[tag].count++;
        topicPerf[tag].total_engagement += this.calculateEngagement(t);
      }
    }
    for (const topic of Object.keys(topicPerf)) {
      topicPerf[topic].avg_engagement = topicPerf[topic].total_engagement / topicPerf[topic].count;
    }

    // Best and worst tweets
    const sorted = [...tweets].sort((a, b) => this.calculateEngagement(b) - this.calculateEngagement(a));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    const { rows: [summary] } = await pool.query(
      `INSERT INTO weekly_performance_summaries 
         (user_id, strategy_id, week_start, week_end,
          total_tweets, total_impressions, total_engagement, avg_engagement_rate,
          category_performance, threads_count, threads_avg_engagement,
          singles_count, singles_avg_engagement, hour_performance, topic_performance,
          best_tweet_id, best_tweet_engagement, worst_tweet_id, worst_tweet_engagement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        userId, strategyId, weekStartStr, weekEndStr,
        tweets.length, totalImpressions, totalEngagement, avgEngagementRate,
        JSON.stringify(categoryPerf), threads.length, threadsAvg,
        singles.length, singlesAvg, JSON.stringify(hourPerf), JSON.stringify(topicPerf),
        best?.tweet_id || null, best ? this.calculateEngagement(best) : 0,
        worst?.tweet_id || null, worst ? this.calculateEngagement(worst) : 0,
      ]
    );

    console.log(`[FeedbackLoop] Generated weekly summary for strategy=${strategyId}, week=${weekStartStr}: ${tweets.length} tweets`);
    return summary;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.3 — Strategy auto-update
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Analyse recent weekly summaries and auto-adjust the strategy.
   * Called weekly before new content generation.
   */
  async autoUpdateStrategy(strategyId) {
    const updates = [];

    // Get last N weeks of summaries
    const { rows: summaries } = await pool.query(
      `SELECT * FROM weekly_performance_summaries
       WHERE strategy_id = $1
       ORDER BY week_start DESC
       LIMIT $2`,
      [strategyId, WEEKS_FOR_AUTO_UPDATE + 1]
    );

    if (summaries.length < WEEKS_FOR_AUTO_UPDATE) {
      console.log(`[FeedbackLoop] Not enough data for auto-update (${summaries.length}/${WEEKS_FOR_AUTO_UPDATE} weeks)`);
      return updates;
    }

    // Get current strategy
    const { rows: [strategy] } = await pool.query(
      'SELECT * FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    if (!strategy) return updates;

    const metadata = strategy.metadata || {};
    const cache = metadata.analysis_cache || {};

    // ─── Check 1: Threads vs Singles format preference ────────────────
    const recentSummaries = summaries.slice(0, WEEKS_FOR_AUTO_UPDATE);
    const threadsOutperform = recentSummaries.every(
      s => s.threads_count > 0 && s.threads_avg_engagement > s.singles_avg_engagement * 1.2
    );
    const singlesOutperform = recentSummaries.every(
      s => s.singles_count > 0 && s.singles_avg_engagement > s.threads_avg_engagement * 1.2
    );

    if (threadsOutperform && cache.best_format !== 'threads') {
      const prev = cache.best_format || 'mixed';
      await this.applyStrategyUpdate(strategyId, 'format', prev, 'threads',
        `Threads outperformed singles for ${WEEKS_FOR_AUTO_UPDATE}+ weeks`, summaries.length);
      updates.push({ type: 'format', from: prev, to: 'threads' });
    } else if (singlesOutperform && cache.best_format !== 'singles') {
      const prev = cache.best_format || 'mixed';
      await this.applyStrategyUpdate(strategyId, 'format', prev, 'singles',
        `Singles outperformed threads for ${WEEKS_FOR_AUTO_UPDATE}+ weeks`, summaries.length);
      updates.push({ type: 'format', from: prev, to: 'singles' });
    }

    // ─── Check 2: Underperforming topics ─────────────────────────────
    const topicScores = {};
    for (const s of recentSummaries) {
      const tp = s.topic_performance || {};
      for (const [topic, data] of Object.entries(tp)) {
        if (!topicScores[topic]) topicScores[topic] = [];
        topicScores[topic].push(data.avg_engagement || 0);
      }
    }

    const userAvg = await this.getUserAverageEngagement(strategy.user_id);
    if (userAvg && userAvg > 0) {
      const deprioritisedTopics = [];
      for (const [topic, scores] of Object.entries(topicScores)) {
        if (scores.length >= WEEKS_FOR_AUTO_UPDATE) {
          const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (avgScore < userAvg * 0.5) {
            deprioritisedTopics.push(topic);
          }
        }
      }

      if (deprioritisedTopics.length > 0) {
        const currentTopics = Array.isArray(strategy.topics) ? strategy.topics : (cache.top_topics || []);
        const filteredTopics = currentTopics.filter(t =>
          !deprioritisedTopics.some(d => t.toLowerCase().includes(d.toLowerCase()))
        );

        if (filteredTopics.length < currentTopics.length) {
          await this.applyStrategyUpdate(strategyId, 'topic_priority',
            currentTopics, filteredTopics,
            `Deprioritised underperforming topics: ${deprioritisedTopics.join(', ')}`, summaries.length);
          updates.push({ type: 'topic_priority', deprioritised: deprioritisedTopics });
        }
      }
    }

    // ─── Check 3: Optimal posting times ──────────────────────────────
    const hourScores = {};
    for (const s of recentSummaries) {
      const hp = s.hour_performance || {};
      for (const [hour, data] of Object.entries(hp)) {
        if (!hourScores[hour]) hourScores[hour] = [];
        hourScores[hour].push(data.avg_engagement || 0);
      }
    }

    let bestHour = null;
    let bestHourAvg = 0;
    for (const [hour, scores] of Object.entries(hourScores)) {
      if (scores.length >= 2) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg > bestHourAvg) {
          bestHourAvg = avg;
          bestHour = parseInt(hour);
        }
      }
    }

    if (bestHour !== null) {
      const currentBestHours = cache.best_hours || '';
      const newBestHours = `${bestHour > 12 ? bestHour - 12 : bestHour}${bestHour >= 12 ? 'pm' : 'am'}-${(bestHour + 2) > 12 ? (bestHour + 2) - 12 : bestHour + 2}${(bestHour + 2) >= 12 ? 'pm' : 'am'}`;

      if (newBestHours !== currentBestHours) {
        await this.applyStrategyUpdate(strategyId, 'posting_time',
          currentBestHours, newBestHours,
          `Data shows better engagement around ${bestHour}:00`, summaries.length);
        updates.push({ type: 'posting_time', from: currentBestHours, to: newBestHours });
      }
    }

    if (updates.length > 0) {
      console.log(`[FeedbackLoop] Auto-updated strategy=${strategyId}: ${updates.map(u => u.type).join(', ')}`);
    }

    return updates;
  }

  /**
   * Apply a single strategy update and log it.
   */
  async applyStrategyUpdate(strategyId, updateType, previousValue, newValue, reason, weeksOfData) {
    // Update the strategy metadata
    const { rows: [strategy] } = await pool.query(
      'SELECT metadata FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    if (!strategy) return;

    const metadata = strategy.metadata || {};
    const cache = metadata.analysis_cache || {};

    switch (updateType) {
      case 'format':
        cache.best_format = newValue;
        break;
      case 'topic_priority':
        cache.top_topics = newValue;
        break;
      case 'posting_time':
        cache.best_hours = newValue;
        break;
    }

    metadata.analysis_cache = cache;
    metadata.last_auto_update = new Date().toISOString();

    await pool.query(
      `UPDATE user_strategies SET metadata = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(metadata), strategyId]
    );

    // Log the update
    await pool.query(
      `INSERT INTO strategy_auto_updates 
         (strategy_id, update_type, previous_value, new_value, reason, weeks_of_data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [strategyId, updateType, JSON.stringify(previousValue), JSON.stringify(newValue), reason, weeksOfData]
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.4 — Informed weekly generation data
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build a performance context block to inject into the weekly content generation prompt.
   * Returns a formatted string or null if no data.
   */
  async getPerformanceContext(userId, strategyId) {
    // Get last week's summary
    const { rows: [lastWeek] } = await pool.query(
      `SELECT * FROM weekly_performance_summaries
       WHERE user_id = $1 AND strategy_id = $2
       ORDER BY week_start DESC
       LIMIT 1`,
      [userId, strategyId]
    );

    if (!lastWeek) return null;

    // Get recent auto-updates
    const { rows: recentUpdates } = await pool.query(
      `SELECT * FROM strategy_auto_updates
       WHERE strategy_id = $1
       ORDER BY created_at DESC
       LIMIT 3`,
      [strategyId]
    );

    // Get top-performing tweets from last 2 weeks
    const { rows: topTweets } = await pool.query(
      `SELECT content, performance_score, performance_ratio, topic_tags, is_thread
       FROM tweets
       WHERE user_id = $1 AND strategy_id = $2
         AND performance_score = 'above_average'
         AND posted_at > NOW() - INTERVAL '14 days'
       ORDER BY performance_ratio DESC
       LIMIT 3`,
      [userId, strategyId]
    );

    // Get underperforming patterns
    const { rows: poorTweets } = await pool.query(
      `SELECT content, performance_score, performance_ratio, topic_tags, is_thread
       FROM tweets
       WHERE user_id = $1 AND strategy_id = $2
         AND performance_score = 'below_average'
         AND posted_at > NOW() - INTERVAL '14 days'
       ORDER BY performance_ratio ASC
       LIMIT 3`,
      [userId, strategyId]
    );

    // Build context string
    const lines = [];
    lines.push('LAST WEEK\'S PERFORMANCE DATA:');
    lines.push(`- ${lastWeek.total_tweets} tweets posted, ${lastWeek.total_impressions} total impressions`);
    lines.push(`- Average engagement rate: ${(lastWeek.avg_engagement_rate * 100).toFixed(1)}%`);

    if (lastWeek.threads_count > 0 || lastWeek.singles_count > 0) {
      lines.push(`- Threads: ${lastWeek.threads_count} (avg engagement: ${lastWeek.threads_avg_engagement?.toFixed(1) || 0})`);
      lines.push(`- Singles: ${lastWeek.singles_count} (avg engagement: ${lastWeek.singles_avg_engagement?.toFixed(1) || 0})`);
    }

    // Best categories
    const catPerf = lastWeek.category_performance || {};
    const sortedCats = Object.entries(catPerf)
      .sort(([, a], [, b]) => (b.avg_engagement || 0) - (a.avg_engagement || 0));
    if (sortedCats.length > 0) {
      lines.push(`\nBEST PERFORMING CATEGORIES:`);
      for (const [cat, data] of sortedCats.slice(0, 3)) {
        lines.push(`- ${cat}: ${data.count} tweets, avg engagement ${data.avg_engagement?.toFixed(1) || 0}`);
      }
    }

    // What worked
    if (topTweets.length > 0) {
      lines.push(`\nWHAT WORKED WELL (above average tweets):`);
      for (const t of topTweets) {
        const preview = (t.content || '').slice(0, 80);
        lines.push(`- "${preview}..." (${t.performance_ratio?.toFixed(1)}x avg${t.is_thread ? ', thread' : ''})`);
      }
    }

    // What didn't work
    if (poorTweets.length > 0) {
      lines.push(`\nWHAT DIDN'T WORK (below average tweets):`);
      for (const t of poorTweets) {
        const preview = (t.content || '').slice(0, 80);
        lines.push(`- "${preview}..." (${t.performance_ratio?.toFixed(1)}x avg)`);
      }
    }

    // Strategy adjustments
    if (recentUpdates.length > 0) {
      lines.push(`\nRECENT STRATEGY ADJUSTMENTS:`);
      for (const u of recentUpdates) {
        lines.push(`- ${u.update_type}: ${u.reason}`);
      }
    }

    lines.push(`\nIMPORTANT: Use this data to generate better content this week. Double down on what worked, avoid patterns that underperformed.`);

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Deferred analytics sync
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Schedule an analytics sync for a tweet after it's posted.
   * Called from scheduledTweetService after successful posting.
   */
  async scheduleDeferredSync(userId, tweetId, accountId) {
    const syncAfter = new Date(Date.now() + DEFERRED_SYNC_DELAY_HOURS * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO deferred_analytics_sync (user_id, tweet_id, account_id, sync_after)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [userId, tweetId, accountId, syncAfter.toISOString()]
    );

    console.log(`[FeedbackLoop] Deferred analytics sync scheduled for tweet=${tweetId} at ${syncAfter.toISOString()}`);
  }

  /**
   * Process all pending deferred syncs whose time has arrived.
   * Called periodically by the analytics sync worker.
   */
  async processDeferredSyncs() {
    const { rows: pending } = await pool.query(
      `SELECT * FROM deferred_analytics_sync
       WHERE status = 'pending' AND sync_after <= NOW()
       ORDER BY sync_after ASC
       LIMIT 20`
    );

    if (pending.length === 0) return [];

    console.log(`[FeedbackLoop] Processing ${pending.length} deferred analytics syncs`);

    const results = [];
    for (const sync of pending) {
      try {
        // Mark as completed (the actual metrics fetch is done by the analytics sync worker)
        await pool.query(
          `UPDATE deferred_analytics_sync
           SET status = 'completed', completed_at = NOW(), attempts = attempts + 1
           WHERE id = $1`,
          [sync.id]
        );

        // Score the tweet after analytics data arrives
        const tweetResult = await pool.query(
          `SELECT id FROM tweets WHERE tweet_id = $1 AND user_id = $2`,
          [sync.tweet_id, sync.user_id]
        );

        if (tweetResult.rows.length > 0) {
          await this.scoreTweet(tweetResult.rows[0].id);
        }

        results.push({ tweetId: sync.tweet_id, status: 'completed' });
      } catch (err) {
        console.error(`[FeedbackLoop] Deferred sync failed for tweet=${sync.tweet_id}:`, err.message);
        await pool.query(
          `UPDATE deferred_analytics_sync
           SET attempts = attempts + 1, status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END
           WHERE id = $1`,
          [sync.id]
        );
        results.push({ tweetId: sync.tweet_id, status: 'failed', error: err.message });
      }
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Weekly run — ties everything together
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run the full feedback loop cycle for all active strategies.
   * Intended to run weekly BEFORE content generation.
   *
   * 1. Score any unscored tweets
   * 2. Generate weekly performance summaries
   * 3. Auto-update strategies based on accumulated data
   *
   * Returns performance context for each strategy to inject into generation.
   */
  async runWeeklyCycle() {
    console.log('[FeedbackLoop] Starting weekly feedback cycle...');

    const { rows: activeStrategies } = await pool.query(
      `SELECT s.id AS strategy_id, s.user_id
       FROM user_strategies s
       WHERE s.status = 'active'
         AND COALESCE(s.metadata->>'product', 'tweet-genie') = 'tweet-genie'`
    );

    const contextMap = new Map();
    const results = { processed: 0, summaries: 0, updates: 0, errors: [] };

    for (const row of activeStrategies) {
      results.processed++;
      try {
        // 1. Score unscored tweets
        await this.scoreUnscoredTweets(row.user_id);

        // 2. Generate weekly summary
        const summary = await this.generateWeeklySummary(row.user_id, row.strategy_id);
        if (summary) results.summaries++;

        // 3. Auto-update strategy
        const updates = await this.autoUpdateStrategy(row.strategy_id);
        results.updates += updates.length;

        // 4. Build performance context for informed generation
        const context = await this.getPerformanceContext(row.user_id, row.strategy_id);
        if (context) {
          contextMap.set(row.strategy_id, context);
        }
      } catch (err) {
        results.errors.push({ strategyId: row.strategy_id, error: err.message });
        console.error(`[FeedbackLoop] Error for strategy=${row.strategy_id}:`, err.message);
      }
    }

    console.log(`[FeedbackLoop] Weekly cycle complete:`, results);
    return { results, contextMap };
  }
}

export const feedbackLoopService = new FeedbackLoopService();
