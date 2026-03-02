import pool from '../config/database.js';
import axios from 'axios';

// ─── Constants ──────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-3-flash-preview';
const ANALYSIS_TEMPERATURE = 0.4; // Low temp for structured analysis
const ANALYSIS_MAX_TOKENS = 4096;
const TRENDING_MAX_TOKENS = 2048;
const PROMPT_LIBRARY_MAX_TOKENS = 8192;
const REFERENCE_MAX_TOKENS = 4096;

class ProfileAnalysisService {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
  }

  // ─── Job 1: Fetch Twitter History ───────────────────────────────────────
  async fetchTwitterHistory(userId, twitterUserId, accessToken) {
    console.log(`[ProfileAnalysis][Job1] ── Fetching tweet history ──`);
    console.log(`[ProfileAnalysis][Job1] userId=${userId}, twitterUserId=${twitterUserId}, hasToken=${!!accessToken}`);

    // Check DB for previously stored tweets
    const dbResult = await pool.query(
      `SELECT content, impressions, likes, retweets, replies, created_at 
       FROM tweets WHERE user_id = $1 AND status = 'posted'
       ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    console.log(`[ProfileAnalysis][Job1] DB query returned ${dbResult.rows.length} tweets`);

    const dbTweets = dbResult.rows.map((row) => ({
      text: row.content,
      impressions: row.impressions || 0,
      likes: row.likes || 0,
      retweets: row.retweets || 0,
      replies: row.replies || 0,
      created_at: row.created_at,
    }));

    // Use DB tweets if we have enough (saves Twitter free-tier rate limit: 1 read/15min)
    if (dbTweets.length >= 5) {
      console.log(`[ProfileAnalysis][Job1] ✓ Using ${dbTweets.length} DB tweets (skipping Twitter API to preserve free-tier quota)`);
      if (dbTweets.length > 0) {
        console.log(`[ProfileAnalysis][Job1] Sample tweet #1: "${dbTweets[0].text?.substring(0, 80)}..."`);
      }
      return { source: 'database', tweets: dbTweets };
    }
    console.log(`[ProfileAnalysis][Job1] Only ${dbTweets.length} DB tweets (< 5), will try Twitter API`);

    // Not enough in DB — try Twitter API
    try {
      const url = new URL(`https://api.twitter.com/2/users/${twitterUserId}/tweets`);
      url.searchParams.set('max_results', '100');
      url.searchParams.set('tweet.fields', 'public_metrics,created_at,text');
      url.searchParams.set('exclude', 'retweets,replies');

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ProfileAnalysis] Twitter API error ${response.status}:`, errorText);
        throw new Error(`Twitter API returned ${response.status}`);
      }

      const data = await response.json();
      const apiTweets = (data.data || []).map((tweet) => ({
        text: tweet.text,
        impressions: tweet.public_metrics?.impression_count || 0,
        likes: tweet.public_metrics?.like_count || 0,
        retweets: tweet.public_metrics?.retweet_count || 0,
        replies: tweet.public_metrics?.reply_count || 0,
        created_at: tweet.created_at,
      }));

      if (apiTweets.length > 0) {
        // Merge: API tweets + any DB tweets not in API (by text dedup)
        const apiTexts = new Set(apiTweets.map((t) => t.text));
        const unique = [...apiTweets, ...dbTweets.filter((t) => !apiTexts.has(t.text))];
        console.log(`[ProfileAnalysis] Fetched ${apiTweets.length} from Twitter API, ${dbTweets.length} from DB, ${unique.length} merged`);
        return { source: 'twitter_api+database', tweets: unique.slice(0, 100) };
      }

      // API returned 0 tweets — fall through to DB
      throw new Error('Twitter API returned 0 tweets');
    } catch (error) {
      console.error('[ProfileAnalysis] Twitter fetch error:', error.message);
      // Fallback to DB tweets
      if (dbTweets.length > 0) {
        console.log(`[ProfileAnalysis] Falling back to ${dbTweets.length} tweets from DB`);
        return { source: 'database', tweets: dbTweets };
      }
      return { source: 'none', tweets: [] };
    }
  }

  // ─── Job 2: Assess Data Quality ────────────────────────────────────────
  assessDataQuality(tweets) {
    const count = tweets.length;
    let result;
    if (count >= 20) {
      result = { confidence: 'high', reason: `Based on ${count} tweets with engagement data` };
    } else if (count >= 5) {
      result = { confidence: 'medium', reason: `Based on ${count} tweets — niche, audience, and tone analysis` };
    } else {
      result = { confidence: 'low', reason: count > 0 ? `Only ${count} tweets found — bio analysis only` : 'No tweets found — bio analysis only' };
    }
    console.log(`[ProfileAnalysis][Job2] Data quality: ${count} tweets → confidence=${result.confidence} (${result.reason})`);
    return result;
  }

  // ─── Job 3: Gemini Profile Analysis ─────────────────────────────────────
  async analyseProfile(profile, tweets, confidence, additionalContext = {}) {
    console.log(`[ProfileAnalysis][Job3] ── Gemini profile analysis ──`);
    console.log(`[ProfileAnalysis][Job3] Profile data:`, JSON.stringify({
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio?.substring(0, 100),
      website: profile.websiteUrl,
      followers: profile.followersCount,
      following: profile.followingCount,
      tweetCount: profile.tweetCount,
    }));
    console.log(`[ProfileAnalysis][Job3] Tweets: ${tweets.length}, confidence: ${confidence}`);

    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const normalisedTweets = this.normaliseTweetsForAnalysis(tweets);
    let prompt;

    if (confidence === 'high') {
      const topTweets = this.getTopPerformingTweets(tweets, 5);
      const bottomTweets = this.getBottomPerformingTweets(tweets, 3);
      const timingPatterns = this.analyseTimingPatterns(tweets);
      const contentPatterns = this.analyseContentPatterns(tweets);

      prompt = `You are a Twitter growth strategist. Analyse this Twitter account and return a structured JSON strategy.

Bio: ${profile.bio || 'No bio provided'}
Display name: ${profile.displayName || 'Unknown'}
Website: ${profile.websiteUrl || 'None'}
Followers: ${profile.followersCount || 0}
Following: ${profile.followingCount || 0}
Total tweets: ${profile.tweetCount || 0}
Tweets analysed: ${tweets.length}

${additionalContext.portfolioContent ? `Website/portfolio content:\n${additionalContext.portfolioContent}\n\n` : ''}${additionalContext.userContext ? `User's interests and topics they want to cover:\n${additionalContext.userContext}\n\n` : ''}
Top 5 performing tweets (by engagement):
${topTweets.map((t, i) => `${i + 1}. "${t.text}" — ${t.likes} likes, ${t.retweets} RTs, ${t.replies} replies, ${t.impressions} impressions`).join('\n')}

Bottom 3 performing tweets:
${bottomTweets.map((t, i) => `${i + 1}. "${t.text}" — ${t.likes} likes, ${t.retweets} RTs`).join('\n')}

Timing patterns:
- Most active days: ${timingPatterns.bestDays.join(', ') || 'Unknown'}
- Most active hours: ${timingPatterns.bestHours || 'Unknown'}

Content patterns:
- Average tweet length: ${contentPatterns.avgLength} chars
- Thread ratio: ${contentPatterns.threadRatio}%
- Hashtag usage: ${contentPatterns.hashtagUsage}%

CRITICAL: Create a comprehensive topic list that includes:
1. Topics from their Twitter history
2. Topics from their portfolio/website
3. EVERY individual interest the user mentioned (do NOT group or merge them)

For example, if user mentions "basketball, cricket, anime, history", include ALL FOUR as separate topics, not grouped as "Sports & Entertainment".

Return ONLY valid JSON with this exact structure:
{
  "niche": "string — primary niche/industry (blend Twitter activity with user interests)",
  "audience": "string — who their content targets",
  "tone": "string — their writing style description",
  "top_topics": ["array of 5-7 main topics - include EACH user interest as a separate topic, do NOT merge or group them"],
  "best_format": "string — threads, single tweets, or mixed",
  "best_days": ["array of best performing days"],
  "best_hours": "string — best time range e.g. 9am-11am",
  "content_mistakes": ["array of 2-3 things that underperform"],
  "content_gaps": ["array of 2-3 content opportunities they're missing"],
  "posting_frequency": "string — e.g. 4-5 times per week",
  "confidence": "${confidence}",
  "confidence_reason": "string — explain what the analysis is based on"
}`;
    } else if (confidence === 'medium') {
      prompt = `You are a Twitter growth strategist. Analyse this Twitter account based on limited data and return structured JSON.

Bio: ${profile.bio || 'No bio provided'}
Display name: ${profile.displayName || 'Unknown'}
Website: ${profile.websiteUrl || 'None'}
Followers: ${profile.followersCount || 0}
Following: ${profile.followingCount || 0}
Tweets analysed: ${tweets.length}

${additionalContext.portfolioContent ? `Website/portfolio content:\n${additionalContext.portfolioContent}\n\n` : ''}${additionalContext.userContext ? `User's interests and topics they want to cover:\n${additionalContext.userContext}\n\n` : ''}
Sample tweets:
${normalisedTweets.slice(0, 10).map((t, i) => `${i + 1}. "${t.text}" — ${t.likes} likes, ${t.retweets} RTs`).join('\n')}

CRITICAL: Create a comprehensive topic list that includes:
1. Topics from their Twitter history
2. Topics from their portfolio/website
3. EVERY individual interest the user mentioned (do NOT group or merge them)

For example, if user mentions "basketball, cricket, anime, history", include ALL FOUR as separate topics, not grouped as "Sports & Entertainment".

Return ONLY valid JSON with this exact structure:
{
  "niche": "string — best guess at primary niche (blend Twitter activity with user interests)",
  "audience": "string — likely target audience",
  "tone": "string — observed writing style",
  "top_topics": ["array of 5-7 topics - include EACH user interest as a separate topic, do NOT merge or group them"],
  "best_format": "mixed",
  "best_days": ["Tuesday", "Thursday"],
  "best_hours": "9am-11am",
  "content_mistakes": [],
  "content_gaps": ["array of 1-2 general suggestions"],
  "posting_frequency": "3-5 times per week",
  "confidence": "medium",
  "confidence_reason": "Based on ${tweets.length} tweets — limited engagement data"
}`;
    } else {
      prompt = `You are a Twitter growth strategist. Analyse this Twitter account based on bio only and return structured JSON.

Bio: ${profile.bio || 'No bio provided'}
Display name: ${profile.displayName || 'Unknown'}
Website: ${profile.websiteUrl || 'None'}
Followers: ${profile.followersCount || 0}
Following: ${profile.followingCount || 0}
${tweets.length > 0 ? `\nSample tweets:\n${normalisedTweets.slice(0, 3).map((t, i) => `${i + 1}. "${t.text}"`).join('\n')}` : ''}

${additionalContext.portfolioContent ? `Website/portfolio content:\n${additionalContext.portfolioContent}\n\n` : ''}${additionalContext.userContext ? `User's interests and topics they want to cover:\n${additionalContext.userContext}\n\n` : ''}

CRITICAL: Create a comprehensive topic list that includes:
1. Topics from their bio
2. Topics from their portfolio/website
3. EVERY individual interest the user mentioned (do NOT group or merge them)

For example, if user mentions "basketball, cricket, anime, history", include ALL FOUR as separate topics, not grouped as "Sports & Entertainment".

Return ONLY valid JSON with this exact structure:
{
  "niche": "string — best guess from bio (blend with user interests)",
  "audience": "string — likely audience based on bio",
  "tone": "string — suggested tone based on bio",
  "top_topics": ["array of 5-7 topics - include EACH user interest as a separate topic, do NOT merge or group them"],
  "best_format": "mixed",
  "best_days": ["Tuesday", "Thursday"],
  "best_hours": "9am-11am",
  "content_mistakes": [],
  "content_gaps": [],
  "posting_frequency": "3-5 times per week",
  "confidence": "low",
  "confidence_reason": "${tweets.length > 0 ? `Based on bio and ${tweets.length} tweets` : 'Based on bio analysis only — no tweet history available'}"
}`;
    }

    console.log(`[ProfileAnalysis][Job3] Prompt length: ${prompt.length} chars, confidence path: ${confidence}`);
    console.log(`[ProfileAnalysis][Job3] Calling Gemini (model=${GEMINI_MODEL}, maxTokens=${ANALYSIS_MAX_TOKENS}, temp=${ANALYSIS_TEMPERATURE})...`);
    const response = await this.callGemini(prompt, ANALYSIS_MAX_TOKENS, ANALYSIS_TEMPERATURE);
    console.log(`[ProfileAnalysis][Job3] Gemini responded, ${response.length} chars`);
    const parsed = this.parseGeminiJSON(response);
    console.log(`[ProfileAnalysis][Job3] ✓ Parsed result:`, JSON.stringify({
      niche: parsed.niche,
      audience: parsed.audience,
      tone: parsed.tone,
      top_topics: parsed.top_topics,
      confidence: parsed.confidence,
    }));
    return parsed;
  }

  // ─── Job 4: Fetch Trending Topics ──────────────────────────────────────
  async fetchTrendingTopics(niche) {
    console.log(`[ProfileAnalysis][Job4] ── Fetching trending topics for niche: "${niche}" ──`);
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const prompt = `What topics are trending on Twitter right now for ${niche}? Return ONLY valid JSON array of exactly 10 trending topics.

Each topic should have:
- "topic": short topic name
- "context": one sentence explaining why it's trending
- "relevance": "high" | "medium" — how relevant to ${niche}

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
      if (!content) {
        console.log(`[ProfileAnalysis][Job4] Empty trending response`);
        return [];
      }

      const topics = this.parseGeminiJSONArray(content);
      console.log(`[ProfileAnalysis][Job4] ✓ Got ${topics.length} trending topics`);
      return topics;
    } catch (error) {
      console.error(`[ProfileAnalysis][Job4] ✗ Trending fetch failed: ${error.message}`);
      return [];
    }
  }

  // ─── Reference Account Analysis ─────────────────────────────────────────
  async analyseReferenceAccount(handle, niche, bearerToken) {
    try {
      // Extract username from URL if user pasted a full URL (e.g. https://x.com/user)
      let cleanHandle = handle.replace('@', '').trim();
      const urlMatch = cleanHandle.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:@)?([a-zA-Z0-9_]+)/i);
      if (urlMatch) cleanHandle = urlMatch[1];
      console.log(`[ProfileAnalysis] Reference lookup: @${cleanHandle} (raw: ${handle})`);

      // Lookup user by username
      const lookupUrl = `https://api.twitter.com/2/users/by/username/${cleanHandle}?user.fields=public_metrics,description`;
      const lookupResp = await fetch(lookupUrl, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });

      if (!lookupResp.ok) {
        const errorBody = await lookupResp.text().catch(() => '');
        console.error(`[ProfileAnalysis] Twitter user lookup failed for @${cleanHandle}: ${lookupResp.status}`, errorBody);
        if (lookupResp.status === 401) throw new Error(`Twitter API auth failed (401). The bearer token may be invalid or expired.`);
        if (lookupResp.status === 403) throw new Error(`Twitter API access denied (403). Check API access level.`);
        if (lookupResp.status === 429) throw new Error(`Twitter API rate limit hit. Please try again in a few minutes.`);
        if (lookupResp.status === 404) throw new Error(`User @${cleanHandle} not found on Twitter.`);
        throw new Error(`Twitter API error ${lookupResp.status} looking up @${cleanHandle}`);
      }

      const lookupData = await lookupResp.json();
      const refUser = lookupData.data;
      if (!refUser) {
        // Check for errors array in response (e.g. suspended, not-found)
        const apiErrors = lookupData.errors;
        if (apiErrors?.length) {
          const detail = apiErrors[0].detail || apiErrors[0].title || 'Unknown error';
          throw new Error(`@${cleanHandle}: ${detail}`);
        }
        throw new Error(`User @${cleanHandle} not found`);
      }

      console.log(`[ProfileAnalysis] Found @${cleanHandle}: ${refUser.public_metrics?.followers_count || 0} followers`);

      // Fetch their tweets
      const timelineUrl = new URL(`https://api.twitter.com/2/users/${refUser.id}/tweets`);
      timelineUrl.searchParams.set('max_results', '50');
      timelineUrl.searchParams.set('tweet.fields', 'public_metrics,created_at,text');
      timelineUrl.searchParams.set('exclude', 'retweets,replies');

      const timelineResp = await fetch(timelineUrl.toString(), {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });

      if (!timelineResp.ok) {
        const errorBody = await timelineResp.text().catch(() => '');
        console.error(`[ProfileAnalysis] Twitter timeline fetch failed for @${cleanHandle}: ${timelineResp.status}`, errorBody);
        if (timelineResp.status === 401) throw new Error(`Twitter API auth failed (401) fetching tweets for @${cleanHandle}.`);
        if (timelineResp.status === 429) throw new Error(`Twitter API rate limit hit fetching tweets. Please try again in a few minutes.`);
        throw new Error(`Twitter API error ${timelineResp.status} fetching tweets for @${cleanHandle}`);
      }

      const timelineData = await timelineResp.json();
      const tweets = (timelineData.data || []).map((t) => ({
        text: t.text,
        likes: t.public_metrics?.like_count || 0,
        retweets: t.public_metrics?.retweet_count || 0,
        replies: t.public_metrics?.reply_count || 0,
      }));

      console.log(`[ProfileAnalysis] @${cleanHandle}: ${tweets.length} tweets fetched`);

      if (tweets.length === 0) {
        // No tweets available — still return profile info without Gemini
        return {
          handle: `@${cleanHandle}`,
          followers: refUser.public_metrics?.followers_count || 0,
          what_works: [],
          content_angles: [],
          gaps_you_can_fill: ['This account has no recent original tweets — could be an opportunity to fill the gap'],
          key_takeaway: `@${cleanHandle} has ${refUser.public_metrics?.followers_count || 0} followers but no recent original tweets.`,
        };
      }

      const topTweets = this.getTopPerformingTweets(tweets, 5);

      // Gemini analysis of reference account
      const prompt = `Analyse this Twitter account as a competitor/reference for someone in ${niche}.

Account: @${handle}
Bio: ${refUser.description || 'N/A'}
Followers: ${refUser.public_metrics?.followers_count || 0}

Their top performing tweets:
${topTweets.map((t, i) => `${i + 1}. "${t.text}" — ${t.likes} likes, ${t.retweets} RTs`).join('\n')}

Return ONLY valid JSON:
{
  "handle": "@${handle}",
  "followers": ${refUser.public_metrics?.followers_count || 0},
  "what_works": ["array of 3 things working well for them"],
  "content_angles": ["array of 2-3 winning content angles"],
  "gaps_you_can_fill": ["array of 2 opportunities they're missing that the user could cover"],
  "key_takeaway": "string — one sentence summary"
}`;

      const response = await this.callGemini(prompt, REFERENCE_MAX_TOKENS, ANALYSIS_TEMPERATURE);
      return this.parseGeminiJSON(response);
    } catch (error) {
      console.error(`[ProfileAnalysis] Reference account @${handle} error:`, error.message);
      return {
        handle: `@${handle.replace('@', '').trim()}`,
        error: error.message,
        what_works: [],
        content_angles: [],
        gaps_you_can_fill: [],
        key_takeaway: 'Could not analyse this account',
      };
    }
  }

  // ─── Generate Prompt Library ────────────────────────────────────────────
  async generatePromptLibrary(analysisData, trendingTopics, referenceInsights, strategy) {
    if (!this.googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const topicsSection = (analysisData.top_topics || []).map((t) => `- ${t}`).join('\n');
    const trendingSection = (trendingTopics || []).map((t) => `- ${t.topic}: ${t.context}`).join('\n');
    const referenceSection = (referenceInsights || [])
      .filter((r) => !r.error)
      .map((r) => {
        const parts = [`@${r.handle} (${r.followers?.toLocaleString() || '?'} followers)`];
        if (r.content_angles?.length) parts.push(`  Angles: ${r.content_angles.join(', ')}`);
        if (r.what_works?.length) parts.push(`  Works: ${r.what_works.join(', ')}`);
        if (r.gaps_you_can_fill?.length) parts.push(`  Gaps to fill: ${r.gaps_you_can_fill.join(', ')}`);
        return parts.join('\n');
      })
      .join('\n');

    const goals = Array.isArray(strategy?.content_goals) ? strategy.content_goals : [];
    const goalsSection = goals.length > 0 ? goals.map((g) => `- ${g}`).join('\n') : '- Build authority\n- Grow followers';

    const extraContext = strategy?.metadata?.extra_context || '';

    const prompt = `You are a Twitter content strategist. Generate 30+ tweet prompts for this creator.

CREATOR PROFILE:
Niche: ${analysisData.niche || 'General'}
Audience: ${analysisData.audience || 'General audience'}
Tone: ${analysisData.tone || 'Conversational'}
Best format: ${analysisData.best_format || 'mixed'}

GOALS:
${goalsSection}

TOPICS THEY COVER:
${topicsSection || '- General topics'}

TRENDING IN THEIR NICHE:
${trendingSection || '- No trending data available'}

${referenceSection ? `COMPETITOR INSIGHTS:\n${referenceSection}` : ''}

${extraContext ? `ADDITIONAL CONTEXT:\n${extraContext}` : ''}

CONTENT GAPS TO FILL:
${(analysisData.content_gaps || []).map((g) => `- ${g}`).join('\n') || '- None identified'}

CONTENT MISTAKES TO AVOID:
${(analysisData.content_mistakes || []).map((m) => `- ${m}`).join('\n') || '- None identified'}

Generate EXACTLY 36 tweet prompts spread across 6 categories (6 per category):
- educational
- engagement  
- storytelling
- tips & tricks
- promotional
- inspirational

Each prompt must include:
1. A fill-in-the-blank tweet template with {placeholders}
2. A "reason" explaining WHY this prompt works for this creator
3. A "source" tag: one of "niche_fit", "trending", "competitor_gap", "content_gap", "top_performer", "audience_need"

Return ONLY valid JSON:
{
  "prompts": [
    {
      "prompt_text": "string — the tweet template with {placeholders}",
      "category": "string — one of the 6 categories",
      "reason": "string — why this works for this specific creator",
      "source": "string — niche_fit | trending | competitor_gap | content_gap | top_performer | audience_need",
      "variables": { "key": "description of what to fill in" }
    }
  ]
}`;

    const response = await this.callGemini(prompt, PROMPT_LIBRARY_MAX_TOKENS, 0.65);
    const parsed = this.parseGeminiJSON(response);
    return parsed?.prompts || [];
  }

  // ─── Run Full Analysis Pipeline ─────────────────────────────────────────
  async runFullAnalysis(userId, strategyId, options = {}) {
    console.log(`\n[ProfileAnalysis] ════════════════════════════════════════════════`);
    console.log(`[ProfileAnalysis] STARTING FULL ANALYSIS`);
    console.log(`[ProfileAnalysis] userId=${userId}, strategyId=${strategyId}`);
    console.log(`[ProfileAnalysis] ════════════════════════════════════════════════`);
    const pipelineStart = Date.now();
    const { portfolioUrl, userContext } = options;

    // Create analysis record
    const { rows: [analysis] } = await pool.query(
      `INSERT INTO profile_analyses (user_id, strategy_id, status) VALUES ($1, $2, 'analysing') RETURNING *`,
      [userId, strategyId]
    );
    console.log(`[ProfileAnalysis] Created analysis record: id=${analysis.id}`);

    try {
      // Get Twitter auth data
      const { rows: [twitterAuth] } = await pool.query(
        `SELECT twitter_user_id, twitter_username, twitter_display_name, 
                access_token, followers_count, following_count, tweet_count,
                bio, website_url
         FROM twitter_auth WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );

      if (!twitterAuth) {
        throw new Error('Twitter account not connected');
      }

      console.log(`[ProfileAnalysis] Twitter auth found:`, JSON.stringify({
        username: twitterAuth.twitter_username,
        displayName: twitterAuth.twitter_display_name,
        twitterUserId: twitterAuth.twitter_user_id,
        followers: twitterAuth.followers_count,
        following: twitterAuth.following_count,
        tweetCount: twitterAuth.tweet_count,
        hasBio: !!twitterAuth.bio,
        bioLength: twitterAuth.bio?.length || 0,
        bioPreview: twitterAuth.bio?.substring(0, 80),
        hasWebsite: !!twitterAuth.website_url,
        website: twitterAuth.website_url,
        hasAccessToken: !!twitterAuth.access_token,
      }));

      const profile = {
        twitterUserId: twitterAuth.twitter_user_id,
        username: twitterAuth.twitter_username,
        displayName: twitterAuth.twitter_display_name,
        followersCount: twitterAuth.followers_count,
        followingCount: twitterAuth.following_count,
        tweetCount: twitterAuth.tweet_count,
        bio: twitterAuth.bio,
        websiteUrl: twitterAuth.website_url,
      };

      // Job 1 + Job 2: Fetch tweets and assess quality
      console.log(`[ProfileAnalysis] ── Step 1/4: Fetching tweets ──`);
      const job1Start = Date.now();
      const tweetResult = await this.fetchTwitterHistory(
        userId,
        twitterAuth.twitter_user_id,
        twitterAuth.access_token
      );
      console.log(`[ProfileAnalysis] Step 1 done in ${Date.now() - job1Start}ms: source=${tweetResult.source}, tweets=${tweetResult.tweets.length}`);

      // Fetch Portfolio URL if provided
      let portfolioContent = null;
      if (portfolioUrl) {
        console.log(`[ProfileAnalysis] ── Fetching portfolio URL: ${portfolioUrl} ──`);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          const response = await fetch(portfolioUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const text = await response.text();
            // Basic HTML stripping
            const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            portfolioContent = cleanText.substring(0, 3000);
            console.log(`[ProfileAnalysis] Portfolio fetched: ${portfolioContent.length} chars`);
          } else {
            console.log(`[ProfileAnalysis] Portfolio fetch failed: ${response.status}`);
          }
        } catch (err) {
          console.log(`[ProfileAnalysis] Portfolio fetch error: ${err.message}`);
        }
      }

      console.log(`[ProfileAnalysis] ── Step 2/4: Assessing data quality ──`);
      const quality = this.assessDataQuality(tweetResult.tweets);

      // Update progress
      await pool.query(
        `UPDATE profile_analyses SET tweets_analysed = $1, confidence = $2, confidence_reason = $3 WHERE id = $4`,
        [tweetResult.tweets.length, quality.confidence, quality.reason, analysis.id]
      );
      console.log(`[ProfileAnalysis] Updated analysis record with tweet count and quality`);

      // Job 3 + Job 4: Run Gemini analysis and trending in parallel
      const trendingInput = profile.bio || profile.displayName || 'general';
      console.log(`[ProfileAnalysis] ── Step 3+4: Gemini analysis + trending (parallel) ──`);
      console.log(`[ProfileAnalysis] Trending input: "${trendingInput.substring(0, 60)}"`);
      const job34Start = Date.now();

      const additionalContext = { portfolioContent, userContext };

      const [analysisData, trendingTopics] = await Promise.all([
        this.analyseProfile(profile, tweetResult.tweets, quality.confidence, additionalContext),
        this.fetchTrendingTopics(trendingInput),
      ]);
      console.log(`[ProfileAnalysis] Steps 3+4 done in ${Date.now() - job34Start}ms`);

      // Now re-fetch trending with the actual niche if different
      let finalTrending = trendingTopics;
      if (analysisData.niche && analysisData.niche !== (profile.bio || '').slice(0, 50)) {
        console.log(`[ProfileAnalysis] Re-fetching trending with discovered niche: "${analysisData.niche}"`);
        try {
          finalTrending = await this.fetchTrendingTopics(analysisData.niche);
        } catch {
          console.log(`[ProfileAnalysis] Niche re-fetch failed, keeping original trending`);
        }
      } else {
        console.log(`[ProfileAnalysis] Skipping trending re-fetch (niche matches bio or not set)`);
      }

      // Save analysis
      console.log(`[ProfileAnalysis] ── Saving results to DB ──`);
      await pool.query(
        `UPDATE profile_analyses 
         SET analysis_data = $1, trending_topics = $2, status = 'completed', 
             twitter_user_id = $3, updated_at = NOW()
         WHERE id = $4`,
        [
          JSON.stringify(analysisData),
          JSON.stringify(finalTrending),
          twitterAuth.twitter_user_id,
          analysis.id,
        ]
      );

      // Update strategy with analysis niche/audience + analysis_cache
      if (strategyId) {
        // Build metadata patch dynamically
        const metadataPatch = {
          profile_analysis_id: analysis.id,
          analysis_confidence: quality.confidence,
          analysis_source: tweetResult.source,
          tweets_analysed: tweetResult.tweets.length,
          analysed_at: new Date().toISOString(),
          analysis_cache: {
            niche: analysisData.niche || null,
            audience: analysisData.audience || null,
            tone: analysisData.tone || null,
            top_topics: analysisData.top_topics || [],
            best_days: analysisData.best_days || [],
            best_hours: analysisData.best_hours || null,
            best_format: analysisData.best_format || null,
            posting_frequency: analysisData.posting_frequency || null,
            content_mistakes: analysisData.content_mistakes || [],
            content_gaps: analysisData.content_gaps || [],
            confidence: quality.confidence,
            tweets_analysed: tweetResult.tweets.length,
          },
        };

        if (portfolioUrl) {
          metadataPatch.portfolio_url = portfolioUrl;
        }

        if (portfolioContent) {
          metadataPatch.portfolio_content = portfolioContent;
        }

        if (userContext) {
          metadataPatch.user_context = userContext;
        }

        // Store initial context for prompt generation
        if (portfolioContent || userContext) {
          metadataPatch.extra_context = [
            portfolioContent ? `Website/portfolio content:\n${portfolioContent}` : '',
            userContext ? `User-provided context: ${userContext}` : ''
          ].filter(Boolean).join('\n\n');
        }

        await pool.query(
          `UPDATE user_strategies SET 
            niche = COALESCE(NULLIF($1, ''), niche),
            target_audience = COALESCE(NULLIF($2, ''), target_audience),
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
          WHERE id = $4`,
          [
            analysisData.niche || '',
            analysisData.audience || '',
            JSON.stringify(metadataPatch),
            strategyId,
          ]
        );
      }

      const totalMs = Date.now() - pipelineStart;
      console.log(`[ProfileAnalysis] ════════════════════════════════════════════════`);
      console.log(`[ProfileAnalysis] ✓ ANALYSIS COMPLETE in ${totalMs}ms`);
      console.log(`[ProfileAnalysis] Result: niche="${analysisData.niche}", audience="${analysisData.audience}", confidence=${quality.confidence}, tweets=${tweetResult.tweets.length}, trending=${finalTrending.length}`);
      console.log(`[ProfileAnalysis] ════════════════════════════════════════════════\n`);

      return {
        analysisId: analysis.id,
        analysisData,
        trendingTopics: finalTrending,
        tweetsAnalysed: tweetResult.tweets.length,
        tweetSource: tweetResult.source,
        confidence: quality.confidence,
        confidenceReason: quality.reason,
      };
    } catch (error) {
      const totalMs = Date.now() - pipelineStart;
      console.error(`[ProfileAnalysis] ✗ ANALYSIS FAILED after ${totalMs}ms:`, error.message);
      await pool.query(
        `UPDATE profile_analyses SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [error.message, analysis.id]
      );
      throw error;
    }
  }

  // ─── Confirm Step (save user edits/confirmations) ──────────────────────
  async confirmAnalysisStep(analysisId, stepName, value) {
    const { rows: [analysis] } = await pool.query(
      `SELECT id, analysis_data, strategy_id FROM profile_analyses WHERE id = $1`,
      [analysisId]
    );

    if (!analysis) throw new Error('Analysis not found');

    const data = typeof analysis.analysis_data === 'string'
      ? JSON.parse(analysis.analysis_data)
      : analysis.analysis_data || {};

    // Merge user confirmation/edit into analysis data
    data[stepName] = value;
    data[`${stepName}_confirmed`] = true;

    await pool.query(
      `UPDATE profile_analyses SET analysis_data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(data), analysisId]
    );

    // Also update strategy fields if relevant
    if (analysis.strategy_id) {
      const strategyUpdates = {};
      if (stepName === 'niche') strategyUpdates.niche = value;
      if (stepName === 'audience') strategyUpdates.target_audience = value;
      if (stepName === 'tone') {
        strategyUpdates.metadata_patch = { tone: value };
      }
      if (stepName === 'goals') {
        strategyUpdates.content_goals = Array.isArray(value) ? value : [value];
      }
      if (stepName === 'topics') {
        strategyUpdates.topics = Array.isArray(value) ? value : [value];
      }
      if (stepName === 'posting_frequency') {
        strategyUpdates.posting_frequency = value;
      }

      const setClauses = [];
      const params = [analysis.strategy_id];
      let paramIndex = 2;

      if (strategyUpdates.niche) {
        setClauses.push(`niche = $${paramIndex++}`);
        params.push(strategyUpdates.niche);
      }
      if (strategyUpdates.target_audience) {
        setClauses.push(`target_audience = $${paramIndex++}`);
        params.push(strategyUpdates.target_audience);
      }
      if (strategyUpdates.posting_frequency) {
        setClauses.push(`posting_frequency = $${paramIndex++}`);
        params.push(strategyUpdates.posting_frequency);
      }
      if (strategyUpdates.content_goals) {
        setClauses.push(`content_goals = $${paramIndex++}`);
        params.push(strategyUpdates.content_goals);
      }
      if (strategyUpdates.topics) {
        setClauses.push(`topics = $${paramIndex++}`);
        params.push(strategyUpdates.topics);
      }
      if (strategyUpdates.metadata_patch) {
        setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIndex++}::jsonb`);
        params.push(JSON.stringify(strategyUpdates.metadata_patch));
      }

      if (setClauses.length > 0) {
        setClauses.push('updated_at = NOW()');
        await pool.query(
          `UPDATE user_strategies SET ${setClauses.join(', ')} WHERE id = $1`,
          params
        );
      }
    }

    return data;
  }

  // ─── Analyse Reference Accounts and Merge ──────────────────────────────
  async analyseReferenceAccounts(analysisId, handles) {
    const { rows: [analysis] } = await pool.query(
      `SELECT id, analysis_data, user_id, strategy_id FROM profile_analyses WHERE id = $1`,
      [analysisId]
    );

    if (!analysis) throw new Error('Analysis not found');

    // Use app-level Bearer token for reference lookups (other people's public timelines)
    // User OAuth tokens on free tier often get 401 for user-lookup endpoints
    let bearerToken = process.env.TWITTER_BEARER_TOKEN;

    // Auto-generate app-only bearer token from API key/secret if TWITTER_BEARER_TOKEN not set
    if (!bearerToken && process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET) {
      try {
        console.log('[ProfileAnalysis] No TWITTER_BEARER_TOKEN set — generating app-only token from API key/secret');
        const credentials = Buffer.from(
          `${encodeURIComponent(process.env.TWITTER_API_KEY)}:${encodeURIComponent(process.env.TWITTER_API_SECRET)}`
        ).toString('base64');
        const tokenResp = await fetch('https://api.twitter.com/oauth2/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: 'grant_type=client_credentials',
        });
        if (tokenResp.ok) {
          const tokenData = await tokenResp.json();
          bearerToken = tokenData.access_token;
          console.log('[ProfileAnalysis] App-only bearer token obtained successfully');
        } else {
          const errBody = await tokenResp.text().catch(() => '');
          console.error('[ProfileAnalysis] Failed to obtain app-only bearer token:', tokenResp.status, errBody);
        }
      } catch (err) {
        console.error('[ProfileAnalysis] App-only bearer token generation failed:', err.message);
      }
    }

    // Final fallback to user's OAuth2 token
    if (!bearerToken) {
      const { rows: [twitterAuth] } = await pool.query(
        `SELECT access_token FROM twitter_auth WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [analysis.user_id]
      );
      if (!twitterAuth) throw new Error('Twitter account not connected and no app bearer token configured. Please set TWITTER_BEARER_TOKEN or TWITTER_API_KEY + TWITTER_API_SECRET.');
      bearerToken = twitterAuth.access_token;
      console.log('[ProfileAnalysis] Using user OAuth2 token as bearer (may have limited access)');
    }

    const data = typeof analysis.analysis_data === 'string'
      ? JSON.parse(analysis.analysis_data)
      : analysis.analysis_data || {};

    const results = await Promise.all(
      handles.filter(Boolean).slice(0, 2).map((handle) =>
        this.analyseReferenceAccount(handle, data.niche || 'general', bearerToken)
      )
    );

    await pool.query(
      `UPDATE profile_analyses SET reference_accounts = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(results), analysisId]
    );

    // ─── Merge competitor insights into the strategy ───────────────────────
    if (analysis.strategy_id) {
      const successfulResults = results.filter((r) => !r.error);
      if (successfulResults.length > 0) {
        // Collect new content angles and gaps from competitor analysis
        const competitorAngles = successfulResults.flatMap((r) => r.content_angles || []);
        const competitorGaps = successfulResults.flatMap((r) => r.gaps_you_can_fill || []);
        const competitorWorking = successfulResults.flatMap((r) => r.what_works || []);
        const competitorTakeaways = successfulResults.map((r) => `${r.handle}: ${r.key_takeaway}`).filter(Boolean);

        // Store competitor intelligence in strategy metadata so it's used for content generation
        await pool.query(
          `UPDATE user_strategies
           SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [
            analysis.strategy_id,
            JSON.stringify({
              competitor_insights: {
                handles: successfulResults.map((r) => r.handle),
                content_angles: competitorAngles,
                gaps_to_fill: competitorGaps,
                what_works: competitorWorking,
                takeaways: competitorTakeaways,
                analysed_at: new Date().toISOString(),
              },
            }),
          ]
        );
        console.log(`[ProfileAnalysis] Merged competitor insights into strategy ${analysis.strategy_id}`);
      }
    }

    return results;
  }

  // ─── Generate Full Prompt Library from Analysis ─────────────────────────
  async generateAnalysisPrompts(analysisId, strategyId, userId) {
    const { rows: [analysis] } = await pool.query(
      `SELECT analysis_data, trending_topics, reference_accounts FROM profile_analyses WHERE id = $1`,
      [analysisId]
    );

    if (!analysis) throw new Error('Analysis not found');

    const { rows: [strategy] } = await pool.query(
      `SELECT * FROM user_strategies WHERE id = $1`,
      [strategyId]
    );

    const analysisData = typeof analysis.analysis_data === 'string'
      ? JSON.parse(analysis.analysis_data)
      : analysis.analysis_data || {};

    const trending = typeof analysis.trending_topics === 'string'
      ? JSON.parse(analysis.trending_topics)
      : analysis.trending_topics || [];

    const refAccounts = typeof analysis.reference_accounts === 'string'
      ? JSON.parse(analysis.reference_accounts)
      : analysis.reference_accounts || [];

    const prompts = await this.generatePromptLibrary(analysisData, trending, refAccounts, strategy);

    // Store prompts in strategy_prompts table
    if (prompts.length > 0 && strategyId) {
      const insertValues = [];
      const insertParams = [];
      let paramIdx = 1;

      for (const prompt of prompts) {
        insertValues.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        insertParams.push(
          strategyId,
          prompt.prompt_text || '',
          prompt.category || 'educational',
          JSON.stringify({
            ...(prompt.variables || {}),
            reason: prompt.reason || '',
            source: prompt.source || 'niche_fit',
            generated_from_analysis: analysisId,
          })
        );
      }

      // Clear old analysis-generated prompts first
      await pool.query(
        `DELETE FROM strategy_prompts WHERE strategy_id = $1 AND variables->>'generated_from_analysis' IS NOT NULL`,
        [strategyId]
      );

      await pool.query(
        `INSERT INTO strategy_prompts (strategy_id, prompt_text, category, variables)
         VALUES ${insertValues.join(', ')}`,
        insertParams
      );
    }

    // Mark strategy as active
    await pool.query(
      `UPDATE user_strategies SET status = 'active', metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [
        JSON.stringify({
          basic_profile_completed: true,
          analysis_prompts_generated: true,
          analysis_prompts_generated_at: new Date().toISOString(),
          prompt_count: prompts.length,
        }),
        strategyId,
      ]
    );

    return { prompts, count: prompts.length };
  }

  // ─── Get Analysis Status ───────────────────────────────────────────────
  async getAnalysis(analysisId) {
    const { rows: [analysis] } = await pool.query(
      `SELECT * FROM profile_analyses WHERE id = $1`,
      [analysisId]
    );
    return analysis || null;
  }

  async getLatestAnalysis(userId, strategyId) {
    const { rows: [analysis] } = await pool.query(
      `SELECT * FROM profile_analyses 
       WHERE user_id = $1 AND ($2::uuid IS NULL OR strategy_id = $2)
       ORDER BY created_at DESC LIMIT 1`,
      [userId, strategyId || null]
    );
    return analysis || null;
  }

  // ─── Update Extra Context ──────────────────────────────────────────────
  async updateExtraContext(strategyId, deeperUrl, deeperContext) {
    console.log(`[ProfileAnalysis] Updating extra context for strategy ${strategyId}`);
    
    // Fetch portfolio content if URL provided
    let portfolioContent = null;
    if (deeperUrl) {
      try {
        console.log(`[ProfileAnalysis] Fetching deeper URL: ${deeperUrl}`);
        const response = await axios.get(deeperUrl, { timeout: 10000 });
        if (response.status === 200 && response.data) {
          const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
          const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          portfolioContent = cleanText.substring(0, 3000);
          console.log(`[ProfileAnalysis] Deeper URL fetched: ${portfolioContent.length} chars`);
        }
      } catch (err) {
        console.log(`[ProfileAnalysis] Failed to fetch deeper URL:`, err.message);
      }
    }

    // Build extra context string
    const extraContextParts = [];
    if (portfolioContent) {
      extraContextParts.push(`Additional website content:\n${portfolioContent}`);
    }
    if (deeperContext) {
      extraContextParts.push(`Additional user context: ${deeperContext}`);
    }

    const extraContext = extraContextParts.join('\n\n');

    // Update strategy metadata
    await pool.query(
      `UPDATE user_strategies 
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, 
           updated_at = NOW() 
       WHERE id = $2`,
      [
        JSON.stringify({
          deeper_url: deeperUrl || null,
          deeper_context: deeperContext || null,
          deeper_portfolio_content: portfolioContent || null,
          extra_context: extraContext || null,
        }),
        strategyId,
      ]
    );

    console.log(`[ProfileAnalysis] Extra context updated successfully`);
  }

  // ─── Utility Methods ───────────────────────────────────────────────────
  normaliseTweetsForAnalysis(tweets) {
    return tweets.map((t) => ({
      text: (t.text || t.content || '').slice(0, 300),
      likes: t.likes || 0,
      retweets: t.retweets || 0,
      replies: t.replies || 0,
      impressions: t.impressions || 0,
      engagement: (t.likes || 0) + (t.retweets || 0) * 2 + (t.replies || 0) * 1.5,
    }));
  }

  getTopPerformingTweets(tweets, count = 5) {
    const normalised = this.normaliseTweetsForAnalysis(tweets);
    return normalised
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, count);
  }

  getBottomPerformingTweets(tweets, count = 3) {
    const normalised = this.normaliseTweetsForAnalysis(tweets);
    return normalised
      .filter((t) => t.engagement > 0) // exclude zero-engagement
      .sort((a, b) => a.engagement - b.engagement)
      .slice(0, count);
  }

  analyseTimingPatterns(tweets) {
    const dayCount = {};
    const hourCount = {};

    for (const tweet of tweets) {
      if (!tweet.created_at) continue;
      const date = new Date(tweet.created_at);
      const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()];
      const hour = date.getUTCHours();

      dayCount[day] = (dayCount[day] || 0) + 1;
      hourCount[hour] = (hourCount[hour] || 0) + 1;
    }

    const bestDays = Object.entries(dayCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([day]) => day);

    const sortedHours = Object.entries(hourCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => Number(hour));

    const bestHours = sortedHours.length > 0
      ? `${this.formatHour(Math.min(...sortedHours))}-${this.formatHour(Math.max(...sortedHours) + 1)}`
      : 'Unknown';

    return { bestDays, bestHours };
  }

  analyseContentPatterns(tweets) {
    const lengths = tweets.map((t) => (t.text || t.content || '').length);
    const avgLength = lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
    const threads = tweets.filter((t) => (t.text || t.content || '').includes('🧵') || (t.text || t.content || '').length > 250);
    const hashtags = tweets.filter((t) => (t.text || t.content || '').includes('#'));

    return {
      avgLength,
      threadRatio: tweets.length > 0 ? Math.round((threads.length / tweets.length) * 100) : 0,
      hashtagUsage: tweets.length > 0 ? Math.round((hashtags.length / tweets.length) * 100) : 0,
    };
  }

  formatHour(hour) {
    const h = ((hour % 24) + 24) % 24;
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
  }

  async callGemini(prompt, maxTokens = ANALYSIS_MAX_TOKENS, temperature = ANALYSIS_TEMPERATURE) {
    const start = Date.now();
    console.log(`[ProfileAnalysis][Gemini] Calling ${GEMINI_MODEL} (tokens=${maxTokens}, temp=${temperature}, promptLen=${prompt.length})`);
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
    console.log(`[ProfileAnalysis][Gemini] Response received in ${Date.now() - start}ms, content length: ${content?.length || 0}`);
    if (!content) {
      console.error(`[ProfileAnalysis][Gemini] Empty response! Full response:`, JSON.stringify(response.data).substring(0, 500));
      throw new Error('Empty response from Gemini');
    }
    console.log(`[ProfileAnalysis][Gemini] Response preview: ${content.substring(0, 150)}...`);
    return content;
  }

  parseGeminiJSON(text) {
    console.log(`[ProfileAnalysis][Parse] Parsing Gemini JSON (${text.length} chars)`);
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (firstError) {
      console.log(`[ProfileAnalysis][Parse] First parse failed, attempting repairs...`);
      
      // Try to extract JSON object
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (secondError) {
          // Try to repair common JSON issues
          let repaired = match[0]
            .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
            .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // Quote unquoted keys
            .replace(/:\s*'([^']*)'/g, ':"$1"')  // Replace single quotes with double quotes
            .replace(/\n/g, ' ')  // Remove newlines
            .replace(/\r/g, '')  // Remove carriage returns
            .replace(/\t/g, ' ');  // Replace tabs with spaces
          
          try {
            return JSON.parse(repaired);
          } catch (thirdError) {
            console.error(`[ProfileAnalysis][Parse] All repair attempts failed. Original error:`, firstError.message);
            console.error(`[ProfileAnalysis][Parse] Text preview:`, cleaned.substring(0, 500));
            throw new Error('Failed to parse Gemini JSON response after repair attempts');
          }
        }
      }
      throw new Error('Failed to parse Gemini JSON response');
    }
  }

  parseGeminiJSONArray(text) {
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
      if (match) {
        return JSON.parse(match[0]);
      }
      return [];
    }
  }
}

export const profileAnalysisService = new ProfileAnalysisService();
