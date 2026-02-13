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

  // Create new strategy with initial data
  async createStrategy(userId, teamId = null, data = {}) {
    const { niche, target_audience, posting_frequency, content_goals, topics, status = 'draft' } = data;

    const { rows } = await pool.query(
      `INSERT INTO user_strategies (user_id, team_id, niche, target_audience, posting_frequency, content_goals, topics, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, teamId, niche, target_audience, posting_frequency, content_goals, topics, status]
    );

    return rows[0];
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

    // Helper: Detect gibberish/nonsense input
    const isGibberish = (text) => {
      const trimmed = text.trim().toLowerCase();
      
      // Too short (less than 2 characters) - but allow single valid words like "yes"
      if (trimmed.length < 2) return true;
      
      // Only special characters or numbers
      if (/^[^a-z]+$/i.test(trimmed)) return true;
      
      // Random keyboard mashing (repeating patterns)
      if (/(.)\1{4,}/.test(trimmed)) return true; // Same char 5+ times like "aaaaa"
      if (/(asdf|qwer|zxcv|hjkl|jkjk){2,}/i.test(trimmed)) return true; // Keyboard patterns
      
      // Very low vowel ratio (gibberish often lacks vowels)
      const vowels = (trimmed.match(/[aeiou]/gi) || []).length;
      const consonants = (trimmed.match(/[bcdfghjklmnpqrstvwxyz]/gi) || []).length;
      if (consonants > 0 && vowels / consonants < 0.15) return true;
      
      return false;
    };

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
        question: "Hey! 👋 I'm your Strategy Builder AI.\n\nI'll help you create a personalized Twitter content strategy in just **7 quick steps** - it takes about 3 minutes.\n\n**Let's start with the foundation - what's your niche or industry?**\n\nBe specific! Instead of \"tech\", say \"AI tools\" or \"SaaS for developers\".\n\nChoose from popular niches or type your own:",
        field: 'niche',
        quickReplies: ['💼 SaaS & B2B', '🤖 AI & Tech', '💪 Health & Fitness', '📈 Marketing & Growth', '🛍️ E-commerce', '✍️ Content Creation', '💰 Finance & Investing', '⚡ Productivity'],
        placeholder: 'e.g., B2B SaaS, AI tools, fitness coaching, anime & manga...'
      },
      {
        key: 'audience',
        question: "Perfect! Now let's define your **ideal follower**.\n\n**Who exactly are you trying to reach?**\n\nThink about:\n• Their role/title (e.g., startup founders, anime fans, fitness beginners)\n• Their main problem or goal\n• What keeps them up at night\n\nThe more specific, the better I can help!",
        field: 'target_audience',
        placeholder: 'e.g., First-time founders struggling to scale, anime fans looking for hidden gems, busy professionals wanting to get fit'
      },
      {
        key: 'goals',
        question: "Excellent! Now, **what do you want to achieve with Twitter?**\n\nYou can select **multiple goals** - I'll help you balance them in your content strategy:",
        field: 'content_goals',
        isArray: true,
        quickReplies: [
          '🎯 Build authority & credibility',
          '📈 Grow followers organically',
          '💬 Drive engagement & discussions',
          '💰 Generate quality leads',
          '🎓 Educate & provide value',
          '🤝 Build a community',
          '🚀 Promote products/services'
        ],
        placeholder: 'Select options above or type your own goals (comma-separated)'
      },
      {
        key: 'frequency',
        question: "Great goals! Now let's set a **realistic posting schedule**.\n\n**How often can you commit to posting?**\n\n⚡ Pro tip: Consistency beats intensity!\n\nIt's better to post **3x/week reliably** than 10x/week for 2 weeks and then burn out.\n\nWhat works for your schedule?",
        field: 'posting_frequency',
        quickReplies: [
          '📅 Daily (7x/week)',
          '🔥 5x per week',
          '✅ 3-4x per week',
          '📌 2x per week',
          '📍 Once a week'
        ],
        placeholder: 'Choose above or specify your own frequency'
      },
      {
        key: 'tone',
        question: "Nice! Now let's define **your unique voice**.\n\n**What tone(s) feel most authentic to you?**\n\nYou can **select multiple tones** - many successful creators blend different styles!\n\nYour voice is what makes you memorable:",
        field: 'tone_style',
        isArray: true,
        quickReplies: [
          '🎩 Professional & authoritative',
          '😊 Casual & conversational',
          '😄 Humorous & entertaining',
          '📚 Educational & insightful',
          '💡 Inspirational & motivating',
          '🔥 Bold & opinionated',
          '🤔 Thoughtful & analytical'
        ],
        placeholder: 'Select options above or describe your preferred style(s)'
      },
      {
        key: 'topics',
        question: "Almost done! Let's nail down your **core content pillars**.\n\n**What 3-5 topics will you consistently post about?**\n\nThese should be areas where you have:\n✅ Knowledge or expertise\n✅ Genuine interest\n✅ Value to share\n\nI'll suggest some based on your niche, or you can tell me yours:",
        field: 'topics',
        isArray: true,
        placeholder: 'e.g., Product launches, Growth tactics, Team building, Fundraising (or type "use suggestions")'
      },
      {
        key: 'summary',
        question: "Perfect! 🎉\n\nYou've completed your strategy setup. Here's your personalized Twitter content strategy:",
        field: null,
        quickReplies: null
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
    } else if (currentStep <= steps.length - 1) {
      // Update strategy with user's answer (steps 1-6)
      const currentStepData = steps[currentStep - 1];
      if (currentStepData.field) {
        const updateField = currentStepData.field;
        let value = userMessage.trim();
        
        // Validate input - reject gibberish/nonsense
        const isAcceptingSuggestions = value.toLowerCase().match(/^(use these?|accept|ok|yes|looks good|perfect)$/i);
        const wantsSuggestions = value.toLowerCase().match(/(suggest|you.*tell|give.*suggest|recommend|help.*topic|what.*topic)/i) && !isAcceptingSuggestions;
        const isRequestingHelp = wantsSuggestions || isAcceptingSuggestions;
        
        if (!isRequestingHelp && isGibberish(value)) {
          const examplesByStep = {
            'niche': 'e.g., "Anime reviews", "SaaS marketing", "Fitness coaching"',
            'target_audience': 'e.g., "Anime fans aged 18-25 who watch seasonal shows", "SaaS founders building their first product"',
            'content_goals': 'e.g., "Grow followers organically", "Drive engagement", "Build community"',
            'posting_frequency': 'e.g., "3 times per week", "Daily", "5 times per week"',
            'tone_style': 'e.g., "Professional & authoritative", "Friendly & conversational", "Humorous"',
            'topics': 'e.g., "Anime reviews, Character analysis, Hidden gems, Seasonal rankings"'
          };
          
          const errorResponse = `I didn't quite catch that! 🤔\n\nPlease provide a clear, meaningful answer for this step.\n\n${examplesByStep[currentStepData.key] || 'Example: Provide specific details relevant to the question.'}`;
          
          await this.addChatMessage(strategyId, 'assistant', errorResponse);
          return {
            message: errorResponse,
            nextStep: currentStep,
            isComplete: false,
            quickReplies: currentStepData.quickReplies || null,
            placeholder: currentStepData.placeholder || 'Type your response...',
            strategy: null
          };
        }
        
        // Special handling for accepting suggested topics  
        if (currentStepData.key === 'topics' && isAcceptingSuggestions) {
          // Extract topics from the last AI message
          const { rows: messageRows } = await pool.query(
            `SELECT message FROM strategy_chat_history 
             WHERE strategy_id = $1 AND role = 'assistant' 
             ORDER BY created_at DESC LIMIT 1`,
            [strategyId]
          );
          
          if (messageRows.length > 0) {
            const lastMessage = messageRows[0].message;
            // Extract numbered list from message (1. Topic, 2. Topic, etc.)
            const topicMatches = lastMessage.match(/^\d+\.\s*(.+)$/gm);
            if (topicMatches && topicMatches.length > 0) {
              value = topicMatches.map(line => line.replace(/^\d+\.\s*/, '').trim());
              console.log('📝 User accepted suggested topics:', value);
            }
          }
        }
        
        // Special handling for requesting new topic suggestions
        if (currentStepData.key === 'topics' && wantsSuggestions) {
          const { rows: strategyRows } = await pool.query(
            `SELECT niche, target_audience, content_goals FROM user_strategies WHERE id = $1`,
            [strategyId]
          );
          const currentStrategy = strategyRows[0];
          
          if (currentStrategy.niche) {
            try {
              const topicPrompt = `Based on this Twitter strategy:
- Niche: ${currentStrategy.niche}
- Audience: ${currentStrategy.target_audience || 'general audience'}
- Goals: ${(currentStrategy.content_goals || []).join(', ')}

Suggest 5-7 specific, actionable content topics for this niche. Make them concrete and relevant.
Format: Just list topics separated by commas, no formatting.`;

              console.log('User requested topic suggestions for:', currentStrategy.niche);
              const result = await aiService.generateStrategyContent(topicPrompt, 150);
              console.log('Generated topics result:', result);
              
              // Extract content from result object  
              const topicText = typeof result === 'string' ? result : result.content;
              // Remove any preamble text before the actual topics
              const cleanedText = topicText.replace(/^.*?:\s*\n+/i, '').trim();
              value = cleanedText.split(',').map(t => t.trim().replace(/^\d+\.\s*/, '')).filter(Boolean).slice(0, 7);
              console.log('Generated topic suggestions:', value);
              
              if (!value || value.length === 0) {
                throw new Error('No topics generated');
              }
            } catch (error) {
              console.error('Failed to generate topics:', error, error.stack);
              // Return error message to user instead of saving empty array
              const errorResponse = `I had trouble generating suggestions. Let me try again, or you can tell me your 3-5 core topics directly (comma-separated).\\n\\nFor example: \\"Anime reviews, Character analysis, Hidden gems, Seasonal rankings, Community discussions\\"`;
              await this.addChatMessage(strategyId, 'assistant', errorResponse);
              return {
                strategy,
                aiResponse: errorResponse,
                currentStep,
                isComplete: false
              };
            }
          }
        } else if (currentStepData.isArray && Array.isArray(value) === false) {
          // Parse array values
          value = userMessage.split(',').map(s => s.trim()).filter(Boolean);
        }

        // Validate topics array is not empty
        if (currentStepData.key === 'topics' && currentStepData.isArray && (!value || value.length === 0)) {
          const retryResponse = `Please provide at least 3 topics (comma-separated), or say "suggest topics" and I'll generate some for you based on your niche!`;
          await this.addChatMessage(strategyId, 'assistant', retryResponse);
          return {
            strategy,
            aiResponse: retryResponse,
            currentStep,
            isComplete: false
          };
        }

        const updateQuery = currentStepData.isArray
          ? `UPDATE user_strategies SET ${updateField} = $1 WHERE id = $2`
          : `UPDATE user_strategies SET ${updateField} = $1 WHERE id = $2`;
        
        await pool.query(updateQuery, [value, strategyId]);
      }

      // Ask next question
      if (currentStep < steps.length - 1) {
        aiResponse = steps[currentStep].question;
        
        // For topics step, ALWAYS generate personalized suggestions based on niche
        if (steps[currentStep].key === 'topics') {
          const { rows: strategyRows } = await pool.query(
            `SELECT niche, target_audience, content_goals FROM user_strategies WHERE id = $1`,
            [strategyId]
          );
          const currentStrategy = strategyRows[0];
          
          if (currentStrategy.niche) {
            try {
              console.log(`⏳ [Step 6] Generating topic suggestions for niche: ${currentStrategy.niche}...`);
              const startTime = Date.now();
              
              const topicPrompt = `Based on this Twitter strategy:
- Niche: ${currentStrategy.niche}
- Audience: ${currentStrategy.target_audience || 'general audience'}
- Goals: ${(currentStrategy.content_goals || []).join(', ')}

Suggest 5-7 specific, actionable content topics for this niche. Make them concrete and relevant.
Format: Just list topics separated by commas, no formatting.`;

              const result = await aiService.generateStrategyContent(topicPrompt, 150);
              const elapsed = Date.now() - startTime;
              console.log(`✅ [Step 6] Topics generated in ${elapsed}ms with ${result.provider}`);
              
              // Extract content from result object
              const topicText = typeof result === 'string' ? result : result.content;
              // Remove any preamble text before the actual topics
              const cleanedText = topicText.replace(/^.*?:\s*\n+/i, '').trim();
              const topicsList = cleanedText.split(',').map(t => t.trim().replace(/^\d+\.\s*/, '')).filter(Boolean).slice(0, 7);
              
              if (topicsList.length > 0) {
                aiResponse = `Almost done! Based on your **${currentStrategy.niche}** niche and your goals, here are content topics I recommend:\n\n` +
                  topicsList.map((t, i) => `${i + 1}. ${t}`).join('\n') + '\n\n' +
                  `**Type \"use these\" to accept, or tell me your own 3-5 topics** (comma-separated)`;
              }
            } catch (error) {
              console.error('❌ [Step 6] Failed to generate topic suggestions:', error.message);
              // Fallback to original question
            }
          }
        }
        
        nextStep = currentStep + 1;
      } else {
        // Generate summary
        const { rows: strategyRows } = await pool.query(
          `SELECT * FROM user_strategies WHERE id = $1`,
          [strategyId]
        );
        const updatedStrategy = strategyRows[0];

        aiResponse = `Perfect! 🎉 You've completed your Twitter Strategy!\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🎯 **Niche:** ${updatedStrategy.niche}\n\n` +
          `👥 **Target Audience:** ${updatedStrategy.target_audience}\n\n` +
          `📊 **Goals:**\n${(updatedStrategy.content_goals || []).map(g => `  • ${g}`).join('\\n')}\n\n` +
          `📅 **Posting Schedule:** ${updatedStrategy.posting_frequency}\n\n` +
          `🗣️ **Voice & Tone:** ${updatedStrategy.tone_style}\n\n` +
          `📝 **Core Topics:**\n${(updatedStrategy.topics || []).map(t => `  • ${t}`).join('\\n')}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🚀 **Next Step:** Click the "Prompts" tab above to generate your personalized prompt library!\n\n` +
          `I'll create 30+ ready-to-use tweet prompts tailored specifically to your strategy. Each prompt will help you create engaging content that resonates with your audience. ✨`;
        
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

    // Get quick replies and placeholder for the question we just asked
    // If nextStep is 1, we just asked steps[0], if nextStep is 2, we just asked steps[1], etc.
    const questionStepIndex = nextStep > 0 ? nextStep - 1 : 0;
    const currentStepConfig = steps[questionStepIndex];
    const quickReplies = currentStepConfig?.quickReplies || null;
    const placeholder = currentStepConfig?.placeholder || 'Type your response...';

    const result = {
      message: aiResponse,
      nextStep,
      isComplete,
      quickReplies,
      placeholder,
      strategy: isComplete ? await this.getStrategy(strategyId) : null
    };

    console.log('📤 Strategy chat response:', {
      isComplete: result.isComplete,
      nextStep: result.nextStep,
      hasStrategy: !!result.strategy
    });

    return result;
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
