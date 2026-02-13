import pool from '../config/database.js';
import { aiService } from './aiService.js';

class StrategyService {
  // Get or create active strategy for user
  async getOrCreateStrategy(userId, teamId = null) {
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies 
       WHERE user_id = $1 AND (team_id = $2 OR (team_id IS NULL AND $2 IS NULL))
       AND status IN ('draft', 'active')
       ORDER BY created_at DESC LIMIT 1`,
      [userId, teamId]
    );

    if (rows.length > 0) {
      return rows[0];
    }

    // Create new draft strategy
    const { rows: newRows } = await pool.query(
      `INSERT INTO user_strategies (user_id, team_id, status)
       VALUES ($1, $2, 'draft')
       RETURNING *`,
      [userId, teamId]
    );

    return newRows[0];
  }

  // Get chat history for strategy
  async getChatHistory(strategyId, limit = 50) {
    const { rows } = await pool.query(
      `SELECT * FROM strategy_chat_history
       WHERE strategy_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [strategyId, limit]
    );
    return rows;
  }

  // Add message to chat history
  async addChatMessage(strategyId, role, message, metadata = {}) {
    const { rows } = await pool.query(
      `INSERT INTO strategy_chat_history (strategy_id, role, message, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [strategyId, role, message, metadata]
    );
    return rows[0];
  }

  // Process chat and generate AI response
  async processChatMessage(strategyId, userId, userMessage, currentStep = 0) {
    // Save user message
    await this.addChatMessage(strategyId, 'user', userMessage);

    // Get strategy
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies WHERE id = $1`,
      [strategyId]
    );
    const strategy = rows[0];

    // Define conversation steps
    const steps = [
      {
        key: 'welcome',
        question: "Hey! 👋 I'm excited to help you build a winning Twitter strategy. Let's start with the basics - **what's your niche or industry?** (e.g., SaaS, AI, Fitness, Marketing)",
        field: 'niche',
        examples: ['SaaS', 'AI & Technology', 'Fitness & Health', 'Digital Marketing', 'E-commerce', 'Creator Economy']
      },
      {
        key: 'audience',
        question: "Perfect! Now, **who's your target audience?** Who are you trying to reach and help? (e.g., startup founders, developers, fitness enthusiasts)",
        field: 'target_audience'
      },
      {
        key: 'goals',
        question: "Great! **What are your main content goals?** You can select multiple:\n\n🎯 Build authority & thought leadership\n📈 Grow followers & reach\n💬 Drive engagement & conversations\n💰 Generate leads & sales\n🎓 Educate & provide value\n🤝 Build community\n\nJust tell me which ones resonate with you!",
        field: 'content_goals',
        isArray: true
      },
      {
        key: 'frequency',
        question: "Awesome! **How often do you want to post?** Consistency is key, but let's find what works for you:\n\n• Daily (7 tweets/week)\n• 5x per week\n• 3x per week\n• Custom frequency",
        field: 'posting_frequency'
      },
      {
        key: 'tone',
        question: "Nice! Now for the fun part - **what's your preferred tone and style?**\n\n🎩 Professional & authoritative\n😊 Casual & friendly\n😄 Humorous & entertaining\n📚 Educational & informative\n💡 Inspirational & motivational\n🔥 Bold & controversial\n\nWhat feels most authentic to you?",
        field: 'tone_style'
      },
      {
        key: 'topics',
        question: "Almost there! **What specific topics do you want to cover?** Give me 3-5 topics you're passionate about in your niche.",
        field: 'topics',
        isArray: true
      },
      {
        key: 'summary',
        question: "Perfect! 🎉 Let me summarize your strategy:",
        field: null
      }
    ];

    // Determine next step
    let nextStep = currentStep;
    let aiResponse = '';
    let isComplete = false;

    if (currentStep === 0) {
      // Welcome message
      aiResponse = steps[0].question;
      nextStep = 1;
    } else if (currentStep <= steps.length - 2) {
      // Update strategy with user's answer
      const currentStepData = steps[currentStep - 1];
      if (currentStepData.field) {
        const updateField = currentStepData.field;
        let value = userMessage.trim();
        
        if (currentStepData.isArray) {
          // Parse array values
          value = userMessage.split(',').map(s => s.trim()).filter(Boolean);
        }

        const updateQuery = currentStepData.isArray
          ? `UPDATE user_strategies SET ${updateField} = $1 WHERE id = $2`
          : `UPDATE user_strategies SET ${updateField} = $1 WHERE id = $2`;
        
        await pool.query(updateQuery, [value, strategyId]);
      }

      // Ask next question
      if (currentStep < steps.length - 1) {
        aiResponse = steps[currentStep].question;
        nextStep = currentStep + 1;
      } else {
        // Generate summary
        const { rows: strategyRows } = await pool.query(
          `SELECT * FROM user_strategies WHERE id = $1`,
          [strategyId]
        );
        const updatedStrategy = strategyRows[0];

        aiResponse = `Perfect! 🎉 Here's your personalized Twitter strategy:\n\n` +
          `**Niche:** ${updatedStrategy.niche}\n` +
          `**Target Audience:** ${updatedStrategy.target_audience}\n` +
          `**Goals:** ${(updatedStrategy.content_goals || []).join(', ')}\n` +
          `**Posting Frequency:** ${updatedStrategy.posting_frequency}\n` +
          `**Tone & Style:** ${updatedStrategy.tone_style}\n` +
          `**Topics:** ${(updatedStrategy.topics || []).join(', ')}\n\n` +
          `Ready to generate your custom prompt library? I'll create 30+ prompts tailored to your strategy! 🚀`;
        
        // Mark strategy as active
        await pool.query(
          `UPDATE user_strategies SET status = 'active' WHERE id = $1`,
          [strategyId]
        );
        
        isComplete = true;
        nextStep = -1; // Signals completion
      }
    }

    // Save AI response
    await this.addChatMessage(strategyId, 'assistant', aiResponse, { step: nextStep });

    return {
      message: aiResponse,
      nextStep,
      isComplete,
      strategy: isComplete ? await this.getStrategy(strategyId) : null
    };
  }

  // Generate prompts for strategy
  async generatePrompts(strategyId, userId) {
    const strategy = await this.getStrategy(strategyId);
    
    if (!strategy) {
      throw new Error('Strategy not found');
    }

    // Build AI prompt for generating content prompts
    const systemPrompt = `You are a Twitter content strategy expert. Generate 30 diverse, high-quality tweet prompts for a user with the following strategy:

Niche: ${strategy.niche}
Target Audience: ${strategy.target_audience}
Goals: ${(strategy.content_goals || []).join(', ')}
Tone: ${strategy.tone_style}
Topics: ${(strategy.topics || []).join(', ')}

Generate prompts in these categories (distribute evenly):
- Educational (teach something valuable)
- Engagement (questions, polls, discussions)
- Storytelling (personal stories, case studies)
- Tips & Tricks (actionable advice)
- Promotional (soft sell, value-first)
- Inspirational (motivation, mindset)

Format each prompt as:
CATEGORY: [category]
PROMPT: [the prompt text]
---

Make prompts specific, actionable, and aligned with their goals. Include variables in {curly braces} where appropriate.`;

    try {
      // Use strategy-specific generation (Gemini first for better structured output)
      const result = await aiService.generateStrategyContent(systemPrompt, 'professional', null, userId);
      const content = result.content || result;

      // Parse prompts from AI response
      const promptBlocks = content.split('---').filter(b => b.trim());
      const prompts = [];

      for (const block of promptBlocks) {
        const categoryMatch = block.match(/CATEGORY:\s*(.+)/i);
        const promptMatch = block.match(/PROMPT:\s*(.+)/is);

        if (categoryMatch && promptMatch) {
          const category = categoryMatch[1].trim().toLowerCase();
          const promptText = promptMatch[1].trim();

          // Extract variables
          const variables = {};
          const varMatches = promptText.match(/\{([^}]+)\}/g);
          if (varMatches) {
            varMatches.forEach(v => {
              const key = v.replace(/[{}]/g, '');
              variables[key] = '';
            });
          }

          prompts.push({
            category,
            promptText,
            variables
          });
        }
      }

      // Insert prompts into database
      const insertedPrompts = [];
      for (const prompt of prompts) {
        const { rows } = await pool.query(
          `INSERT INTO strategy_prompts (strategy_id, category, prompt_text, variables)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [strategyId, prompt.category, prompt.promptText, prompt.variables]
        );
        insertedPrompts.push(rows[0]);
      }

      return {
        success: true,
        count: insertedPrompts.length,
        prompts: insertedPrompts
      };
    } catch (error) {
      console.error('Error generating prompts:', error);
      throw error;
    }
  }

  // Get strategy by ID
  async getStrategy(strategyId) {
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies WHERE id = $1`,
      [strategyId]
    );
    return rows[0] || null;
  }

  // Get all strategies for user
  async getUserStrategies(userId, teamId = null) {
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies 
       WHERE user_id = $1 AND (team_id = $2 OR (team_id IS NULL AND $2 IS NULL))
       ORDER BY created_at DESC`,
      [userId, teamId]
    );
    return rows;
  }

  // Get prompts for strategy
  async getPrompts(strategyId, filters = {}) {
    let query = `SELECT * FROM strategy_prompts WHERE strategy_id = $1`;
    const params = [strategyId];
    
    if (filters.category) {
      params.push(filters.category);
      query += ` AND category = $${params.length}`;
    }
    
    if (filters.isFavorite) {
      query += ` AND is_favorite = true`;
    }
    
    query += ` ORDER BY created_at DESC`;
    
    if (filters.limit) {
      params.push(filters.limit);
      query += ` LIMIT $${params.length}`;
    }

    const { rows } = await pool.query(query, params);
    return rows;
  }

  // Update strategy
  async updateStrategy(strategyId, updates) {
    const allowedFields = ['niche', 'target_audience', 'content_goals', 'posting_frequency', 'tone_style', 'topics', 'status'];
    const fields = Object.keys(updates).filter(f => allowedFields.includes(f));
    
    if (fields.length === 0) {
      return null;
    }

    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [strategyId, ...fields.map(f => updates[f])];

    const { rows } = await pool.query(
      `UPDATE user_strategies SET ${setClause} WHERE id = $1 RETURNING *`,
      values
    );

    return rows[0];
  }

  // Toggle favorite prompt
  async toggleFavoritePrompt(promptId) {
    const { rows } = await pool.query(
      `UPDATE strategy_prompts 
       SET is_favorite = NOT is_favorite 
       WHERE id = $1 
       RETURNING *`,
      [promptId]
    );
    return rows[0];
  }

  // Delete strategy
  async deleteStrategy(strategyId, userId) {
    await pool.query(
      `DELETE FROM user_strategies WHERE id = $1 AND user_id = $2`,
      [strategyId, userId]
    );
  }
}

export const strategyService = new StrategyService();
export default strategyService;
