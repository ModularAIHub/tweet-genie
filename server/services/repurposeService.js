// Phase 6 — Repurpose Service
// Converts high-performing tweets into:
//   1. LinkedIn post variation
//   2. Thread expansion
//   3. Three alternative angle variations
// Output goes to content_review_queue for approval.
import pool from '../config/database.js';
import axios from 'axios';

const GEMINI_MODEL = 'gemini-3-flash-preview';
const REPURPOSE_MAX_TOKENS = 4096;
const REPURPOSE_TEMPERATURE = 0.7;

class RepurposeService {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
  }

  /**
   * Repurpose a tweet into multiple formats/variations.
   * @param {string} userId - The user requesting repurpose
   * @param {string} tweetId - Internal DB tweet ID (UUID)
   * @param {Object} options - { formats: ['linkedin', 'thread', 'alternatives'] }
   * @returns {Object} { items: [...content_review_queue items], count }
   */
  async repurposeTweet(userId, tweetId, options = {}) {
    // Fetch the original tweet
    const { rows: [tweet] } = await pool.query(
      `SELECT t.*, us.niche, us.target_audience, us.tone_style, us.content_goals, us.id as strategy_id
       FROM tweets t
       LEFT JOIN user_strategies us ON t.strategy_id = us.id
       WHERE t.id = $1 AND t.user_id = $2`,
      [tweetId, userId]
    );

    if (!tweet) {
      throw new Error('Tweet not found');
    }

    const formats = options.formats || ['linkedin', 'thread', 'alternatives'];
    const niche = tweet.niche || 'general';
    const audience = tweet.target_audience || 'professionals';
    const tone = tweet.tone_style || 'professional';
    const content = tweet.content || '';
    const engagement = {
      likes: tweet.likes || 0,
      retweets: tweet.retweets || 0,
      replies: tweet.replies || 0,
      impressions: tweet.impressions || 0,
    };

    const prompt = this.buildRepurposePrompt(content, niche, audience, tone, engagement, formats);

    const response = await this.callGemini(prompt);
    const parsed = this.parseJSON(response);

    if (!parsed) {
      throw new Error('Failed to parse repurpose response from AI');
    }

    // Insert repurposed content into content_review_queue
    const items = [];

    // LinkedIn post
    if (parsed.linkedin && formats.includes('linkedin')) {
      items.push({
        content: parsed.linkedin.content,
        reason: `Repurposed from tweet: "${content.slice(0, 60)}..." → LinkedIn post`,
        source: 'repurpose_linkedin',
        category: 'repurpose',
      });
    }

    // Thread expansion
    if (parsed.thread && formats.includes('thread')) {
      const threadContent = Array.isArray(parsed.thread.tweets)
        ? parsed.thread.tweets.map((t, i) => `${i + 1}/ ${t}`).join('\n\n')
        : parsed.thread.content || '';
      items.push({
        content: threadContent,
        reason: `Repurposed from tweet: "${content.slice(0, 60)}..." → Thread expansion (${parsed.thread.tweets?.length || 0} parts)`,
        source: 'repurpose_thread',
        category: 'repurpose',
      });
    }

    // Alternative angles
    if (parsed.alternatives && formats.includes('alternatives')) {
      const alts = Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
      for (let i = 0; i < alts.length; i++) {
        items.push({
          content: alts[i].content || alts[i],
          reason: `Repurposed from tweet: "${content.slice(0, 60)}..." → Alternative angle ${i + 1}: ${alts[i].angle || ''}`,
          source: 'repurpose_alternative',
          category: 'repurpose',
        });
      }
    }

    if (items.length === 0) {
      throw new Error('AI did not generate any repurposed content');
    }

    // Bulk insert into content_review_queue
    const insertValues = [];
    const insertParams = [];
    let paramIdx = 1;

    for (const item of items) {
      insertValues.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      insertParams.push(
        userId,
        tweet.strategy_id || null,
        item.content,
        item.reason,
        item.source,
        item.category,
      );
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO content_review_queue 
         (user_id, strategy_id, content, reason, source, category)
       VALUES ${insertValues.join(', ')}
       RETURNING *`,
      insertParams
    );

    console.log(`[Repurpose] Created ${inserted.length} repurposed items from tweet=${tweetId}`);

    return { count: inserted.length, items: inserted, original_tweet_id: tweetId };
  }

  buildRepurposePrompt(content, niche, audience, tone, engagement, formats) {
    const engSummary = `${engagement.likes} likes, ${engagement.retweets} RTs, ${engagement.replies} replies, ${engagement.impressions} impressions`;

    const formatInstructions = [];

    if (formats.includes('linkedin')) {
      formatInstructions.push(`"linkedin": {
      "content": "A LinkedIn post version (200-500 words). Professional tone, include a hook, story/insight, and a CTA. Add line breaks for readability. Do NOT use hashtags excessively — max 3 relevant ones at the end."
    }`);
    }

    if (formats.includes('thread')) {
      formatInstructions.push(`"thread": {
      "tweets": ["An array of 4-7 tweet strings that expand the original into a thread. First tweet hooks; final tweet wraps up with a CTA or summary. Each tweet max 280 chars."]
    }`);
    }

    if (formats.includes('alternatives')) {
      formatInstructions.push(`"alternatives": [
      { "angle": "Name of the angle", "content": "A complete tweet taking a different approach to the same idea. Max 280 chars." },
      { "angle": "Name of the angle", "content": "..." },
      { "angle": "Name of the angle", "content": "..." }
    ]`);
    }

    return `You are a content repurposing expert for the ${niche} niche.

ORIGINAL TWEET (performed well with ${engSummary}):
"${content}"

AUDIENCE: ${audience}
TONE: ${tone}

TASK: Repurpose this high-performing tweet into the following formats. Preserve the core message and insight but adapt the format, length, and angle appropriately.

Return ONLY valid JSON with these keys:
{
  ${formatInstructions.join(',\n  ')}
}

RULES:
1. LinkedIn post should be substantially different from a tweet — longer, more professional, with a narrative structure.
2. Thread should unpack the core idea with depth — don't just pad the original.
3. Alternative angles should each take a genuinely different approach (e.g., contrarian view, question format, data-driven, personal story).
4. All content must be ready to post — no placeholders.
5. Keep the ${tone} tone throughout.`;
  }

  async callGemini(prompt) {
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${this.googleApiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: REPURPOSE_TEMPERATURE,
          topP: 1,
          maxOutputTokens: REPURPOSE_MAX_TOKENS,
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

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response from Gemini');
    return text;
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
      return null;
    }
  }
}

export const repurposeService = new RepurposeService();
