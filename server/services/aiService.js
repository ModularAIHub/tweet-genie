import OpenAI from 'openai';
import axios from 'axios';
import pool from '../config/database.js';

// Simple rate limiter - inline
const rateLimits = new Map();
function checkRateLimit(userId) {
  if (!userId) return { allowed: true };
  
  const key = userId;
  const now = Date.now();
  const limit = { maxRequests: 50, windowMs: 60 * 60 * 1000 }; // 50/hour
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, resetTime: now + limit.windowMs });
    return { allowed: true };
  }

  const userLimit = rateLimits.get(key);
  if (now >= userLimit.resetTime) {
    userLimit.count = 1;
    userLimit.resetTime = now + limit.windowMs;
    return { allowed: true };
  }
  
  if (userLimit.count >= limit.maxRequests) {
    const resetIn = Math.ceil((userLimit.resetTime - now) / 1000 / 60);
    return { allowed: false, error: `Rate limit exceeded. Try again in ${resetIn} minutes.` };
  }
  
  userLimit.count++;
  return { allowed: true };
}

const PLAN_TYPE_ALIASES = new Map([
  ['premium', 'pro'],
  ['business', 'pro'],
]);
const PLAN_CACHE_TTL_MS = Number(process.env.AI_PLAN_CACHE_TTL_MS || 30 * 1000);
const planTypeCache = new Map();

const normalizePlanType = (planType) => {
  const normalized = String(planType || 'free').trim().toLowerCase();
  return PLAN_TYPE_ALIASES.get(normalized) || normalized;
};

const getProviderPriority = ({ preference, planType }) => {
    if (preference === 'byok') {
      return ['perplexity', 'google', 'openai'];
    }

  const normalizedPlan = normalizePlanType(planType);
    if (normalizedPlan === 'pro' || normalizedPlan === 'enterprise') {
      return ['google', 'perplexity', 'openai'];
    }

  return ['google', 'perplexity', 'openai'];
};

async function resolvePlanType(userId, explicitPlanType = null) {
  if (explicitPlanType) {
    return normalizePlanType(explicitPlanType);
  }

  if (!userId) {
    return 'free';
  }

  const now = Date.now();
  const cached = planTypeCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.planType;
  }

  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(
         (
           SELECT t.plan_type
           FROM team_members tm
           JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id = $1
             AND tm.status = 'active'
           ORDER BY CASE
             WHEN t.plan_type = 'enterprise' THEN 3
             WHEN t.plan_type = 'pro' THEN 2
             WHEN t.plan_type = 'free' THEN 1
             ELSE 0
           END DESC
           LIMIT 1
         ),
         u.plan_type,
         'free'
       ) AS plan_type
       FROM users u
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );

    const resolved = normalizePlanType(rows[0]?.plan_type || 'free');
    planTypeCache.set(userId, {
      planType: resolved,
      expiresAt: now + PLAN_CACHE_TTL_MS,
    });
    return resolved;
  } catch (error) {
    console.warn(`[AI Routing] Failed to resolve plan for user ${userId}, defaulting to free:`, error.message);
    return 'free';
  }
}

// Helper to fetch user preference and keys from new-platform
async function getUserPreferenceAndKeys(userToken, maxRetries = 3) {
  const baseUrl = process.env.NEW_PLATFORM_API_URL || 'https://your-new-platform-domain/api';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const prefRes = await axios.get(`${baseUrl}/byok/preference`, {
        headers: { Authorization: `Bearer ${userToken}` },
        timeout: 5000
      });
      const preference = prefRes.data.api_key_preference;
      let userKeys = [];
      
      if (preference === 'byok') {
        const keysRes = await axios.get(`${baseUrl}/byok/keys`, {
          headers: { Authorization: `Bearer ${userToken}` },
          timeout: 5000
        });
        userKeys = keysRes.data.keys;
      }
      
      return { preference, userKeys };
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────
// Lower temperature = less variance = more reliable instruction following
// 0.62 is the sweet spot: creative enough to avoid repetition, consistent
// enough to follow instructions reliably. 0.7 causes too much drift.
const CONTENT_TEMPERATURE = 0.62;

// Higher token limit = no truncated/incomplete content
const CONTENT_MAX_TOKENS = 1024;

// Stable Gemini model for production
const GEMINI_MODEL = 'gemini-2.0-flash';
// ─────────────────────────────────────────────────────────────────────────────

class AIService {
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } else {
      console.warn('⚠️ OpenAI API key not configured');
      this.openai = null;
    }
    
    this.perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
  }

  validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Invalid prompt');
    }
    
    const trimmed = prompt.trim();
    
    if (trimmed.length < 5) throw new Error('Prompt too short');
    if (trimmed.length > 2000) throw new Error('Prompt too long (max 2000 characters)');
    
    const dangerousPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/gi,
      /disregard\s+(all\s+)?prior\s+instructions/gi,
      /system\s*:\s*you\s+are/gi,
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        throw new Error('Invalid prompt content detected');
      }
    }
    
    return trimmed;
  }

  async generateContent(prompt, style = 'casual', maxRetries = 3, userToken = null, userId = null, planType = null) {
    const sanitizedPrompt = this.validatePrompt(prompt);
    
    if (userId) {
      const rateCheck = checkRateLimit(userId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }
    }
    
    const threadCountMatch = sanitizedPrompt.match(/generate\s+(\d+)\s+threads?/i);
    const requestedCount = threadCountMatch ? parseInt(threadCountMatch[1]) : null;
    
    if (requestedCount && (requestedCount < 1 || requestedCount > 10)) {
      throw new Error('Thread count must be between 1 and 10');
    }

    let preference = 'platform';
    let userKeys = [];
    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
        console.log('[BYOK] Fetched keys for providers:', userKeys.map(k => k.provider).join(', '));
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys:', err.message);
      }
    }

    const resolvedPlanType = await resolvePlanType(userId, planType);
    const providerPriority = getProviderPriority({ preference, planType: resolvedPlanType });
    const providerCandidates = {};
    const keyType = preference === 'byok' ? 'BYOK' : 'platform';

    

    const perplexityKey =
      preference === 'byok'
        ? userKeys.find((k) => k.provider === 'perplexity')?.apiKey
        : this.perplexityApiKey;
    if (perplexityKey) {
      providerCandidates.perplexity = {
        name: 'perplexity',
        keyType,
        method: (p, s, c) => this.generateWithPerplexity(p, s, c, perplexityKey),
      };
    }

    const googleKey =
      preference === 'byok'
        ? userKeys.find((k) => k.provider === 'gemini')?.apiKey
        : this.googleApiKey;
    if (googleKey) {
      providerCandidates.google = {
        name: 'google',
        keyType,
        method: (p, s, c) => this.generateWithGoogle(p, s, c, googleKey),
      };
    }

    const openaiKey =
      preference === 'byok'
        ? userKeys.find((k) => k.provider === 'openai')?.apiKey
        : process.env.OPENAI_API_KEY;
    if (openaiKey) {
      providerCandidates.openai = {
        name: 'openai',
        keyType,
        method: (p, s, c) => this.generateWithOpenAI(p, s, c, openaiKey),
      };
    }

    const providers = providerPriority
      .map((providerName) => providerCandidates[providerName])
      .filter(Boolean);

    if (providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    console.log(
      `[AI Routing] plan=${resolvedPlanType} preference=${preference} order=${providers
        .map((p) => p.name)
        .join(' > ')}`
    );

    let lastError = null;
    const authFailures = [];

    for (const provider of providers) {
      let attempts = 0;
      const maxProviderAttempts = Math.max(1, maxRetries);
      while (attempts < maxProviderAttempts) {
        try {
          if (userId) {
            console.log(`[AI Key Usage] userId=${userId} provider=${provider.name} keyType=${provider.keyType}`);
          }
          console.log(`Attempting content generation with ${provider.name} (attempt ${attempts + 1}/${maxProviderAttempts})...`);
          const result = await provider.method(sanitizedPrompt, style, requestedCount);
          console.log(`✅ Content generated successfully with ${provider.name}`);

          const cleanedContent = this.cleanAIOutput(result);

          return {
            content: cleanedContent,
            provider: provider.name,
            keyType: provider.keyType,
            success: true
          };
        } catch (error) {
          attempts++;
          console.error(`❌ ${provider.name} generation failed (attempt ${attempts}):`, error.message);
          lastError = error;

          if (/unauthoriz|token expired|invalid key/i.test(error.message || '')) {
            authFailures.push(`${provider.name} (${provider.keyType}): ${error.message}`);
            break;
          }

          if (error.isQuota || error.retryAfter) {
            const waitSec =
              typeof error.retryAfter === 'number' && error.retryAfter > 0
                ? error.retryAfter
                : Math.min(5 * attempts, 30);
            if (attempts < maxProviderAttempts) {
              console.log(`${provider.name} suggests retry after ${waitSec}s — waiting...`);
              await new Promise(r => setTimeout(r, Math.ceil(waitSec * 1000)));
              continue;
            }
          }

          break;
        }
      }
    }

    if (authFailures.length > 0) {
      throw new Error(`Authorization failures for AI providers: ${authFailures.join(' ; ')}`);
    }

    throw new Error(`All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  

  // Strategy Builder specific generation with plan-aware provider routing.
  async generateStrategyContent(prompt, style = 'professional', userToken = null, userId = null, planType = null) {
    const sanitizedPrompt = this.validatePrompt(prompt);
    
    if (userId) {
      const rateCheck = checkRateLimit(userId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }
    }

    let preference = 'platform';
    let userKeys = [];
    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
        console.log('[BYOK] Fetched keys for providers:', userKeys.map(k => k.provider).join(', '));
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys:', err.message);
      }
    }

    const resolvedPlanType = await resolvePlanType(userId, planType);
    const providerPriority = getProviderPriority({ preference, planType: resolvedPlanType });
    const providerCandidates = {};
    const keyType = preference === 'byok' ? 'BYOK' : 'platform';

    

    const perplexityKey =
      preference === 'byok'
        ? userKeys.find((k) => k.provider === 'perplexity')?.apiKey
        : this.perplexityApiKey;
    if (perplexityKey) {
      providerCandidates.perplexity = {
        name: 'perplexity',
        keyType,
        method: (p, s, c) => this.generateWithPerplexity(p, s, c, perplexityKey),
      };
    }

    const googleKey =
      preference === 'byok'
        ? userKeys.find((k) => k.provider === 'gemini')?.apiKey
        : this.googleApiKey;
    if (googleKey) {
      providerCandidates.google = {
        name: 'google',
        keyType,
        method: (p, s, c) => this.generateWithGoogle(p, s, c, googleKey),
      };
    }

    const openaiKey =
      preference === 'byok'
        ? userKeys.find((k) => k.provider === 'openai')?.apiKey
        : process.env.OPENAI_API_KEY;
    if (openaiKey) {
      providerCandidates.openai = {
        name: 'openai',
        keyType,
        method: (p, s, c) => this.generateWithOpenAI(p, s, c, openaiKey),
      };
    }

    const providers = providerPriority
      .map((providerName) => providerCandidates[providerName])
      .filter(Boolean);

    if (providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    console.log(
      `[Strategy Builder Routing] plan=${resolvedPlanType} preference=${preference} order=${providers
        .map((p) => p.name)
        .join(' > ')}`
    );

    let lastError = null;
    const authFailures = [];

    for (const provider of providers) {
      let attempts = 0;
      const maxProviderAttempts = Math.max(1, 1); // keep strategy builder conservative
      while (attempts < maxProviderAttempts) {
        try {
          if (userId) {
            console.log(`[AI Key Usage - Strategy] userId=${userId} provider=${provider.name} keyType=${provider.keyType}`);
          }
          console.log(`[Strategy Builder] Attempting generation with ${provider.name} (attempt ${attempts + 1}/${maxProviderAttempts})...`);
          const result = await provider.method(sanitizedPrompt, style, null);
          console.log(`✅ [Strategy Builder] Content generated successfully with ${provider.name}`);

          const cleanedContent = this.cleanAIOutput(result);

          return {
            content: cleanedContent,
            provider: provider.name,
            keyType: provider.keyType,
            success: true
          };
        } catch (error) {
          attempts++;
          console.error(`❌ [Strategy Builder] ${provider.name} generation failed (attempt ${attempts}):`, error.message);
          lastError = error;

          if (/unauthoriz|token expired|invalid key/i.test(error.message || '')) {
            authFailures.push(`${provider.name} (${provider.keyType}): ${error.message}`);
            break;
          }

          if (error.isQuota || error.retryAfter) {
            const waitSec =
              typeof error.retryAfter === 'number' && error.retryAfter > 0
                ? error.retryAfter
                : 3;
            if (attempts < maxProviderAttempts) {
              console.log(`[Strategy Builder] ${provider.name} suggests retry after ${waitSec}s — waiting...`);
              await new Promise(r => setTimeout(r, Math.ceil(waitSec * 1000)));
              continue;
            }
          }

          break;
        }
      }
    }

    if (authFailures.length > 0) {
      throw new Error(`Authorization failures for AI providers: ${authFailures.join(' ; ')}`);
    }

    throw new Error(`All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithPerplexity(prompt, style, requestedCount = null, apiKey = null) {
    const keyToUse = apiKey || this.perplexityApiKey;
    if (!keyToUse) {
      throw new Error('Perplexity API key not configured');
    }

    const stylePrompts = {
      professional: 'Write in a professional, business-appropriate tone.',
      casual: 'Write in a casual, conversational tone.',
      witty: 'Write with humor and wit, be clever and engaging.',
      humorous: 'Write with humor and wit, be clever and engaging.',
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };

    let systemPrompt;
    
    if (requestedCount) {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

Generate EXACTLY ${requestedCount} tweets separated by "---"
Keep each tweet under 280 characters
Include 1-3 relevant hashtags at the end of each tweet
Use plain text (no HTML entities like &#x27;)
Write every tweet completely — do not cut off mid-sentence.

User request: ${prompt}`;
    } else {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

If user asks for "threads" without a number, generate 3-5 tweets separated by "---"
Keep under 280 characters per tweet
Include 1-3 relevant hashtags
Use plain text only
Write every piece of content completely — do not cut off mid-sentence.

User request: ${prompt}`;
    }

    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: 'sonar',
          messages: [
            { role: 'system', content: 'You are a creative Twitter content writer. Always complete every sentence fully.' },
            { role: 'user', content: systemPrompt }
          ],
          max_tokens: CONTENT_MAX_TOKENS,
          temperature: CONTENT_TEMPERATURE,
        },
        {
          headers: {
            'Authorization': `Bearer ${keyToUse}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No content generated by Perplexity');
      }

      return content;
    } catch (error) {
      if (error.response?.status === 400) {
        const errorData = error.response.data;
        throw new Error(`Perplexity API Error: ${errorData.error?.message || errorData.message || 'Bad Request'}`);
      }
      throw error;
    }
  }

  async generateWithGoogle(prompt, style, requestedCount = null, apiKey = null) {
    const keyToUse = apiKey || this.googleApiKey;
    if (!keyToUse) {
      throw new Error('Google AI API key not configured');
    }

    const stylePrompts = {
      professional: 'professional and business-appropriate',
      casual: 'casual and conversational',
      witty: 'witty, humorous, and clever',
      humorous: 'witty, humorous, and clever',
      inspirational: 'inspirational and motivational',
      informative: 'informative and educational'
    };

    let systemPrompt;
    
    if (requestedCount) {
      systemPrompt = `You are a Twitter content creator. Be ${stylePrompts[style] || 'casual and conversational'}.

Generate EXACTLY ${requestedCount} tweets separated by "---"
Keep under 280 characters per tweet
Include 1-3 relevant hashtags
Use plain text only
Write every tweet fully — never cut off mid-sentence.

User request: ${prompt}`;
    } else {
      systemPrompt = `You are a Twitter content creator. Be ${stylePrompts[style] || 'casual and conversational'}.

Generate tweet content based on the request
If "threads" requested, generate 3-5 tweets separated by "---"
Keep under 280 characters per tweet
Include 1-3 relevant hashtags
Write every piece of content completely — no unfinished sentences.

User request: ${prompt}`;
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyToUse}`,
        {
          contents: [{
            parts: [{ text: systemPrompt }]
          }],
          generationConfig: {
            temperature: CONTENT_TEMPERATURE,
            topK: 1,
            topP: 1,
            maxOutputTokens: CONTENT_MAX_TOKENS,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const content = response.data.candidates[0]?.content?.parts[0]?.text?.trim();
      if (!content) {
        throw new Error('No content generated by Google Gemini');
      }

      return content;
    } catch (error) {
      const gMsg = error.response?.data?.error?.message || error.message || 'Google API error';
      const normalized = new Error(`Google AI Error: ${gMsg}`);
      normalized.status = error.response?.status;

      if (/quota exceeded|exceeded your current quota|quota/i.test(gMsg)) {
        normalized.isQuota = true;
      }

      const retryMatch =
        gMsg.match(/Please retry in\s*([0-9]+(?:\.[0-9]+)?)s/i) ||
        gMsg.match(/retry after\s*([0-9]+)s/i);
      if (retryMatch) {
        normalized.retryAfter = parseFloat(retryMatch[1]);
      }

      const retryHeader = error.response?.headers?.['retry-after'];
      if (retryHeader) {
        const parsed = parseFloat(retryHeader);
        if (!isNaN(parsed)) normalized.retryAfter = parsed;
      }

      throw normalized;
    }
  }

  async generateWithOpenAI(prompt, style, requestedCount = null, apiKey = null) {
    const keyToUse = apiKey || process.env.OPENAI_API_KEY;
    if (!keyToUse) {
      throw new Error('OpenAI API key not configured');
    }

    let openaiClient = this.openai;
    if (apiKey && apiKey !== process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      openaiClient = new OpenAI({ apiKey });
    }

    const stylePrompts = {
      professional: 'Write in a professional, business-appropriate tone.',
      casual: 'Write in a casual, conversational tone.',
      witty: 'Write with humor and wit, be clever and engaging.',
      humorous: 'Write with humor and wit, be clever and engaging.',
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };

    let systemPrompt;
    
    if (requestedCount) {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

Generate EXACTLY ${requestedCount} tweets separated by "---"
Keep under 280 characters per tweet
Include 1-3 relevant hashtags
Use plain text only
Write every tweet fully — never trail off or cut mid-sentence.

User request: ${prompt}`;
    } else {
      systemPrompt = `You are a Twitter content creator. ${stylePrompts[style] || stylePrompts.casual}

Generate tweet content based on request
If "threads" requested, generate 3-5 tweets separated by "---"
Keep under 280 characters per tweet
Include 1-3 relevant hashtags
Write every piece of content completely — no unfinished sentences.

User request: ${prompt}`;
    }

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: CONTENT_MAX_TOKENS,
      temperature: CONTENT_TEMPERATURE,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content generated by OpenAI');
    }

    return content;
  }

  async generateImageContent(prompt, imageUrl = null) {
    const sanitizedPrompt = this.validatePrompt(prompt);

    const providers = [];
    
    if (this.openai && process.env.OPENAI_API_KEY) {
      providers.push({ name: 'openai', method: this.generateImageContentWithOpenAI.bind(this) });
    }
    
    if (this.googleApiKey) {
      providers.push({ name: 'google', method: this.generateImageContentWithGoogle.bind(this) });
    }

    if (providers.length === 0) {
      throw new Error('No AI providers configured for image content generation');
    }

    let lastError = null;

    for (const provider of providers) {
      try {
        console.log(`Attempting image content generation with ${provider.name}...`);
        const result = await provider.method(sanitizedPrompt, imageUrl);
        console.log(`✅ Image content generated successfully with ${provider.name}`);
        return {
          content: result,
          provider: provider.name,
          success: true
        };
      } catch (error) {
        console.error(`❌ ${provider.name} image content generation failed:`, error.message);
        lastError = error;
        continue;
      }
    }

    throw new Error(`All AI providers failed for image content generation. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async generateImageContentWithOpenAI(prompt, imageUrl = null) {
    if (!this.openai || !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = `You are a Twitter content creator. Generate engaging tweet content.

Keep under 280 characters
For threads: Only include hashtags in the FINAL tweet
For single tweets: Include 2-3 relevant hashtags
Be engaging and descriptive
Write the full tweet — do not cut off.

Generate tweet content for: ${prompt}`;

    const messages = [{ role: 'system', content: systemPrompt }];

    if (imageUrl) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await this.openai.chat.completions.create({
      model: imageUrl ? 'gpt-4o' : 'gpt-4o-mini',
      messages: messages,
      max_tokens: 400,
      temperature: 0.7, // Image generation can stay at 0.7 — creative latitude is fine here
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content generated by OpenAI for image');
    }

    return content;
  }

  async generateImageContentWithGoogle(prompt, imageUrl = null) {
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const systemPrompt = `You are a Twitter content creator. Generate engaging tweet content.

Keep under 280 characters
For threads: hashtags in FINAL tweet only
For single tweets: include 1-2 hashtags
Be engaging and visual
Write the full tweet — do not cut off.

Generate tweet content for: ${prompt}`;

    const requestBody = {
      contents: [{
        parts: [{ text: systemPrompt }]
      }],
      generationConfig: {
        temperature: 0.7, // Image generation can stay at 0.7
        topK: 1,
        topP: 1,
        maxOutputTokens: 400,
      }
    };

    if (imageUrl && imageUrl.startsWith('data:image/')) {
      const base64Data = imageUrl.split(',')[1];
      const mimeType = imageUrl.split(';')[0].split(':')[1];
      
      requestBody.contents[0].parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data
        }
      });
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${this.googleApiKey}`,
      requestBody,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    const content = response.data.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!content) {
      throw new Error('No content generated by Google Gemini for image');
    }

    return content;
  }

  async generateMultipleOptions(prompt, style = 'casual', count = 3, context = {}) {
    const { userToken = null, userId = null, planType = null } = context || {};
    const results = [];
    const errors = [];

    for (let i = 0; i < count; i++) {
      try {
        const result = await this.generateContent(prompt, style, 3, userToken, userId, planType);
        results.push(result);
      } catch (error) {
        errors.push(error.message);
        if (results.length === 0 && i === count - 1) {
          throw error;
        }
      }
    }

    return {
      options: results,
      errors: errors.length > 0 ? errors : null
    };
  }

  async generateTweets(params) {
    const {
      prompt,
      provider,
      style,
      hashtags,
      mentions,
      max_tweets,
      userId,
      userToken = null,
      planType = null,
    } = params;

    try {
      const result = await this.generateContent(prompt, style, 3, userToken || null, userId || null, planType || null);
      return [result.content];
    } catch (error) {
      console.error('AI generation failed:', error);
      throw new Error(`AI generation failed: ${error.message}`);
    }
  }

  cleanAIOutput(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    let cleaned = content;

    const refusalPatterns = [
      /I appreciate the detailed instructions/i,
      /I need to clarify my role/i,
      /I'm (Perplexity|Claude|ChatGPT|an AI|a language model)/i,
      /I cannot (generate|create|write)/i,
      /As an AI (assistant|model)/i,
    ];

    const isRefusal = refusalPatterns.some(pattern => pattern.test(content));
    if (isRefusal) {
      throw new Error('AI provider refused to generate content. Please try again.');
    }

    // Decode HTML entities
    cleaned = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

    // Remove markdown
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/\*([^*\s][^*]*[^*\s])\*/g, '$1');
    cleaned = cleaned.replace(/(?<!\w)_([^_\s][^_]*[^_\s])_(?!\w)/g, '$1');
    cleaned = cleaned.replace(/^#{1,6}\s+(.+)$/gm, '$1');
    cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
    cleaned = cleaned.replace(/```[^`]*```/g, '');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // Remove common assistant-style lead-ins
    cleaned = cleaned.replace(
      /^(?:okay|ok|sure|absolutely|great)[!,. ]+\s*here(?:'s| is)\s+[^\n]{0,140}\n+/i,
      ''
    );
    cleaned = cleaned.replace(
      /^(?:here(?:'s| is)\s+(?:a|an|the)\s+(?:tweet|thread|post)[^:]{0,80}:\s*)/i,
      ''
    );
    cleaned = cleaned.replace(/^(?:sure|okay|ok)[!,. ]+\s*/i, '');

    // Remove citations
    cleaned = cleaned.replace(/\[\d+\]/g, '');
    cleaned = cleaned.replace(/\(\d+\)/g, '');
    cleaned = cleaned.replace(/\s*sources?:\s*.*$/gi, '');
    cleaned = cleaned.replace(/^(Here's a tweet:|Here's|Tweet:|Here are \d+ tweets?:|Caption:)\s*/gi, '');
    cleaned = cleaned.replace(/^\d+\.\s+/gm, '');
    cleaned = cleaned.replace(/\s{3,}/g, '  ').trim();

    return cleaned;
  }

  async generateTweetOrThread(prompt, options = {}) {
    const style = options.style || 'casual';
    let aiPrompt = prompt;
    
    if (options.isThread) {
      aiPrompt = `${prompt}\nGenerate a Twitter thread (3-5 tweets, separated by ---).`;
    }
    
    const result = await this.generateContent(
      aiPrompt,
      style,
      3,
      options.userToken || null,
      options.userId || null,
      options.planType || null
    );
    
    if (options.isThread) {
      const threadParts = result.content.split(/---+/).map(t => t.trim()).filter(Boolean);
      return {
        text: result.content,
        isThread: true,
        threadParts,
        provider: result.provider,
        success: true
      };
    } else {
      const first = typeof result.content === 'string' ? result.content.split(/---+/)[0].trim() : '';
      return {
        text: first,
        isThread: false,
        threadParts: [first],
        provider: result.provider,
        success: true
      };
    }
  }
}

export const aiService = new AIService();