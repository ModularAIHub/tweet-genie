import pool from '../config/database.js';
import axios from 'axios';
import moment from 'moment-timezone';

// ─── Constants ──────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GENERATION_TEMPERATURE = 0.7;
const GENERATION_MAX_TOKENS = 4096;
const TRENDING_MAX_TOKENS = 2048;
const TWEETS_PER_WEEK = 7;
const PRO_PLAN_TYPES_SQL = ['pro', 'enterprise', 'agency', 'premium', 'business'];
const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};
const AUTOPILOT_FEATURE_ENABLED = parseBooleanEnv(process.env.AUTOPILOT_FEATURE_ENABLED, false);

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
          tools: [{ googleSearch: {} }],
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!content) return [];

      const grounding = response.data.candidates?.[0]?.groundingMetadata;
      if (grounding) {
        console.log(`[WeeklyContent] Trending grounded with ${grounding.groundingChunks?.length || 0} search sources`);
      }

      return this.parseJSONArray(content);
    } catch (error) {
      console.error('[WeeklyContent] Trending topics fetch error:', error.message);
      return [];
    }
  }

  // ─── Generate weekly tweets for a strategy ──────────────────────────────
  async generateWeeklyTweets(strategy, trendingTopics = [], libraryPrompts = [], performanceContext = null) {
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

    // Build prompt library section if we have prompts to inject
    let promptLibrarySection = '';
    if (libraryPrompts.length > 0) {
      const promptLines = libraryPrompts.map((p, idx) => `${idx + 1}. [${p.category || 'general'}] ${p.prompt_text}`).join('\n');
      promptLibrarySection = `PROMPT LIBRARY IDEAS — use ${Math.min(libraryPrompts.length, 3)} of these as the basis for this week's tweets. Turn each idea into a complete, ready-to-post tweet:\n${promptLines}\n\nFor each tweet based on a library idea, set "source_prompt_index" to the idea number (0-indexed). For non-library tweets, set it to null.`;
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
${promptLibrarySection ? `${promptLibrarySection}\n` : ''}
${extraContext ? `ADDITIONAL CONTEXT:\n${extraContext}\n` : ''}
${performanceContext ? `${performanceContext}\n` : ''}

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
${promptLibrarySection ? `${competitorSection ? '10' : '9'}. Use the PROMPT LIBRARY IDEAS to create ${Math.min(libraryPrompts.length, 3)} of the ${TWEETS_PER_WEEK} tweets this week. Turn each idea into a complete, publish-ready tweet.` : ''}

Return ONLY valid JSON:
{
  "tweets": [
    {
      "content": "string — the complete tweet text",
      "suggested_day": "string — e.g. Tuesday",
      "suggested_time": "${bestHours}",
      "category": "string — one of the 6 categories",
      "reason": "string — why this tweet and which goal it serves",
      "origin": "string — niche_fit | trending | audience_need | engagement_hook | prompt_library",
      "source_prompt_index": "number | null — 0-based index of the prompt library idea used, or null"
    }
  ]
}`;

    const response = await this.callGemini(prompt, GENERATION_MAX_TOKENS, GENERATION_TEMPERATURE);
    const parsed = this.parseJSON(response);
    return parsed?.tweets || [];
  }

  // ─── Check if autopilot is enabled for a strategy ────────────────────
  async getAutopilotConfig(strategyId) {
    if (!AUTOPILOT_FEATURE_ENABLED) {
      return null;
    }
    try {
      const { rows } = await pool.query(
        'SELECT * FROM autopilot_config WHERE strategy_id = $1 AND is_enabled = true',
        [strategyId]
      );
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  // ─── Auto-schedule tweets directly (bypass review queue) ───────────────
  async autopilotSchedule(userId, strategyId, scheduledItems, libraryPrompts, userTz = 'UTC') {
    const UNDO_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const scheduledTweets = [];
    const tz = userTz && moment.tz.zone(userTz) ? userTz : 'UTC';

    for (const item of scheduledItems) {
      if (!item.suggestedTime || item.suggestedTime <= new Date()) continue;

      let matchedPromptId = null;
      if (item.source_prompt_index != null && libraryPrompts[item.source_prompt_index]) {
        matchedPromptId = libraryPrompts[item.source_prompt_index].id;
      }

      const undoDeadline = new Date(Date.now() + UNDO_WINDOW_MS);

      // Insert directly into scheduled_tweets
      const { rows: [scheduled] } = await pool.query(
        `INSERT INTO scheduled_tweets 
           (user_id, content, scheduled_for, timezone, status, approval_status, 
            source, undo_deadline, autopilot_strategy_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', 'approved', 'autopilot', $5, $6, NOW(), NOW())
         RETURNING id`,
        [userId, item.content, item.suggestedTime.toISOString(), tz, undoDeadline.toISOString(), strategyId]
      );

      // Also insert into content_review_queue as 'scheduled' for tracking
      await pool.query(
        `INSERT INTO content_review_queue 
           (user_id, strategy_id, content, suggested_time, timezone, reason, source, category, prompt_id, status, scheduled_tweet_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'autopilot', $7, $8, 'scheduled', $9)`,
        [userId, strategyId, item.content, item.suggestedTime.toISOString(), tz,
         item.reason || '', item.category || null, matchedPromptId, scheduled.id]
      );

      scheduledTweets.push(scheduled);
    }

    // Log to autopilot_history
    if (scheduledTweets.length > 0) {
      await pool.query(
        `INSERT INTO autopilot_history 
           (strategy_id, action, actor, success, tweets_count, details)
         VALUES ($1, 'auto_scheduled', 'system', true, $2, $3)`,
        [strategyId, scheduledTweets.length, JSON.stringify({
          tweet_ids: scheduledTweets.map(t => t.id),
          scheduled_at: new Date().toISOString(),
          undo_window_minutes: 60,
        })]
      );
    }

    console.log(`[WeeklyContent] 🤖 Autopilot auto-scheduled ${scheduledTweets.length} tweets for strategy=${strategyId}`);
    return scheduledTweets;
  }

  // ─── Generate for a single user ────────────────────────────────────────
  async generateForUser(userId, strategyId, performanceContext = null) {
    console.log(`[WeeklyContent] Generating for user=${userId}, strategy=${strategyId}${performanceContext ? ' (with performance data)' : ''}`);

    // Fetch strategy
    const { rows: [strategy] } = await pool.query(
      `SELECT * FROM user_strategies WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [strategyId, userId]
    );

    if (!strategy) {
      throw new Error('Active strategy not found');
    }

    const niche = strategy.niche || strategy.metadata?.analysis_cache?.niche || 'general';

    // Check if autopilot is enabled for this strategy
    const autopilotConfig = await this.getAutopilotConfig(strategyId);
    const isAutopilot = !!autopilotConfig;

    if (isAutopilot) {
      console.log(`[WeeklyContent] 🤖 Autopilot mode active for strategy=${strategyId}`);
    }

    // Fetch fresh trending topics
    const trendingTopics = await this.fetchTrendingTopics(niche);

    // Fetch 3 least-used prompts from the prompt library to fuel this week's content
    const { rows: libraryPrompts } = await pool.query(
      `SELECT id, prompt_text, category, variables FROM strategy_prompts
       WHERE strategy_id = $1
       ORDER BY usage_count ASC, RANDOM()
       LIMIT 3`,
      [strategyId]
    );

    if (libraryPrompts.length > 0) {
      console.log(`[WeeklyContent] Injecting ${libraryPrompts.length} prompt library ideas for strategy=${strategyId}`);
    }

    // Generate tweets (with performance context if available)
    const tweets = await this.generateWeeklyTweets(strategy, trendingTopics, libraryPrompts, performanceContext);

    if (!tweets.length) {
      console.warn(`[WeeklyContent] No tweets generated for user=${userId}`);
      return { count: 0, items: [], autopilot: isAutopilot };
    }

    // Increment usage_count on the prompts we fed into generation
    if (libraryPrompts.length > 0) {
      const promptIds = libraryPrompts.map((p) => p.id);
      await pool.query(
        `UPDATE strategy_prompts SET usage_count = usage_count + 1, last_used_at = NOW() WHERE id = ANY($1)`,
        [promptIds]
      );
    }

    // Calculate suggested times for each tweet (use user's timezone from autopilot config)
    const userTz = autopilotConfig?.timezone || 'UTC';
    const scheduledItems = this.assignSuggestedTimes(tweets, strategy.metadata?.analysis_cache, userTz);

    // ─── Autopilot path: skip review queue, schedule directly ──────────
    if (isAutopilot) {
      const autoScheduled = await this.autopilotSchedule(userId, strategyId, scheduledItems, libraryPrompts, userTz);
      return { count: autoScheduled.length, items: autoScheduled, autopilot: true };
    }

    // ─── Normal path: insert into review queue for manual approval ─────
    // Build a lookup of prompt_text → prompt_id for matching generated tweets to source prompts
    const promptTextMap = new Map();
    for (const lp of libraryPrompts) {
      const key = (lp.prompt_text || '').toLowerCase().slice(0, 40).trim();
      if (key) promptTextMap.set(key, lp.id);
    }

    const insertValues = [];
    const insertParams = [];
    let paramIdx = 1;

    for (const item of scheduledItems) {
      let matchedPromptId = null;
      if (item.source_prompt_index != null && libraryPrompts[item.source_prompt_index]) {
        matchedPromptId = libraryPrompts[item.source_prompt_index].id;
      }

      insertValues.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      insertParams.push(
        userId,
        strategyId,
        item.content,
        item.suggestedTime?.toISOString() || null,
        userTz,
        item.reason || '',
        'weekly_generation',
        item.category || null,
        matchedPromptId,
      );
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO content_review_queue (user_id, strategy_id, content, suggested_time, timezone, reason, source, category, prompt_id)
       VALUES ${insertValues.join(', ')}
       RETURNING *`,
      insertParams
    );

    console.log(`[WeeklyContent] Inserted ${inserted.length} items for user=${userId}`);

    return { count: inserted.length, items: inserted, autopilot: false };
  }

  // ─── Run weekly generation for ALL active strategy users ───────────────
  async runWeeklyGeneration(performanceContextMap = new Map()) {
    console.log('[WeeklyContent] Starting weekly content generation run...');

    const { rows: activeStrategies } = await pool.query(
      `SELECT s.id AS strategy_id, s.user_id, s.niche, s.metadata
       FROM user_strategies s
       LEFT JOIN users u
         ON u.id = s.user_id
       LEFT JOIN teams t
         ON t.id = s.team_id
       WHERE s.status = 'active'
         AND COALESCE(s.metadata->>'product', 'tweet-genie') = 'tweet-genie'
         AND (
           LOWER(COALESCE(u.plan_type, '')) = ANY($1::text[])
           OR LOWER(COALESCE(t.plan_type, '')) = ANY($1::text[])
         )
       ORDER BY s.updated_at DESC`,
      [PRO_PLAN_TYPES_SQL]
    );

    console.log(`[WeeklyContent] Found ${activeStrategies.length} active strategies`);

    const results = { processed: 0, succeeded: 0, failed: 0, errors: [] };

    for (const row of activeStrategies) {
      results.processed++;
      try {
        // Phase 5: Pass performance context if available
        const perfContext = performanceContextMap.get(row.strategy_id) || null;
        const result = await this.generateForUser(row.user_id, row.strategy_id, perfContext);
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
    const conditions = ['crq.user_id = $1'];
    const params = [userId];
    let paramIdx = 2;

    if (filters.status) {
      conditions.push(`crq.status = $${paramIdx++}`);
      params.push(filters.status);
    }

    if (filters.strategyId) {
      conditions.push(`crq.strategy_id = $${paramIdx++}`);
      params.push(filters.strategyId);
    }

    const orderBy = filters.orderBy === 'suggested_time'
      ? 'crq.suggested_time ASC NULLS LAST'
      : 'crq.created_at DESC';

    const limit = filters.limit || 50;
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT crq.*,
              sp.prompt_text AS source_prompt_text,
              sp.category    AS source_prompt_category
       FROM content_review_queue crq
       LEFT JOIN strategy_prompts sp ON sp.id = crq.prompt_id
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
  assignSuggestedTimes(tweets, analysisCache = {}, userTz = 'UTC') {
    const tz = userTz && moment.tz.zone(userTz) ? userTz : 'UTC';
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

    const nowMoment = moment.tz(tz);
    const results = [];

    // Find next occurrence of each best day
    const availableSlots = [];
    for (let offset = 1; offset <= 14; offset++) {
      const candidate = nowMoment.clone().add(offset, 'days').startOf('day').hour(targetHour);
      if (bestDays.includes(candidate.day())) {
        availableSlots.push(candidate);
      }
    }

    // If no matching slots, generate fallback slots
    if (availableSlots.length === 0) {
      for (let i = 1; i <= 7; i++) {
        const d = nowMoment.clone().add(i, 'days').startOf('day').hour(targetHour);
        availableSlots.push(d);
      }
    }

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const slotIndex = i % availableSlots.length;
      // Stagger by 30 mins within a day for multiple tweets on same day
      const baseTime = availableSlots[slotIndex].clone()
        .add(Math.floor(i / availableSlots.length) * 30, 'minutes');

      results.push({
        content: tweet.content || tweet.text || '',
        suggestedTime: baseTime.toDate(),
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
