import pool from '../config/database.js';
import axios from 'axios';

// ─── Constants ──────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GENERATION_TEMPERATURE = 0.7;
const GENERATION_MAX_TOKENS = 4096;
const TRENDING_MAX_TOKENS = 2048;
const TWEETS_PER_WEEK = 7;

class WeeklyContentService {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
  }

  // ─── Fetch fresh trending topics ────────────────────────────────────────
  async fetchTrendingTopics(niche) {
    if (!this.googleApiKey) return [];

    const prompt = `What topics are trending on Twitter right now for "${niche}"? Return ONLY valid JSON array of exactly 5 trending topics.

Each topic should have:
- "topic": short topic name
- "context": one sentence explaining why it's trending
- "relevance": "high" | "medium"

Return format:
[
  { "topic": "string", "context": "string", "relevance": "high" },
  ...
]`;

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${this.googleApiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: TRENDING_MAX_TOKENS,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!content) return [];

      return this.parseJSONArray(content);
    } catch (error) {
      console.error('[WeeklyContent] Trending topics fetch error:', error.message);
      return [];
    }
  }

  // ─── Generate weekly tweets for a strategy ──────────────────────────────
  async generateWeeklyTweets(strategy, trendingTopics = []) {
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const metadata = strategy.metadata || {};
    const cache = metadata.analysis_cache || {};
    const niche = strategy.niche || cache.niche || 'general';
    const audience = strategy.target_audience || cache.audience || 'general audience';
    const tone = cache.tone || 'conversational';
    const topics = Array.isArray(strategy.topics) ? strategy.topics : (cache.top_topics || []);
    const goals = Array.isArray(strategy.content_goals) ? strategy.content_goals : [];
    const bestDays = cache.best_days || ['Tuesday', 'Thursday'];
    const bestHours = cache.best_hours || '9am-11am';
    const extraContext = metadata.extra_context || '';
    const competitorInsights = metadata.competitor_insights || null;

    const topicsSection = topics.length > 0
      ? topics.map((t) => `- ${t}`).join('\n')
      : '- General topics in niche';

    const goalsSection = goals.length > 0
      ? goals.map((g) => `- ${g}`).join('\n')
      : '- Build authority\n- Grow followers';

    const trendingSection = trendingTopics.length > 0
      ? trendingTopics.map((t) => `- ${t.topic}: ${t.context}`).join('\n')
      : '- No specific trending data';

    // Build competitor section from analysed reference accounts
    let competitorSection = '';
    if (competitorInsights && competitorInsights.handles?.length > 0) {
      const parts = [`Competitors analysed: ${competitorInsights.handles.join(', ')}`];
      if (competitorInsights.what_works?.length > 0) {
        parts.push(`What works for them:\n${competitorInsights.what_works.slice(0, 4).map((w) => `- ${w}`).join('\n')}`);
      }
      if (competitorInsights.content_angles?.length > 0) {
        parts.push(`Their winning angles:\n${competitorInsights.content_angles.slice(0, 4).map((a) => `- ${a}`).join('\n')}`);
      }
      if (competitorInsights.gaps_to_fill?.length > 0) {
        parts.push(`Gaps you can fill (topics they miss):\n${competitorInsights.gaps_to_fill.slice(0, 3).map((g) => `- ${g}`).join('\n')}`);
      }
      competitorSection = parts.join('\n');
    }

    const prompt = `You are a Twitter content strategist. Generate exactly ${TWEETS_PER_WEEK} ready-to-post tweets for this week.

CREATOR PROFILE:
Niche: ${niche}
Audience: ${audience}
Tone: ${tone}
Best days to post: ${bestDays.join(', ')}
Best posting time: ${bestHours}

GOALS:
${goalsSection}

TOPICS TO COVER:
${topicsSection}

TRENDING IN THEIR NICHE THIS WEEK:
${trendingSection}

${competitorSection ? `COMPETITOR INTELLIGENCE:\n${competitorSection}\n` : ''}
${extraContext ? `ADDITIONAL CONTEXT:\n${extraContext}\n` : ''}

IMPORTANT RULES:
1. Each tweet must be COMPLETELY written — ready to copy-paste and post.
2. No {placeholders} — fill in real content.
3. Mix formats: 2-3 short punchy tweets, 2-3 longer insight/value tweets, 1-2 engagement hooks (questions or polls).
4. At least 1 tweet should reference a trending topic.
5. Each tweet must be under 280 characters.
6. Assign each tweet a suggested day from the best days.
7. Include a "reason" explaining why this tweet was created and which goal it serves.
8. Include a "category" from: educational, engagement, storytelling, tips, promotional, inspirational.
${competitorSection ? '9. At least 1-2 tweets should fill competitor gaps or differentiate from their content angles.' : ''}

Return ONLY valid JSON:
{
  "tweets": [
    {
      "content": "string — the complete tweet text",
      "suggested_day": "string — e.g. Tuesday",
      "suggested_time": "${bestHours}",
      "category": "string — one of the 6 categories",
      "reason": "string — why this tweet and which goal it serves",
      "origin": "string — niche_fit | trending | audience_need | engagement_hook"
    }
  ]
}`;

    const response = await this.callGemini(prompt, GENERATION_MAX_TOKENS, GENERATION_TEMPERATURE);
    const parsed = this.parseJSON(response);
    return parsed?.tweets || [];
  }

  // ─── Generate for a single user ────────────────────────────────────────
  async generateForUser(userId, strategyId) {
    console.log(`[WeeklyContent] Generating for user=${userId}, strategy=${strategyId}`);

    // Fetch strategy
    const { rows: [strategy] } = await pool.query(
      `SELECT * FROM user_strategies WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [strategyId, userId]
    );

    if (!strategy) {
      throw new Error('Active strategy not found');
    }

    const niche = strategy.niche || strategy.metadata?.analysis_cache?.niche || 'general';

    // Fetch fresh trending topics
    const trendingTopics = await this.fetchTrendingTopics(niche);

    // Generate tweets
    const tweets = await this.generateWeeklyTweets(strategy, trendingTopics);

    if (!tweets.length) {
      console.warn(`[WeeklyContent] No tweets generated for user=${userId}`);
      return { count: 0, items: [] };
    }

    // Calculate suggested times for each tweet
    const scheduledItems = this.assignSuggestedTimes(tweets, strategy.metadata?.analysis_cache);

    // Insert into content_review_queue
    const insertValues = [];
    const insertParams = [];
    let paramIdx = 1;

    for (const item of scheduledItems) {
      insertValues.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      insertParams.push(
        userId,
        strategyId,
        item.content,
        item.suggestedTime?.toISOString() || null,
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        item.reason || '',
        'weekly_generation',
        item.category || null,
      );
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO content_review_queue (user_id, strategy_id, content, suggested_time, timezone, reason, source, category)
       VALUES ${insertValues.join(', ')}
       RETURNING *`,
      insertParams
    );

    console.log(`[WeeklyContent] Inserted ${inserted.length} items for user=${userId}`);

    return { count: inserted.length, items: inserted };
  }

  // ─── Run weekly generation for ALL active strategy users ───────────────
  async runWeeklyGeneration() {
    console.log('[WeeklyContent] Starting weekly content generation run...');

    const { rows: activeStrategies } = await pool.query(
      `SELECT s.id AS strategy_id, s.user_id, s.niche, s.metadata
       FROM user_strategies s
       WHERE s.status = 'active'
         AND COALESCE(s.metadata->>'product', 'tweet-genie') = 'tweet-genie'
       ORDER BY s.updated_at DESC`
    );

    console.log(`[WeeklyContent] Found ${activeStrategies.length} active strategies`);

    const results = { processed: 0, succeeded: 0, failed: 0, errors: [] };

    for (const row of activeStrategies) {
      results.processed++;
      try {
        const result = await this.generateForUser(row.user_id, row.strategy_id);
        if (result.count > 0) {
          results.succeeded++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          userId: row.user_id,
          strategyId: row.strategy_id,
          error: error.message,
        });
        console.error(`[WeeklyContent] Failed for user=${row.user_id}:`, error.message);
      }

      // Small delay between users to avoid rate limits
      await this.delay(1000);
    }

    console.log(`[WeeklyContent] Weekly run complete:`, results);
    return results;
  }

  // ─── Get review queue for a user ───────────────────────────────────────
  async getQueue(userId, filters = {}) {
    const conditions = ['user_id = $1'];
    const params = [userId];
    let paramIdx = 2;

    if (filters.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(filters.status);
    }

    if (filters.strategyId) {
      conditions.push(`strategy_id = $${paramIdx++}`);
      params.push(filters.strategyId);
    }

    const orderBy = filters.orderBy === 'suggested_time'
      ? 'suggested_time ASC NULLS LAST'
      : 'created_at DESC';

    const limit = filters.limit || 50;
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT * FROM content_review_queue 
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx}`,
      params
    );
    return rows;
  }

  // ─── Get queue stats ───────────────────────────────────────────────────
  async getQueueStats(userId, strategyId = null) {
    const conditions = ['user_id = $1', "created_at > NOW() - INTERVAL '14 days'"];
    const params = [userId];
    if (strategyId) {
      conditions.push('strategy_id = $2');
      params.push(strategyId);
    }
    const { rows } = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
         COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
         COUNT(*) AS total
       FROM content_review_queue
       WHERE ${conditions.join(' AND ')}`,
      params
    );
    return rows[0] || { pending: 0, approved: 0, rejected: 0, scheduled: 0, total: 0 };
  }

  // ─── Approve a queue item ──────────────────────────────────────────────
  async approveItem(itemId, userId) {
    const { rows: [item] } = await pool.query(
      `UPDATE content_review_queue 
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING *`,
      [itemId, userId]
    );
    return item || null;
  }

  // ─── Reject a queue item ──────────────────────────────────────────────
  async rejectItem(itemId, userId) {
    const { rows: [item] } = await pool.query(
      `UPDATE content_review_queue 
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING *`,
      [itemId, userId]
    );
    return item || null;
  }

  // ─── Update item content (edit) ────────────────────────────────────────
  async updateItem(itemId, userId, updates) {
    const setClauses = ['updated_at = NOW()'];
    const params = [itemId, userId];
    let paramIdx = 3;

    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIdx++}`);
      params.push(updates.content);
    }
    if (updates.suggested_time !== undefined) {
      setClauses.push(`suggested_time = $${paramIdx++}`);
      params.push(updates.suggested_time);
    }

    const { rows: [item] } = await pool.query(
      `UPDATE content_review_queue 
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'approved')
       RETURNING *`,
      params
    );
    return item || null;
  }

  // ─── Mark item as scheduled (after scheduling API call succeeds) ──────
  async markScheduled(itemId, userId, scheduledTweetId) {
    const { rows: [item] } = await pool.query(
      `UPDATE content_review_queue 
       SET status = 'scheduled', scheduled_tweet_id = $3, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [itemId, userId, scheduledTweetId]
    );
    return item || null;
  }

  // ─── Batch approve ─────────────────────────────────────────────────────
  async batchApprove(itemIds, userId) {
    if (!itemIds.length) return [];

    const { rows } = await pool.query(
      `UPDATE content_review_queue 
       SET status = 'approved', updated_at = NOW()
       WHERE id = ANY($1) AND user_id = $2 AND status = 'pending'
       RETURNING *`,
      [itemIds, userId]
    );
    return rows;
  }

  // ─── Assign suggested posting times ────────────────────────────────────
  assignSuggestedTimes(tweets, analysisCache = {}) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const bestDays = (analysisCache?.best_days || ['Tuesday', 'Thursday'])
      .map((d) => dayNames.indexOf(d))
      .filter((i) => i >= 0);

    // Parse best_hours like "9am-11am" → start hour
    let targetHour = 10;
    const hourMatch = (analysisCache?.best_hours || '').match(/(\d{1,2})(am|pm)/i);
    if (hourMatch) {
      targetHour = parseInt(hourMatch[1], 10);
      if (hourMatch[2].toLowerCase() === 'pm' && targetHour < 12) targetHour += 12;
      if (hourMatch[2].toLowerCase() === 'am' && targetHour === 12) targetHour = 0;
    }

    const now = new Date();
    const results = [];

    // Find next occurrence of each best day
    const availableSlots = [];
    for (let offset = 1; offset <= 14; offset++) {
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      candidate.setHours(targetHour, 0, 0, 0);
      if (bestDays.includes(candidate.getDay())) {
        availableSlots.push(new Date(candidate));
      }
    }

    // If no matching slots, generate fallback slots
    if (availableSlots.length === 0) {
      for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() + i);
        d.setHours(targetHour, 0, 0, 0);
        availableSlots.push(d);
      }
    }

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const slotIndex = i % availableSlots.length;
      // Stagger by 30 mins within a day for multiple tweets on same day
      const baseTime = new Date(availableSlots[slotIndex]);
      baseTime.setMinutes(baseTime.getMinutes() + Math.floor(i / availableSlots.length) * 30);

      results.push({
        content: tweet.content || tweet.text || '',
        suggestedTime: baseTime,
        reason: tweet.reason || '',
        source: tweet.source || 'weekly_generation',
        category: tweet.category || null,
      });
    }

    return results;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  async callGemini(prompt, maxTokens = GENERATION_MAX_TOKENS, temperature = GENERATION_TEMPERATURE) {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${this.googleApiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          topP: 1,
          maxOutputTokens: maxTokens,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );

    const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) throw new Error('Empty response from Gemini');
    return content;
  }

  parseJSON(text) {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Failed to parse Gemini JSON response');
    }
  }

  parseJSONArray(text) {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      return [];
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const weeklyContentService = new WeeklyContentService();
