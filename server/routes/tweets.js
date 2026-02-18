import express from 'express';
const router = express.Router();
import { TwitterApi } from 'twitter-api-v2';
import fetch from 'node-fetch';
import pool from '../config/database.js';
import { validateRequest } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { tweetSchema, aiGenerateSchema } from '../middleware/validation.js';
import { creditService } from '../services/creditService.js';
import { aiService } from '../services/aiService.js';
import { mediaService } from '../services/mediaService.js';
import { logger } from '../utils/logger.js';
import {
  DELETED_TWEET_RETENTION_DAYS,
  ensureTweetDeletionRetentionSchema,
  getTweetDeletionRetentionWindow,
  getTweetDeletionVisibilityClause,
  markTweetDeleted,
  purgeExpiredDeletedTweets,
} from '../services/tweetRetentionService.js';
import { decodeHTMLEntities } from '../utils/decodeHTMLEntities.js';
import { buildReconnectRequiredPayload, buildTwitterScopeFilter, resolveTwitterScope } from '../utils/twitterScopeResolver.js';


// Bulk save generated tweets/threads as drafts
router.post('/bulk-save', validateTwitterConnection, async (req, res) => {
  try {
    const { items } = req.body;
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to save' });
    }
    
    const accountId = twitterAccount.isTeamAccount ? twitterAccount.id : null;
    const authorId = twitterAccount.twitter_user_id || null;
    
    const saved = [];
    for (const item of items) {
      const { text, isThread, threadParts } = item;
      const { rows } = await pool.query(
        `INSERT INTO tweets (user_id, account_id, author_id, content, is_thread, thread_parts, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW())
         RETURNING *`,
        [userId, accountId, authorId, text, !!isThread, isThread ? JSON.stringify(threadParts) : null]
      );
      saved.push(rows[0]);
    }
    res.json({ success: true, saved });
  } catch (error) {
    logger.error('Bulk save error', { error });
    res.status(500).json({ error: 'Failed to save generated content' });
  }
});


const THREAD_POST_DELAY_MS = Number.parseInt(process.env.THREAD_POST_DELAY_MS || '900', 10);
const THREAD_POST_DELAY_JITTER_MS = Number.parseInt(process.env.THREAD_POST_DELAY_JITTER_MS || '300', 10);
const THREAD_LARGE_SIZE_THRESHOLD = Number.parseInt(process.env.THREAD_LARGE_SIZE_THRESHOLD || '6', 10);
const TWITTER_RATE_LIMIT_MAX_RETRIES = Number.parseInt(process.env.TWITTER_RATE_LIMIT_MAX_RETRIES || '2', 10);
const TWITTER_RATE_LIMIT_WAIT_MS = Number.parseInt(process.env.TWITTER_RATE_LIMIT_WAIT_MS || '60000', 10);
const TWITTER_RATE_LIMIT_MAX_WAIT_MS = Number.parseInt(process.env.TWITTER_RATE_LIMIT_MAX_WAIT_MS || '300000', 10);

// Timeout for cross-post requests to LinkedIn Genie (ms)
const LINKEDIN_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.LINKEDIN_CROSSPOST_TIMEOUT_MS || '10000', 10);

function getThreadPostDelayMs() {
  const baseDelay = Number.isFinite(THREAD_POST_DELAY_MS) ? Math.max(0, THREAD_POST_DELAY_MS) : 900;
  const jitter = Number.isFinite(THREAD_POST_DELAY_JITTER_MS) ? Math.max(0, THREAD_POST_DELAY_JITTER_MS) : 300;
  if (!jitter) return baseDelay;
  return baseDelay + Math.floor(Math.random() * (jitter + 1));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHeaderValue(headers, headerName) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    return headers.get(headerName) ?? headers.get(headerName.toLowerCase());
  }
  return headers[headerName] ?? headers[headerName.toLowerCase()];
}

function isRateLimitedError(error) {
  const message = `${error?.message || ''} ${error?.data?.detail || ''}`.toLowerCase();
  return (
    error?.code === 429 ||
    error?.status === 429 ||
    error?.data?.status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes(' 429')
  );
}

function isUnauthorizedError(error) {
  const message = `${error?.message || ''} ${error?.data?.detail || ''}`.toLowerCase();
  return (
    error?.code === 401 ||
    error?.status === 401 ||
    error?.data?.status === 401 ||
    message.includes(' 401') ||
    message.includes('unauthorized') ||
    message.includes('invalid or expired token') ||
    message.includes('invalid token')
  );
}

function isTwitterNotFoundError(error) {
  const message = `${error?.message || ''} ${error?.data?.detail || ''}`.toLowerCase();
  return (
    error?.code === 404 ||
    error?.status === 404 ||
    error?.data?.status === 404 ||
    message.includes('not found') ||
    message.includes('resource-not-found')
  );
}

function getRateLimitWaitMs(error, fallbackMs = TWITTER_RATE_LIMIT_WAIT_MS) {
  const headers = error?.headers || error?.response?.headers || null;
  const retryAfterRaw = Number(getHeaderValue(headers, 'retry-after'));
  if (Number.isFinite(retryAfterRaw) && retryAfterRaw > 0) {
    return Math.min(retryAfterRaw * 1000, TWITTER_RATE_LIMIT_MAX_WAIT_MS);
  }

  const resetRaw = Number(error?.rateLimit?.reset || getHeaderValue(headers, 'x-rate-limit-reset'));
  if (Number.isFinite(resetRaw) && resetRaw > 0) {
    const resetMs = Math.max(1000, resetRaw * 1000 - Date.now());
    return Math.min(resetMs, TWITTER_RATE_LIMIT_MAX_WAIT_MS);
  }

  const safeFallback = Number.isFinite(fallbackMs) && fallbackMs > 0 ? fallbackMs : 60000;
  return Math.min(safeFallback, TWITTER_RATE_LIMIT_MAX_WAIT_MS);
}

async function withRateLimitRetry(operation, { label, retries = TWITTER_RATE_LIMIT_MAX_RETRIES, fallbackWaitMs = TWITTER_RATE_LIMIT_WAIT_MS } = {}) {
  const maxRetries = Number.isFinite(retries) && retries >= 0 ? retries : 0;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitedError(error) || attempt >= maxRetries) {
        throw error;
      }

      const waitMs = getRateLimitWaitMs(error, fallbackWaitMs);
      logger.warn(`[TwitterRateLimit][${label || 'tweet'}] 429 on attempt ${attempt + 1}/${maxRetries + 1}. Waiting ${waitMs}ms before retry.`);
      await wait(waitMs);
    }
  }
}

function getAdaptiveThreadDelayMs({ index, totalParts, mediaCount = 0 }) {
  let delayMs = getThreadPostDelayMs();

  if (Number.isFinite(totalParts) && totalParts > THREAD_LARGE_SIZE_THRESHOLD) {
    delayMs += Math.min(2500, (totalParts - THREAD_LARGE_SIZE_THRESHOLD) * 250);
  }

  if (Number.isFinite(mediaCount) && mediaCount > 0) {
    delayMs += Math.min(2000, mediaCount * 400);
  }

  if (Number.isFinite(index) && index > 5) {
    delayMs += 300;
  }

  return Math.min(delayMs, TWITTER_RATE_LIMIT_MAX_WAIT_MS);
}

// ── LinkedIn cross-post helper ────────────────────────────────────────────────
async function crossPostToLinkedIn({ userId, content, tweetUrl }) {
  const linkedinGenieUrl = process.env.LINKEDIN_GENIE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;

  // Diagnostic: log configured endpoint and whether an internal key is present
  logger.info('[LinkedIn Cross-post] URL', { url: linkedinGenieUrl });
  logger.info('[LinkedIn Cross-post] Key set', { hasKey: !!internalApiKey });

  if (!linkedinGenieUrl || !internalApiKey) {
    logger.warn('LinkedIn Cross-post skipped: missing LINKEDIN_GENIE_URL or INTERNAL_API_KEY');
    return 'skipped';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LINKEDIN_CROSSPOST_TIMEOUT_MS);

    const liRes = await fetch(`${linkedinGenieUrl}/api/internal/cross-post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'tweet-genie',
        'x-platform-user-id': String(userId),
      },
      body: JSON.stringify({ content, tweetUrl }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const liBody = await liRes.json().catch(() => ({}));

    if (liRes.status === 404 && liBody.code === 'LINKEDIN_NOT_CONNECTED') {
      logger.warn('LinkedIn Cross-post: user has no LinkedIn account connected', { userId });
      return 'not_connected';
    }

    if (!liRes.ok) {
      logger.warn('[LinkedIn Cross-post] Failed', { status: liRes.status, body: liBody });
      return 'failed';
    }

    logger.info('[LinkedIn Cross-post] Success', { userId });
    return 'posted';
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('[LinkedIn Cross-post] Timeout reached', { timeoutMs: LINKEDIN_CROSSPOST_TIMEOUT_MS, userId });
      return 'timeout';
    }
    const errInfo = {
      name: err?.name || 'Error',
      message: err?.message || String(err),
    };
    try {
      if (err?.stack && typeof err.stack === 'string') {
        errInfo.stack = err.stack.split('\n').slice(0, 6).join('\n');
      }
    } catch (e) {
      // ignore stack formatting errors
    }
    logger.error('[LinkedIn Cross-post] Request error', errInfo);
    return 'failed';
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Post a tweet
router.post('/', validateRequest(tweetSchema), validateTwitterConnection, async (req, res) => {
  try {
    const { content, media, thread, threadMedia, postToLinkedin } = req.body;
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

    logger.info('[POST /tweets] Tweet request', { 
      userId, 
      accountId: twitterAccount?.id,
      hasContent: !!content,
      hasThread: !!thread,
      hasMedia: !!media,
      threadLength: thread?.length,
      postToLinkedin: !!postToLinkedin,
    });

    logger.debug('Tweet posting is free - no credits deducted');

    const twitterClient = new TwitterApi(twitterAccount.access_token);
    let tweetResponse;
    let threadTweets = [];

    try {
      // Handle media upload if present
      let mediaIds = [];
      if (media && media.length > 0) {
        logger.info('Media detected, attempting upload');
        
        if (!twitterAccount.oauth1_access_token || !twitterAccount.oauth1_access_token_secret) {
          throw {
            code: 'OAUTH1_REQUIRED',
            message: 'Media uploads require OAuth 1.0a authentication. Please reconnect your Twitter account.',
            details: 'Go to Settings > Twitter Account and reconnect to enable media uploads.'
          };
        }
        
        const oauth1Tokens = {
          accessToken: twitterAccount.oauth1_access_token,
          accessTokenSecret: twitterAccount.oauth1_access_token_secret
        };
        
        mediaIds = await withRateLimitRetry(
          () => mediaService.uploadMedia(media, twitterClient, oauth1Tokens),
          { label: 'single-media-upload' }
        );
        logger.info('Media upload completed', { mediaIds });
      }

      if (thread && thread.length > 0) {
        let firstTweetMediaIds = [];
        if (threadMedia && threadMedia[0] && threadMedia[0].length > 0) {
          if (!twitterAccount.oauth1_access_token || !twitterAccount.oauth1_access_token_secret) {
            throw {
              code: 'OAUTH1_REQUIRED',
              message: 'Media uploads require OAuth 1.0a authentication. Please reconnect your Twitter account.',
              details: 'Go to Settings > Twitter Account and reconnect to enable media uploads.'
            };
          }
          const oauth1Tokens = {
            accessToken: twitterAccount.oauth1_access_token,
            accessTokenSecret: twitterAccount.oauth1_access_token_secret
          };
          firstTweetMediaIds = await withRateLimitRetry(
            () => mediaService.uploadMedia(threadMedia[0], twitterClient, oauth1Tokens),
            { label: 'thread-main-media-upload' }
          );
        }
        const firstTweetData = {
          text: decodeHTMLEntities(thread[0]),
          ...(firstTweetMediaIds.length > 0 && { media: { media_ids: firstTweetMediaIds } })
        };
        tweetResponse = await withRateLimitRetry(
          () => twitterClient.v2.tweet(firstTweetData),
          { label: 'thread-main-post' }
        );
        logger.info('First thread tweet posted', {
          tweetId: tweetResponse.data?.id,
          textPreview: tweetResponse.data?.text ? `${tweetResponse.data.text.substring(0, 50)}...` : '[no text]'
        });

        const postRemainingTweets = async () => {
          let previousTweetId = tweetResponse.data.id;

          for (let i = 1; i < thread.length; i++) {
            try {
              const mediaCountForTweet = Array.isArray(threadMedia?.[i]) ? threadMedia[i].length : 0;
              const shouldThrottle = i > 1 || thread.length > THREAD_LARGE_SIZE_THRESHOLD || mediaCountForTweet > 0;

              if (shouldThrottle) {
                const delayMs = getAdaptiveThreadDelayMs({
                  index: i,
                  totalParts: thread.length,
                  mediaCount: mediaCountForTweet,
                });
                logger.debug('Background waiting before posting tweet', { delayMs, index: i + 1, total: thread.length });
                await wait(delayMs);
              }

              const threadTweetText = thread[i];
              let threadMediaIds = [];
              
              if (threadMedia && threadMedia[i] && threadMedia[i].length > 0) {
                logger.debug('Background uploading media for thread tweet', { index: i + 1 });
                const oauth1Tokens = {
                  accessToken: twitterAccount.oauth1_access_token,
                  accessTokenSecret: twitterAccount.oauth1_access_token_secret
                };
                threadMediaIds = await withRateLimitRetry(
                  () => mediaService.uploadMedia(threadMedia[i], twitterClient, oauth1Tokens),
                  { label: `thread-media-upload-${i + 1}` }
                );
                logger.debug('Background media upload completed', { index: i + 1, threadMediaIds });
              }

              const threadTweetData = {
                text: decodeHTMLEntities(threadTweetText),
                reply: { in_reply_to_tweet_id: previousTweetId },
                ...(threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
              };

              const threadResponse = await withRateLimitRetry(
                () => twitterClient.v2.tweet(threadTweetData),
                { label: `thread-reply-post-${i + 1}` }
              );
              threadTweets.push(threadResponse.data);
              previousTweetId = threadResponse.data.id;
              
              logger.info('Background thread tweet posted', { index: i + 1, tweetId: threadResponse.data.id });
              
              const accountId = twitterAccount.isTeamAccount ? twitterAccount.id : null;
              const authorId = twitterAccount.twitter_user_id || null;
              const threadTweetMediaUrls = threadMedia && threadMedia[i] ? threadMedia[i] : [];
              
              await pool.query(
                `INSERT INTO tweets (
                  user_id, account_id, author_id, tweet_id, content, 
                  media_urls, credits_used, 
                  impressions, likes, retweets, replies, status, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, 'posted', 'platform')`,
                [
                  userId,
                  accountId,
                  authorId,
                  threadResponse.data.id,
                  threadTweetText,
                  JSON.stringify(threadTweetMediaUrls),
                  0
                ]
              );
            } catch (error) {
              logger.error('Background failed to post thread tweet', { index: i + 1, error: error.message });
              if (isRateLimitedError(error)) {
                const waitMs = getRateLimitWaitMs(error);
                const waitSeconds = Math.ceil(waitMs / 1000);
                logger.error('Background rate limit hit, stopping', { waitSeconds });
                break;
              }
            }
          }
          
          logger.info('Background thread posting complete', { posted: threadTweets.length + 1, total: thread.length });
        };

        postRemainingTweets().catch(err => {
          logger.error('Background thread posting error', { error: err });
        });

      } else {
        logger.debug('Preparing single tweet data');
        const tweetData = {
          text: decodeHTMLEntities(content),
          ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
        };

        tweetResponse = await withRateLimitRetry(
          () => twitterClient.v2.tweet(tweetData),
          { label: 'single-post' }
        );
        logger.info('Single tweet posted', {
          tweetId: tweetResponse.data?.id,
          textPreview: tweetResponse.data?.text ? `${tweetResponse.data.text.substring(0, 50)}...` : '[no text]'
        });
      }

      // Store tweet in database
      const mainContent = thread && thread.length > 0 ? thread[0] : content;
      const accountId = twitterAccount.isTeamAccount ? twitterAccount.id : null;
      const authorId = twitterAccount.twitter_user_id || null;
      
      const { rows } = await pool.query(
        `INSERT INTO tweets (
          user_id, account_id, author_id, tweet_id, content, 
          media_urls, thread_tweets, credits_used, 
          impressions, likes, retweets, replies, status, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 0, 'posted', 'platform')
        RETURNING *`,
        [
          userId,
          accountId,
          authorId,
          tweetResponse.data.id,
          mainContent,
          JSON.stringify(thread && thread.length > 0 && threadMedia && threadMedia[0] ? threadMedia[0] : (media || [])),
          JSON.stringify(threadTweets),
          0
        ]
      );

      // ── LinkedIn cross-post (fire and forget after Twitter success) ──────────
      let linkedinStatus = null;
      if (postToLinkedin === true) {
        const postContent = thread && thread.length > 0
          ? thread.join('\n\n')
          : content;

        // Fire-and-forget: don't await cross-post so we don't delay the tweet response
        (async () => {
          try {
            const status = await crossPostToLinkedIn({
              userId,
              content: postContent,
              tweetUrl: `https://twitter.com/${twitterAccount.username}/status/${tweetResponse.data.id}`,
            });
            logger.info('Background LinkedIn cross-post completed', { userId, status });
          } catch (err) {
            logger.warn('Background LinkedIn cross-post error', { userId, error: err?.message || String(err) });
          }
        })();

        // indicate pending to client immediately
        linkedinStatus = 'pending';
      }
      // ─────────────────────────────────────────────────────────────────────────

      res.json({
        success: true,
        tweet: {
          id: rows[0].id,
          tweet_id: tweetResponse.data.id,
          content: mainContent,
          url: `https://twitter.com/${twitterAccount.username}/status/${tweetResponse.data.id}`,
          credits_used: 0,
          thread_count: thread ? thread.length : 1,
          thread_status: thread && thread.length > 1
            ? 'First tweet posted, remaining tweets posting in background...'
            : 'Posted',
        },
        // null = toggle was off
        // 'posted' = cross-posted successfully
        // 'not_connected' = no LinkedIn account linked
        // 'failed' = LinkedIn API error (tweet still posted fine)
        // 'skipped' = env vars missing
        linkedin: linkedinStatus,
      });

    } catch (twitterError) {
      logger.warn('Twitter API error occurred - no credits to refund');
      
      const isRateLimitError = isRateLimitedError(twitterError);
      const is401Error = isUnauthorizedError(twitterError);
      const is403Error = twitterError.code === 403 || 
                        twitterError.message?.includes('403') ||
                        twitterError.toString().includes('403');
      
      if (isRateLimitError) {
        logger.warn('Rate limit detected - Twitter API returned 429');
        
        const retryAfterMs = getRateLimitWaitMs(twitterError);
        const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
        const resetTime = new Date(Date.now() + retryAfterMs);
        
        const postedCount = (threadTweets?.length || 0) + 1;
        const hasPartialSuccess = threadTweets && threadTweets.length > 0;
        
        return res.status(429).json({
          error: `Twitter rate limit reached${hasPartialSuccess ? ` after posting ${postedCount} tweets in thread` : ''}. Please wait ${retryAfterMinutes} minutes before posting again.`,
          code: 'TWITTER_RATE_LIMIT',
          details: twitterError.message,
          retryAfter: resetTime?.toISOString() || 'unknown',
          retryMinutes: retryAfterMinutes,
          partialSuccess: hasPartialSuccess,
          postedTweets: hasPartialSuccess ? postedCount : 0,
          totalTweets: thread?.length || 1
        });
      } else if (is401Error) {
        throw {
          code: 'TWITTER_AUTH_EXPIRED',
          message: 'Twitter session expired or revoked. Please reconnect your account.',
          details: twitterError.message
        };
      } else if (is403Error) {
        throw {
          code: 'TWITTER_PERMISSIONS_ERROR',
          message: 'Twitter permissions expired. Please reconnect your account.',
          details: twitterError.message
        };
      } else {
        throw {
          code: 'TWITTER_API_ERROR',
          message: 'Failed to post tweet',
          details: twitterError.message
        };
      }
    }

  } catch (error) {
    logger.error('Post tweet error', { error });
    
    if (error.code === 'TWITTER_PERMISSIONS_ERROR') {
      return res.status(403).json({ 
        error: error.message,
        code: 'TWITTER_PERMISSIONS_ERROR',
        details: error.details,
        action: 'reconnect_twitter'
      });
    }

    if (error.code === 'TWITTER_AUTH_EXPIRED') {
      return res.status(401).json(
        buildReconnectRequiredPayload({
          reason: 'token_invalid_or_revoked',
          details: error.details || error.message,
        })
      );
    }
    
    if (error.code === 'TWITTER_API_ERROR') {
      return res.status(400).json({ 
        error: error.message,
        code: 'TWITTER_API_ERROR',
        details: error.details
      });
    }
    
    if (error.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: error.required,
        available: error.available
      });
    }
    
    res.status(500).json({ error: 'Failed to post tweet' });
  }
});

// Generate AI tweet content
router.post('/ai-generate', validateRequest(aiGenerateSchema), async (req, res) => {
  try {
    const { prompt, provider, style, hashtags, mentions, max_tweets } = req.body;
    const userId = req.user.id;

    const creditCost = 1.2;

    let userToken = null;
    
    const setCookieHeader = res.getHeaders()['set-cookie'];
    if (setCookieHeader) {
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      const accessTokenCookie = cookies.find(cookie => 
        typeof cookie === 'string' && cookie.startsWith('accessToken=')
      );
      if (accessTokenCookie) {
        userToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
        logger.debug('Using refreshed token from response header for AI generation');
      }
    }
    
    if (!userToken) {
      userToken = req.cookies?.accessToken;
      if (!userToken) {
        const authHeader = req.headers['authorization'];
        userToken = authHeader && authHeader.split(' ')[1];
      }
      logger.debug('Using token from request for AI generation');
    }

    const creditCheck = await creditService.checkAndDeductCredits(userId, 'ai_generation', creditCost, userToken);
    if (!creditCheck.success) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        required: creditCost,
        available: creditCheck.available
      });
    }

    try {
      const generatedTweets = await aiService.generateTweets({
        prompt,
        provider,
        style,
        hashtags,
        mentions,
        max_tweets,
        userId
      });

      await pool.query(
        `INSERT INTO ai_generations (
          user_id, prompt, provider, generated_content, 
          credits_used, status
        ) VALUES ($1, $2, $3, $4, $5, 'completed')`,
        [
          userId,
          prompt,
          provider,
          JSON.stringify(generatedTweets),
          creditCost
        ]
      );

      res.json({
        success: true,
        tweets: generatedTweets,
        credits_used: creditCost
      });

    } catch (aiError) {
      logger.info('Attempting to refund credits due to AI generation error');
      try {
        await creditService.refundCredits(userId, 'ai_generation_failed', creditCost, userToken);
      } catch (refundError) {
        logger.warn('Refund failed (non-critical)', { error: refundError.message });
      }
      throw aiError;
    }

  } catch (error) {
    logger.error('AI generation error', { error });
    res.status(500).json({ error: 'Failed to generate AI content' });
  }
});

// Get user's tweets
router.get(['/history', '/'], async (req, res) => {
  let sqlQuery = '';
  let countQuery = '';
  let queryParams = [];
  
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { page = 1, limit = 20, status } = req.query;
    const userId = req.user.id;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const requestTeamId = req.headers['x-team-id'] || null;
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    const parsedOffset = (safePage - 1) * safeLimit;
    await ensureTweetDeletionRetentionSchema();
    await purgeExpiredDeletedTweets({ userId });
    const twitterScope = await resolveTwitterScope(pool, { userId, selectedAccountId, teamId: requestTeamId });
    const retention = getTweetDeletionRetentionWindow();

    if (!twitterScope.connected && twitterScope.mode === 'personal') {
      return res.json({
        disconnected: true,
        tweets: [],
        retention: getTweetDeletionRetentionWindow(),
        pagination: {
          page: safePage,
          limit: safeLimit,
          total: 0,
          pages: 0,
        },
      });
    }

    let countParams = [];

    if (twitterScope.mode === 'team') {
      const { clause: teamScopeClause, params: teamScopeParams } = buildTwitterScopeFilter({
        scope: twitterScope,
        alias: 't',
        startIndex: 1,
        includeLegacyPersonalFallback: false,
        includeTeamOrphanFallback: true,
        orphanUserId: userId,
      });

      let whereClause = `WHERE 1=1${teamScopeClause}`;
      queryParams = [...teamScopeParams];
      countParams = [...teamScopeParams];

      if (status) {
        whereClause += ` AND t.status = $${queryParams.length + 1}`;
        queryParams.push(status);
        countParams.push(status);
      }

      const retentionParamIndex = queryParams.length + 1;
      whereClause += getTweetDeletionVisibilityClause({
        alias: 't',
        retentionDaysParamIndex: retentionParamIndex,
      });
      queryParams.push(DELETED_TWEET_RETENTION_DAYS);
      countParams.push(DELETED_TWEET_RETENTION_DAYS);

      sqlQuery = `
        SELECT t.*, 
                ta.twitter_username as username, 
                ta.twitter_display_name as display_name,
                CASE 
                  WHEN t.source = 'external' THEN t.external_created_at
                  ELSE t.created_at
                END as display_created_at
        FROM tweets t
        LEFT JOIN team_accounts ta ON t.account_id::TEXT = ta.id::TEXT
        ${whereClause}
        ORDER BY 
          CASE 
            WHEN t.source = 'external' THEN t.external_created_at
            ELSE t.created_at
          END DESC
        LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
      `;

      countQuery = `SELECT COUNT(*) FROM tweets t ${whereClause}`;
      queryParams.push(safeLimit, parsedOffset);

    } else {
      queryParams = [userId];
      countParams = [userId];
      const { clause: personalScopeClause, params: personalScopeParams } = buildTwitterScopeFilter({
        scope: twitterScope,
        alias: 't',
        startIndex: queryParams.length + 1,
        includeLegacyPersonalFallback: true,
        includeTeamOrphanFallback: false,
        orphanUserId: userId,
      });
      queryParams.push(...personalScopeParams);
      countParams.push(...personalScopeParams);

      let whereClause = `WHERE t.user_id = $1${personalScopeClause}`;
      if (status) {
        whereClause += ` AND t.status = $${queryParams.length + 1}`;
        queryParams.push(status);
        countParams.push(status);
      }

      const retentionParamIndex = queryParams.length + 1;
      whereClause += getTweetDeletionVisibilityClause({
        alias: 't',
        retentionDaysParamIndex: retentionParamIndex,
      });
      queryParams.push(DELETED_TWEET_RETENTION_DAYS);
      countParams.push(DELETED_TWEET_RETENTION_DAYS);

      sqlQuery = `
        SELECT t.*, 
                ta.twitter_username as username, 
                ta.twitter_display_name as display_name,
                CASE 
                  WHEN t.source = 'external' THEN t.external_created_at
                  ELSE t.created_at
                END as display_created_at
        FROM tweets t
        LEFT JOIN twitter_auth ta ON t.user_id = ta.user_id
        ${whereClause}
        ORDER BY 
          CASE 
            WHEN t.source = 'external' THEN t.external_created_at
            ELSE t.created_at
          END DESC
        LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
      `;

      countQuery = `SELECT COUNT(*) FROM tweets t ${whereClause}`;
      queryParams.push(safeLimit, parsedOffset);
    }

    const { rows } = await pool.query(sqlQuery, queryParams);
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = Number.parseInt(countResult.rows[0].count, 10) || 0;

    res.json({
      disconnected: false,
      tweets: rows,
      retention,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0,
      }
    });

    logger.info('Returned tweets history', { count: rows.length });

  } catch (error) {
    logger.error('GET /tweets/history error', { error });
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Database connection failed', 
        details: 'Unable to connect to the database. Please try again later.',
        code: error.code
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch tweets', 
      details: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
});

// Delete a tweet
router.delete('/:tweetId', validateTwitterConnection, async (req, res) => {
  try {
    const { tweetId } = req.params;
    const userId = req.user.id;

    let { rows } = await pool.query(
      'SELECT * FROM tweets WHERE id = $1 AND user_id = $2',
      [tweetId, userId]
    );

    let tweet = rows[0];

    if (!tweet) {
      const teamTweetResult = await pool.query(`
        SELECT t.* FROM tweets t
        INNER JOIN team_accounts ta ON t.account_id = ta.id
        INNER JOIN team_members tm ON ta.team_id = tm.team_id
        WHERE t.id = $1 AND tm.user_id = $2 AND tm.status = 'active'
      `, [tweetId, userId]);
      if (teamTweetResult.rows.length === 0) {
        return res.status(404).json({ error: 'Tweet not found or not authorized' });
      }
      tweet = teamTweetResult.rows[0];
    }

    await ensureTweetDeletionRetentionSchema();

    const twitterClient = new TwitterApi(req.twitterAccount.access_token);

    try {
      await twitterClient.v2.deleteTweet(tweet.tweet_id);

      const deletedRow = await markTweetDeleted(tweetId);
      const retention = getTweetDeletionRetentionWindow();
      const deletedAt = deletedRow?.deleted_at || new Date().toISOString();
      const deleteAfter = new Date(
        new Date(deletedAt).getTime() + retention.days * 24 * 60 * 60 * 1000
      ).toISOString();

      res.json({
        success: true,
        message: `Tweet deleted. It will remain in history for ${retention.days} days before cleanup.`,
        status: 'deleted',
        deletedAt,
        deleteAfter,
        retention,
      });

    } catch (twitterError) {
      logger.error('Twitter delete error', { error: twitterError });

      if (isTwitterNotFoundError(twitterError)) {
        const deletedRow = await markTweetDeleted(tweetId);
        const retention = getTweetDeletionRetentionWindow();
        const deletedAt = deletedRow?.deleted_at || new Date().toISOString();
        const deleteAfter = new Date(
          new Date(deletedAt).getTime() + retention.days * 24 * 60 * 60 * 1000
        ).toISOString();

        return res.json({
          success: true,
          message: `Tweet was already removed on Twitter. Keeping a deleted record for ${retention.days} days.`,
          status: 'deleted',
          deletedAt,
          deleteAfter,
          retention,
        });
      }

      res.status(400).json({ error: 'Failed to delete tweet from Twitter' });
    }

  } catch (error) {
    logger.error('Delete tweet error', { error });
    res.status(500).json({ error: 'Failed to delete tweet' });
  }
});

export default router;