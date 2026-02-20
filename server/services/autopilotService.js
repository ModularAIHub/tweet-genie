// Auto-Pilot Service for Strategy Builder (Phase 4)
import pool from '../config/database.js';
import { aiService } from './aiService.js';

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
        const now = new Date();
        const recommendedSlots = result.rows;
        
        // Find the next available optimal slot
        for (let daysAhead = 0; daysAhead < 7; daysAhead++) {
          const checkDate = new Date(now);
          checkDate.setDate(checkDate.getDate() + daysAhead);
          const dayOfWeek = checkDate.getDay();
          
          const todaySlots = recommendedSlots.filter(s => s.day_of_week === dayOfWeek);
          
          for (const slot of todaySlots) {
            const slotTime = new Date(checkDate);
            slotTime.setHours(slot.hour, 0, 0, 0);
            
            if (slotTime > now) {
              // Check if slot is available (not already scheduled)
              const existingResult = await pool.query(
                `SELECT id FROM strategy_queue 
                 WHERE strategy_id = $1 
                   AND scheduled_for BETWEEN $2 AND $3
                   AND status IN ('pending', 'approved')`,
                [strategyId, new Date(slotTime.getTime() - 30*60000), new Date(slotTime.getTime() + 30*60000)]
              );
              
              if (existingResult.rows.length === 0) {
                return slotTime;
              }
            }
          }
        }
      }
    }
    
    // Fallback: use custom hours or default to spreading throughout the day
    const customHours = config.custom_posting_hours && config.custom_posting_hours.length > 0
      ? config.custom_posting_hours
      : [9, 12, 17]; // Default hours: 9 AM, 12 PM, 5 PM
    
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    for (const hour of customHours) {
      const slotTime = new Date(today);
      slotTime.setHours(hour, 0, 0, 0);
      
      if (slotTime > now) {
        return slotTime;
      }
    }
    
    // If all slots today are past, schedule for tomorrow
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(customHours[0], 0, 0, 0);
    return tomorrow;
  } catch (error) {
    console.error('Error getting next optimal posting time:', error);
    // Fallback: next hour
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
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
    // Get prompts with usage stats
    const result = await pool.query(
      `SELECT sp.*, 
         COALESCE(sp.usage_count, 0) as usage_count,
         COALESCE(sp.last_used_at, '1970-01-01') as last_used_at,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(sp.last_used_at, '1970-01-01'))) as seconds_since_last_use
       FROM strategy_prompts sp
       WHERE sp.strategy_id = $1
       ORDER BY 
         sp.is_favorite DESC,
         usage_count ASC,
         seconds_since_last_use DESC
       LIMIT 1`,
      [strategyId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('No prompts available for this strategy');
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
    
    // Select prompt
    const prompt = options.promptId
      ? (await pool.query('SELECT * FROM strategy_prompts WHERE id = $1', [options.promptId])).rows[0]
      : await selectNextPrompt(strategyId);
    
    if (!prompt) {
      throw new Error('No prompt available');
    }
    
    // Generate content
    const generatedContent = await generateContentFromPrompt(prompt, strategy);
    
    // Determine posting time
    const scheduledFor = options.scheduledFor 
      ? new Date(options.scheduledFor)
      : await getNextOptimalPostingTime(strategyId, config);
    
    // Queue content
    const queueResult = await pool.query(
      `INSERT INTO strategy_queue 
         (strategy_id, prompt_id, generated_content, scheduled_for, status,
          generation_mode, category, ideal_posting_time, approval_required, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        strategyId,
        prompt.id,
        generatedContent,
        scheduledFor,
        config.require_approval ? 'pending' : 'approved',
        options.generationMode || 'auto',
        prompt.category,
        scheduledFor,
        config.require_approval,
        options.priority || 5
      ]
    );
    
    // Update prompt usage
    await pool.query(
      `UPDATE strategy_prompts 
       SET usage_count = usage_count + 1, last_used_at = NOW()
       WHERE id = $1`,
      [prompt.id]
    );
    
    // Log history
    await pool.query(
      `INSERT INTO autopilot_history 
         (strategy_id, queue_id, action, actor, prompt_used, category, success)
       VALUES ($1, $2, 'generated', 'system', $3, $4, true)`,
      [strategyId, queueResult.rows[0].id, prompt.id, prompt.category]
    );
    
    console.log(`✅ Auto-generated content for strategy ${strategyId}, scheduled for:`, scheduledFor);
    
    return queueResult.rows[0];
  } catch (error) {
    console.error('Error generating and queuing content:', error);
    
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
    
    // Count current queue items
    const countResult = await pool.query(
      `SELECT COUNT(*) as count 
       FROM strategy_queue 
       WHERE strategy_id = $1 
         AND status IN ('pending', 'approved')`,
      [strategyId]
    );
    
    const currentCount = parseInt(countResult.rows[0].count);
    const targetCount = config.max_queue_size || 10;
    const needToGenerate = Math.max(0, targetCount - currentCount);
    
    const generated = [];
    
    for (let i = 0; i < needToGenerate; i++) {
      try {
        const queued = await generateAndQueueContent(strategyId);
        generated.push(queued);
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
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
      SELECT sq.*, sp.category as prompt_category, sp.prompt_text
      FROM strategy_queue sq
      LEFT JOIN strategy_prompts sp ON sq.prompt_id = sp.id
      WHERE sq.strategy_id = $1
    `;
    
    const params = [strategyId];
    let paramCount = 2;
    
    if (filters.status) {
      query += ` AND sq.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    query += ` ORDER BY sq.priority DESC, sq.scheduled_for ASC`;
    
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
      `UPDATE strategy_queue 
       SET status = 'approved', 
           approved_by = $1, 
           approved_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [userId, queueId]
    );
    
    if (result.rows.length > 0) {
      await pool.query(
        `INSERT INTO autopilot_history 
           (strategy_id, queue_id, action, actor, success)
         VALUES ($1, $2, 'approved', $3, true)`,
        [result.rows[0].strategy_id, queueId, userId]
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
      `UPDATE strategy_queue 
       SET status = 'rejected', 
           rejected_at = NOW(),
           rejection_reason = $1
       WHERE id = $2
       RETURNING *`,
      [reason, queueId]
    );
    
    if (result.rows.length > 0) {
      await pool.query(
        `INSERT INTO autopilot_history 
           (strategy_id, queue_id, action, actor, success, error_message)
         VALUES ($1, $2, 'rejected', $3, true, $4)`,
        [result.rows[0].strategy_id, queueId, userId, reason]
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
      `UPDATE strategy_queue 
       SET generated_content = $1
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

export default {
  getAutopilotConfig,
  updateAutopilotConfig,
  generateContentFromPrompt,
  getNextOptimalPostingTime,
  selectNextPrompt,
  generateAndQueueContent,
  fillQueue,
  getQueue,
  approveQueuedContent,
  rejectQueuedContent,
  editQueuedContent
};
