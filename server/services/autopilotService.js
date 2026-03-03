// Auto-Pilot Service for Strategy Builder (Phase 4)
import pool from '../config/database.js';
import { aiService } from './aiService.js';
import { creditService } from './creditService.js';
import moment from 'moment-timezone';

// Credit cost per autopilot-generated post (matches compose cost)
const AUTOPILOT_CREDIT_COST = 1.2;

// Max posts to generate per worker run (spreads AI load across hourly cycles)
const AUTOPILOT_BATCH_SIZE = 6;

/**
 * Get or create autopilot configuration for a strategy
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Object>} Autopilot configuration
 */
export async function getAutopilotConfig(strategyId) {
  try {
    let result = await pool.query(
      'SELECT * FROM autopilot_config WHERE strategy_id = $1',
      [strategyId]
    );
    
    if (result.rows.length === 0) {
      // Create default config
      result = await pool.query(
        `INSERT INTO autopilot_config 
           (strategy_id, is_enabled, posts_per_day, generation_mode, 
            use_optimal_times, require_approval)
         VALUES ($1, false, 3, 'smart', true, true)
         RETURNING *`,
        [strategyId]
      );
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error getting autopilot config:', error);
    throw error;
  }
}

/**
 * Update autopilot configuration
 * @param {string} strategyId - Strategy ID
 * @param {Object} updates - Configuration updates
 * @returns {Promise<Object>} Updated configuration
 */
export async function updateAutopilotConfig(strategyId, updates) {
  try {
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    });
    
    values.push(strategyId);
    
    const result = await pool.query(
      `UPDATE autopilot_config 
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE strategy_id = $${paramCount}
       RETURNING *`,
      values
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error updating autopilot config:', error);
    throw error;
  }
}

/**
 * Generate content using AI based on a prompt template
 * @param {Object} prompt - Prompt object from strategy_prompts
 * @param {Object} strategy - Strategy object
 * @returns {Promise<string>} Generated content
 */
export async function generateContentFromPrompt(prompt, strategy) {
  try {
    const fullPrompt = `You are a professional content creator specializing in ${strategy.niche}. 
Target audience: ${strategy.target_audience}
Tone: ${strategy.tone_style}
Goals: ${strategy.content_goals?.join(', ')}

Task: ${prompt.prompt_text}

Generate engaging tweet content that aligns with the strategy. Keep it concise, valuable, and authentic. Output only the tweet content, no explanations.`;

    const result = await aiService.generateStrategyContent(fullPrompt, 'professional', null, strategy?.user_id || null);
    
    return result.content;
  } catch (error) {
    console.error('Error generating content:', error);
    throw error;
  }
}

/**
 * Determine the next optimal posting time
 * @param {string} strategyId - Strategy ID
 * @param {Object} config - Autopilot configuration
 * @returns {Promise<Date>} Next optimal posting time
 */
export async function getNextOptimalPostingTime(strategyId, config) {
  try {
    // Use the timezone from autopilot config (user's timezone), default to UTC
    const userTz = config.timezone && moment.tz.zone(config.timezone) ? config.timezone : 'UTC';

    /**
     * Helper: create a Date at the given hour in the USER's timezone,
     * correctly converted to UTC (which is what the DB stores).
     */
    function createSlotDate(baseMoment, hour) {
      return baseMoment.clone().startOf('day').hour(hour).toDate();
    }

    if (config.use_optimal_times) {
      // Get recommended posting times
      const result = await pool.query(
        `SELECT day_of_week, hour 
         FROM optimal_posting_schedule
         WHERE strategy_id = $1 AND is_recommended = true
         ORDER BY avg_engagement_rate DESC`,
        [strategyId]
      );
      
      if (result.rows.length > 0) {
        const nowMoment = moment.tz(userTz);
        const now = nowMoment.toDate();
        const recommendedSlots = result.rows;
        
        // Find the next available optimal slot
        for (let daysAhead = 0; daysAhead < 7; daysAhead++) {
          const checkMoment = nowMoment.clone().add(daysAhead, 'days');
          const dayOfWeek = checkMoment.day();
          
          const todaySlots = recommendedSlots.filter(s => s.day_of_week === dayOfWeek);
          
          for (const slot of todaySlots) {
            const slotTime = createSlotDate(checkMoment, slot.hour);
            
            if (slotTime > now) {
              // Check if slot is available (not already scheduled in content_review_queue)
              const existingResult = await pool.query(
                `SELECT id FROM content_review_queue 
                 WHERE strategy_id = $1 
                   AND suggested_time BETWEEN $2 AND $3
                   AND status IN ('pending', 'approved', 'scheduled')`,
                [strategyId, new Date(slotTime.getTime() - 30*60000), new Date(slotTime.getTime() + 30*60000)]
              );

              // Also check scheduled_tweets to avoid double-booking
              const scheduledResult = await pool.query(
                `SELECT id FROM scheduled_tweets 
                 WHERE user_id = (SELECT user_id FROM user_strategies WHERE id = $1)
                   AND scheduled_for BETWEEN $2 AND $3
                   AND status = 'pending'`,
                [strategyId, new Date(slotTime.getTime() - 30*60000), new Date(slotTime.getTime() + 30*60000)]
              );

              if (existingResult.rows.length === 0 && scheduledResult.rows.length === 0) {
                return slotTime;
              }
            }
          }
        }
      }
    }
    
    // Fallback: use custom hours or derive from posts_per_day
    // Spread across multiple days with conflict checking
    const postsPerDay = config.posts_per_day || 3;
    let customHours;
    if (config.custom_posting_hours && config.custom_posting_hours.length > 0) {
      customHours = config.custom_posting_hours;
    } else {
      // Evenly distribute slots across the day based on posts_per_day
      const slotMap = {
        1: [12],                    // 12 PM
        2: [9, 17],                 // 9 AM, 5 PM
        3: [9, 12, 17],             // 9 AM, 12 PM, 5 PM
        4: [8, 11, 14, 18],         // 8 AM, 11 AM, 2 PM, 6 PM
        5: [8, 10, 12, 15, 18],     // 8 AM, 10 AM, 12 PM, 3 PM, 6 PM
      };
      customHours = slotMap[Math.min(postsPerDay, 5)] || slotMap[3];
    }
    
    const nowMoment = moment.tz(userTz);
    const now = nowMoment.toDate();
    
    console.log(`[Autopilot] Custom hours path: hours=${JSON.stringify(customHours)}, tz=${userTz}, use_optimal=${config.use_optimal_times}`);
    
    // Check up to 14 days ahead to find an open slot
    for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
      const checkMoment = nowMoment.clone().add(daysAhead, 'days');
      
      for (const hour of customHours) {
        const slotTime = createSlotDate(checkMoment, hour);
        
        if (slotTime <= now) continue; // Skip past times
        
        // Check if this slot is already taken (within ±30 min window)
        const existingResult = await pool.query(
          `SELECT id FROM content_review_queue 
           WHERE strategy_id = $1 
             AND suggested_time BETWEEN $2 AND $3
             AND status IN ('pending', 'approved', 'scheduled')`,
          [strategyId, new Date(slotTime.getTime() - 30*60000), new Date(slotTime.getTime() + 30*60000)]
        );
        
        // Also check scheduled_tweets to avoid double-booking
        const scheduledResult = await pool.query(
          `SELECT id FROM scheduled_tweets 
           WHERE user_id = (SELECT user_id FROM user_strategies WHERE id = $1)
             AND scheduled_for BETWEEN $2 AND $3
             AND status = 'pending'`,
          [strategyId, new Date(slotTime.getTime() - 30*60000), new Date(slotTime.getTime() + 30*60000)]
        );
        
        if (existingResult.rows.length === 0 && scheduledResult.rows.length === 0) {
          return slotTime;
        }
      }
    }
    
    // If somehow all slots for 14 days are taken, schedule for next hour (in user TZ)
    const nextHour = moment.tz(userTz).add(1, 'hour').startOf('hour').toDate();
    return nextHour;
  } catch (error) {
    console.error('Error getting next optimal posting time:', error);
    // Fallback: next hour UTC
    const nextHour = new Date();
    nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
    return nextHour;
  }
}

/**
 * Select next prompt for content generation
 * Uses intelligent rotation to ensure diversity
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Object>} Selected prompt
 */
export async function selectNextPrompt(strategyId) {
  try {
    // Get the prompt IDs already used in current pending/approved queue to avoid repeats
    const usedResult = await pool.query(
      `SELECT DISTINCT prompt_id FROM content_review_queue
       WHERE strategy_id = $1 AND source = 'autopilot'
         AND status IN ('pending', 'approved')
         AND prompt_id IS NOT NULL`,
      [strategyId]
    );
    const usedPromptIds = usedResult.rows.map(r => r.prompt_id);

    // Build query — exclude prompts already in queue if possible
    let query = `
      SELECT sp.*,
         COALESCE(sp.usage_count, 0) as eff_usage_count,
         COALESCE(sp.last_used_at, '1970-01-01') as eff_last_used_at,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(sp.last_used_at, '1970-01-01'))) as seconds_since_last_use
       FROM strategy_prompts sp
       WHERE sp.strategy_id = $1`;
    const params = [strategyId];

    if (usedPromptIds.length > 0) {
      query += ` AND sp.id != ALL($2)`;
      params.push(usedPromptIds);
    }

    query += `
       ORDER BY 
         eff_usage_count ASC,
         seconds_since_last_use DESC,
         sp.is_favorite DESC
       LIMIT 1`;

    let result = await pool.query(query, params);

    // If all prompts are already in queue, do NOT recycle — stop generation
    if (result.rows.length === 0) {
      const totalResult = await pool.query(
        `SELECT COUNT(*) as total FROM strategy_prompts WHERE strategy_id = $1`,
        [strategyId]
      );
      if (parseInt(totalResult.rows[0].total) === 0) {
        throw new Error('No prompts available for this strategy');
      }
      // All prompts have been used — signal exhaustion
      const err = new Error('PROMPTS_EXHAUSTED');
      err.code = 'PROMPTS_EXHAUSTED';
      throw err;
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error selecting next prompt:', error);
    throw error;
  }
}

/**
 * Generate and queue content automatically
 * @param {string} strategyId - Strategy ID
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Queued content
 */
export async function generateAndQueueContent(strategyId, options = {}) {
  try {
    // Get strategy details
    const strategyResult = await pool.query(
      'SELECT * FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (strategyResult.rows.length === 0) {
      throw new Error('Strategy not found');
    }
    
    const strategy = strategyResult.rows[0];
    const config = await getAutopilotConfig(strategyId);
    
    // Select prompt FIRST (may throw PROMPTS_EXHAUSTED — no credits deducted yet)
    const prompt = options.promptId
      ? (await pool.query('SELECT * FROM strategy_prompts WHERE id = $1', [options.promptId])).rows[0]
      : await selectNextPrompt(strategyId);
    
    if (!prompt) {
      throw new Error('No prompt available');
    }

    // Check and deduct credits AFTER prompt selection (only charge when we have work to do)
    const creditCheck = await creditService.checkAndDeductCredits(
      strategy.user_id, 'autopilot_generation', AUTOPILOT_CREDIT_COST
    );
    if (!creditCheck.success) {
      const err = new Error('INSUFFICIENT_CREDITS');
      err.code = 'INSUFFICIENT_CREDITS';
      err.available = creditCheck.available;
      err.required = AUTOPILOT_CREDIT_COST;
      throw err;
    }
    
    // Generate content
    const generatedContent = await generateContentFromPrompt(prompt, strategy);
    
    // Determine posting time
    const scheduledFor = options.scheduledFor 
      ? new Date(options.scheduledFor)
      : await getNextOptimalPostingTime(strategyId, config);
    
    // Determine initial status
    const initialStatus = config.require_approval ? 'pending' : 'approved';

    // Insert into unified content_review_queue
    const configTz = config.timezone || 'UTC';
    const queueResult = await pool.query(
      `INSERT INTO content_review_queue 
         (user_id, strategy_id, content, suggested_time, timezone, reason, source, category, prompt_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'autopilot', $7, $8, $9)
       RETURNING *`,
      [
        strategy.user_id,
        strategyId,
        generatedContent,
        scheduledFor,
        configTz,
        `Auto-generated by autopilot (${options.generationMode || 'auto'} mode)`,
        prompt.category,
        prompt.id,
        initialStatus
      ]
    );

    const queuedItem = queueResult.rows[0];
    
    // If approval not required, auto-schedule into scheduled_tweets immediately
    if (!config.require_approval) {
      // Ensure scheduled time is in the future
      const schedTime = new Date(scheduledFor) <= new Date()
        ? new Date(Date.now() + 60_000)
        : new Date(scheduledFor);

      // Detect threads: split on --- separator
      const tParts = generatedContent.split(/---+/).map(p => p.trim()).filter(Boolean);
      const isThread = tParts.length > 1;
      const mainContent = isThread ? tParts[0] : generatedContent;
      const threadTweets = isThread ? JSON.stringify(tParts.slice(1).map(p => ({ content: p }))) : null;

      const { rows: [tweet] } = await pool.query(
        `INSERT INTO scheduled_tweets (user_id, content, thread_tweets, scheduled_for, timezone, status, approval_status, source, autopilot_strategy_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', 'approved', 'autopilot', $6, NOW(), NOW())
         RETURNING id`,
        [strategy.user_id, mainContent, threadTweets, schedTime.toISOString(), configTz, strategyId]
      );

      // Mark CRQ item as scheduled
      await pool.query(
        `UPDATE content_review_queue SET status = 'scheduled', scheduled_tweet_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [tweet.id, queuedItem.id]
      );

      queuedItem.status = 'scheduled';
      queuedItem.scheduled_tweet_id = tweet.id;
    }

    // Update prompt usage
    await pool.query(
      `UPDATE strategy_prompts 
       SET usage_count = usage_count + 1, last_used_at = NOW()
       WHERE id = $1`,
      [prompt.id]
    );
    
    // Log history (queue_id left NULL to avoid FK issues with strategy_queue)
    await pool.query(
      `INSERT INTO autopilot_history 
         (strategy_id, action, actor, prompt_used, category, success, metadata)
       VALUES ($1, 'generated', 'system', $2, $3, true, $4)`,
      [strategyId, prompt.id, prompt.category, JSON.stringify({ content_queue_id: queuedItem.id, auto_scheduled: !config.require_approval })]
    );
    
    console.log(`✅ Auto-generated content for strategy ${strategyId}, scheduled for:`, scheduledFor);
    
    return queuedItem;
  } catch (error) {
    console.error('Error generating and queuing content:', error);
    
    // Refund credits if they were already deducted and the error is NOT
    // a credit/prompt issue (those didn't generate anything)
    if (error.code !== 'INSUFFICIENT_CREDITS' && error.code !== 'PROMPTS_EXHAUSTED') {
      try {
        const strat = (await pool.query('SELECT user_id FROM user_strategies WHERE id = $1', [strategyId])).rows[0];
        if (strat) {
          await creditService.refundCredits(strat.user_id, 'autopilot_generation_failed', AUTOPILOT_CREDIT_COST);
          console.log(`💳 Refunded ${AUTOPILOT_CREDIT_COST} credits to user ${strat.user_id} after failed autopilot generation`);
        }
      } catch (refundErr) {
        console.error('Failed to refund credits after autopilot error:', refundErr.message);
      }
    }

    // Log failure
    await pool.query(
      `INSERT INTO autopilot_history 
         (strategy_id, action, actor, success, error_message)
       VALUES ($1, 'generated', 'system', false, $2)`,
      [strategyId, error.message]
    );
    
    throw error;
  }
}

/**
 * Fill queue with content up to max_queue_size
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Array>} Generated queue items
 */
export async function fillQueue(strategyId) {
  try {
    const config = await getAutopilotConfig(strategyId);
    
    if (!config.is_enabled) {
      return [];
    }

    // Expire stale approved autopilot items that are more than 2 hours past their suggested time
    await pool.query(
      `UPDATE content_review_queue
       SET status = 'expired'
       WHERE strategy_id = $1
         AND source = 'autopilot'
         AND status = 'approved'
         AND suggested_time < NOW() - INTERVAL '2 hours'`,
      [strategyId]
    );
    
    // Count current active autopilot queue items
    const countResult = await pool.query(
      `SELECT COUNT(*) as count 
       FROM content_review_queue 
       WHERE strategy_id = $1 
         AND source = 'autopilot'
         AND status IN ('pending', 'approved')`,
      [strategyId]
    );
    
    const currentCount = parseInt(countResult.rows[0].count);
    // Target: enough content for a full 7-day week based on posts_per_day
    const postsPerDay = config.posts_per_day || 3;
    const targetCount = postsPerDay * 7; // e.g. 3/day × 7 = 21 posts
    const deficit = Math.max(0, targetCount - currentCount);
    // Cap to AUTOPILOT_BATCH_SIZE per run so AI load is spread across hourly worker cycles
    const needToGenerate = Math.min(deficit, AUTOPILOT_BATCH_SIZE);
    console.log(`🤖 Autopilot fillQueue: strategy=${strategyId}, postsPerDay=${postsPerDay}, target=${targetCount}, current=${currentCount}, deficit=${deficit}, batchCap=${AUTOPILOT_BATCH_SIZE}, toGenerate=${needToGenerate}`);
    
    const generated = [];
    
    for (let i = 0; i < needToGenerate; i++) {
      try {
        const queued = await generateAndQueueContent(strategyId);
        generated.push(queued);
        
        // Delay between generations to avoid overwhelming the AI API
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        // Stop generation loop on exhaustion / credit errors and persist reason
        if (error.code === 'PROMPTS_EXHAUSTED') {
          console.warn(`⚠️ Autopilot: All prompts exhausted for strategy ${strategyId} — pausing.`);
          await pool.query(
            `UPDATE autopilot_config SET paused_reason = 'prompts_exhausted', updated_at = NOW() WHERE strategy_id = $1`,
            [strategyId]
          );
          break;
        }
        if (error.code === 'INSUFFICIENT_CREDITS') {
          console.warn(`⚠️ Autopilot: Insufficient credits for strategy ${strategyId} — pausing.`);
          await pool.query(
            `UPDATE autopilot_config SET paused_reason = 'insufficient_credits', updated_at = NOW() WHERE strategy_id = $1`,
            [strategyId]
          );
          break;
        }
        console.error(`Error generating content ${i + 1}/${needToGenerate}:`, error.message);
      }
    }
    
    console.log(`🤖 Autopilot: Generated ${generated.length} new posts for strategy ${strategyId}`);
    
    return generated;
  } catch (error) {
    console.error('Error filling queue:', error);
    throw error;
  }
}

/**
 * Get queue for a strategy
 * @param {string} strategyId - Strategy ID
 * @param {Object} filters - Optional filters (status, limit)
 * @returns {Promise<Array>} Queue items
 */
export async function getQueue(strategyId, filters = {}) {
  try {
    let query = `
      SELECT crq.*, sp.category as prompt_category, sp.prompt_text,
             crq.content as generated_content,
             crq.suggested_time as scheduled_for
      FROM content_review_queue crq
      LEFT JOIN strategy_prompts sp ON crq.prompt_id = sp.id
      WHERE crq.strategy_id = $1
        AND crq.source = 'autopilot'
    `;
    
    const params = [strategyId];
    let paramCount = 2;
    
    if (filters.status) {
      // Support comma-separated statuses
      const statuses = filters.status.split(',').map(s => s.trim());
      query += ` AND crq.status = ANY($${paramCount})`;
      params.push(statuses);
      paramCount++;
    }
    
    query += ` ORDER BY crq.suggested_time ASC`;
    
    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
    }
    
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error getting queue:', error);
    throw error;
  }
}

/**
 * Approve queued content
 * @param {string} queueId - Queue item ID
 * @param {string} userId - User ID approving
 * @returns {Promise<Object>} Updated queue item
 */
export async function approveQueuedContent(queueId, userId) {
  try {
    const result = await pool.query(
      `UPDATE content_review_queue 
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [queueId]
    );
    
    if (result.rows.length > 0) {
      await pool.query(
        `INSERT INTO autopilot_history 
           (strategy_id, action, actor, success, metadata)
         VALUES ($1, 'approved', $2, true, $3)`,
        [result.rows[0].strategy_id, userId, JSON.stringify({ content_queue_id: queueId })]
      );
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error approving content:', error);
    throw error;
  }
}

/**
 * Reject queued content
 * @param {string} queueId - Queue item ID
 * @param {string} userId - User ID rejecting
 * @param {string} reason - Rejection reason
 * @returns {Promise<Object>} Updated queue item
 */
export async function rejectQueuedContent(queueId, userId, reason) {
  try {
    const result = await pool.query(
      `UPDATE content_review_queue 
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [queueId]
    );
    
    if (result.rows.length > 0) {
      await pool.query(
        `INSERT INTO autopilot_history 
           (strategy_id, action, actor, success, error_message, metadata)
         VALUES ($1, 'rejected', $2, true, $3, $4)`,
        [result.rows[0].strategy_id, userId, reason, JSON.stringify({ content_queue_id: queueId })]
      );
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error rejecting content:', error);
    throw error;
  }
}

/**
 * Edit queued content
 * @param {string} queueId - Queue item ID
 * @param {string} newContent - Updated content
 * @returns {Promise<Object>} Updated queue item
 */
export async function editQueuedContent(queueId, newContent) {
  try {
    const result = await pool.query(
      `UPDATE content_review_queue 
       SET content = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newContent, queueId]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error editing content:', error);
    throw error;
  }
}

/**
 * Process approved autopilot items — move them into scheduled_tweets for posting.
 * Called by the autopilot cron tick after fillQueue.
 * Handles the case where require_approval=true and user approved in ContentReview.
 */
export async function processApprovedQueue() {
  try {
    // Find all approved autopilot items whose suggested_time is within the next 30 min
    // or already past (should post ASAP)
    const { rows: readyItems } = await pool.query(
      `SELECT crq.*, us.user_id, ac.timezone as config_timezone
       FROM content_review_queue crq
       JOIN user_strategies us ON crq.strategy_id = us.id
       JOIN autopilot_config ac ON ac.strategy_id = crq.strategy_id
       WHERE crq.source = 'autopilot'
         AND crq.status = 'approved'
         AND crq.suggested_time <= NOW() + INTERVAL '30 minutes'
         AND ac.is_enabled = true
       ORDER BY crq.suggested_time ASC
       LIMIT 20`
    );

    if (readyItems.length === 0) return [];

    const posted = [];
    for (const item of readyItems) {
      try {
        // Ensure scheduled time is in the future (at least 1 min from now)
        const scheduledFor = new Date(item.suggested_time) <= new Date()
          ? new Date(Date.now() + 60_000)
          : new Date(item.suggested_time);

        // Detect threads: split on --- separator
        const tParts = (item.content || '').split(/---+/).map(p => p.trim()).filter(Boolean);
        const isThread = tParts.length > 1;
        const mainContent = isThread ? tParts[0] : item.content;
        const threadTweets = isThread ? JSON.stringify(tParts.slice(1).map(p => ({ content: p }))) : null;

        // Insert into scheduled_tweets
        const itemTz = item.config_timezone || 'UTC';
        const { rows: [tweet] } = await pool.query(
          `INSERT INTO scheduled_tweets (user_id, content, thread_tweets, scheduled_for, timezone, status, approval_status, source, autopilot_strategy_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', 'approved', 'autopilot', $6, NOW(), NOW())
           RETURNING id`,
          [item.user_id, mainContent, threadTweets, scheduledFor.toISOString(), itemTz, item.strategy_id]
        );

        // Mark CRQ item as scheduled
        await pool.query(
          `UPDATE content_review_queue SET status = 'scheduled', scheduled_tweet_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [tweet.id, item.id]
        );

        // Log history
        await pool.query(
          `INSERT INTO autopilot_history
             (strategy_id, action, actor, success, metadata)
           VALUES ($1, 'scheduled', 'system', true, $2)`,
          [item.strategy_id, JSON.stringify({ content_queue_id: item.id, scheduled_tweet_id: tweet.id })]
        );

        posted.push({ queueId: item.id, scheduledTweetId: tweet.id });
        console.log(`🤖 Autopilot: Scheduled CRQ item ${item.id} → tweet ${tweet.id}`);
      } catch (err) {
        console.error(`❌ Autopilot: Failed to schedule CRQ item ${item.id}:`, err.message);
      }
    }

    return posted;
  } catch (error) {
    console.error('Error processing approved queue:', error);
    return [];
  }
}

export default {
  getAutopilotConfig,
  updateAutopilotConfig,
  generateContentFromPrompt,
  getNextOptimalPostingTime,
  selectNextPrompt,
  generateAndQueueContent,
  fillQueue,
  getQueue,
  processApprovedQueue,
  approveQueuedContent,
  rejectQueuedContent,
  editQueuedContent
};
