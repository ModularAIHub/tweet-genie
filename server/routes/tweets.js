const router = express.Router();
import { decodeHTMLEntities } from '../utils/decodeHTMLEntities.js';
import { buildReconnectRequiredPayload, buildTwitterScopeFilter, resolveTwitterScope } from '../utils/twitterScopeResolver.js';

// Bulk save generated tweets/threads as drafts
router.post('/bulk-save', validateTwitterConnection, async (req, res) => {
  try {
    const { items } = req.body; // [{ text, isThread, threadParts, images }]
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to save' });
    }
    
    // Only set account_id for team accounts
    const accountId = twitterAccount.isTeamAccount ? twitterAccount.id : null;
    const authorId = twitterAccount.twitter_user_id || null;
    
    const saved = [];
    for (const item of items) {
      // Save as draft (status = 'draft')
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
    console.error('Bulk save error:', error);
    res.status(500).json({ error: 'Failed to save generated content' });
  }
});
import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import pool from '../config/database.js';
import { validateRequest } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { tweetSchema, aiGenerateSchema } from '../middleware/validation.js';
import { creditService } from '../services/creditService.js';
import { aiService } from '../services/aiService.js';
import { mediaService } from '../services/mediaService.js';
import {
  DELETED_TWEET_RETENTION_DAYS,
  ensureTweetDeletionRetentionSchema,
  getTweetDeletionRetentionWindow,
  getTweetDeletionVisibilityClause,
  markTweetDeleted,
  purgeExpiredDeletedTweets,
} from '../services/tweetRetentionService.js';

const THREAD_POST_DELAY_MS = Number.parseInt(process.env.THREAD_POST_DELAY_MS || '900', 10);
const THREAD_POST_DELAY_JITTER_MS = Number.parseInt(process.env.THREAD_POST_DELAY_JITTER_MS || '300', 10);
const THREAD_LARGE_SIZE_THRESHOLD = Number.parseInt(process.env.THREAD_LARGE_SIZE_THRESHOLD || '6', 10);
const TWITTER_RATE_LIMIT_MAX_RETRIES = Number.parseInt(process.env.TWITTER_RATE_LIMIT_MAX_RETRIES || '2', 10);
const TWITTER_RATE_LIMIT_WAIT_MS = Number.parseInt(process.env.TWITTER_RATE_LIMIT_WAIT_MS || '60000', 10);
const TWITTER_RATE_LIMIT_MAX_WAIT_MS = Number.parseInt(process.env.TWITTER_RATE_LIMIT_MAX_WAIT_MS || '300000', 10);

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
      console.warn(`[TwitterRateLimit][${label || 'tweet'}] 429 on attempt ${attempt + 1}/${maxRetries + 1}. Waiting ${waitMs}ms before retry.`);
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



// Post a tweet
router.post('/', validateRequest(tweetSchema), validateTwitterConnection, async (req, res) => {
  try {
    const { content, media, thread, threadMedia } = req.body;
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

    console.log('[POST /tweets] Tweet request:', { 
      userId, 
      accountId: twitterAccount?.id,
      hasContent: !!content,
      hasThread: !!thread,
      hasMedia: !!media,
      threadLength: thread?.length
    });

    // Tweet posting is FREE - no credit calculation needed

    // Tweet posting is now FREE - no credit deduction
    console.log('Tweet posting is free - no credits deducted');

    // Create Twitter client with OAuth 2.0
    console.log('Creating Twitter client with access token:', {
      hasToken: !!twitterAccount.access_token,
      tokenLength: twitterAccount.access_token?.length,
      tokenPreview: twitterAccount.access_token?.substring(0, 20) + '...'
    });
    
    const twitterClient = new TwitterApi(twitterAccount.access_token);
    let tweetResponse;
    let threadTweets = []; // Declare here so it's accessible in catch block

    try {
      // Handle media upload if present
      let mediaIds = [];
      if (media && media.length > 0) {
        console.log('Media detected, attempting upload...');
        
        // Check if we have OAuth 1.0a tokens for media upload
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
        console.log('Media upload completed, IDs:', mediaIds);
      }

      // If we have a thread, post the first tweet from the thread as the main tweet
      if (thread && thread.length > 0) {
        // BROKEN SQL BLOCK BELOW (commented out):
        /*
        // Team mode: show all tweets for the selected team account (any team member)
        queryParams.push(selectedAccountId);
        countParams.push(selectedAccountId);

        let whereClause = `WHERE t.account_id::TEXT = $1::TEXT`;
        if (status) {
          whereClause += ` AND t.status = $2`;
          queryParams.push(status);
          countParams.push(status);
        }

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

        countQuery = `
          SELECT COUNT(*) FROM tweets t
          ${whereClause}
        `;

        queryParams.push(parsedLimit, parsedOffset);
        console.log({
          textLength: firstTweetData.text?.length,
          hasMedia: !!firstTweetData.media,
          mediaIds: firstTweetMediaIds
        });
        */

        // Prepare first tweet data for thread
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
        console.log('First thread tweet posted successfully:', {
          tweetId: tweetResponse.data?.id,
          text: tweetResponse.data?.text?.substring(0, 50) + '...'
        });

        // Post remaining thread tweets in BACKGROUND (non-blocking)
        // User gets immediate response, tweets continue posting
        const postRemainingTweets = async () => {
          let previousTweetId = tweetResponse.data.id;

          for (let i = 1; i < thread.length; i++) {
            try {
              const mediaCountForTweet = Array.isArray(threadMedia?.[i]) ? threadMedia[i].length : 0;
              const shouldThrottle = i > 1 || thread.length > THREAD_LARGE_SIZE_THRESHOLD || mediaCountForTweet > 0;

              // Keep small threads fast, but pace larger/media-heavy threads to avoid 429.
              if (shouldThrottle) {
                const delayMs = getAdaptiveThreadDelayMs({
                  index: i,
                  totalParts: thread.length,
                  mediaCount: mediaCountForTweet,
                });
                console.log(`[Background] Waiting ${delayMs}ms before posting tweet ${i + 1}/${thread.length}...`);
                await wait(delayMs);
              }

              const threadTweetText = thread[i];
              let threadMediaIds = [];
              
              // Check if we have specific media for this thread tweet
              if (threadMedia && threadMedia[i] && threadMedia[i].length > 0) {
                console.log(`[Background] Uploading media for thread tweet ${i + 1}...`);
                const oauth1Tokens = {
                  accessToken: twitterAccount.oauth1_access_token,
                  accessTokenSecret: twitterAccount.oauth1_access_token_secret
                };
                threadMediaIds = await withRateLimitRetry(
                  () => mediaService.uploadMedia(threadMedia[i], twitterClient, oauth1Tokens),
                  { label: `thread-media-upload-${i + 1}` }
                );
                console.log(`[Background] Media upload completed for thread tweet ${i + 1}, IDs:`, threadMediaIds);
              }

              const threadTweetData = {
                text: decodeHTMLEntities(threadTweetText),
                reply: { in_reply_to_tweet_id: previousTweetId },
                ...(threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
              };

              console.log(`[Background] Posting thread tweet ${i + 1}/${thread.length}:`, {
                text: threadTweetText.substring(0, 50) + '...',
                hasMedia: threadMediaIds.length > 0,
                mediaCount: threadMediaIds.length,
                replyingTo: previousTweetId
              });

              const threadResponse = await withRateLimitRetry(
                () => twitterClient.v2.tweet(threadTweetData),
                { label: `thread-reply-post-${i + 1}` }
              );
              threadTweets.push(threadResponse.data);
              previousTweetId = threadResponse.data.id;
              
              console.log(`✅ [Background] Thread tweet ${i + 1}/${thread.length} posted successfully:`, threadResponse.data.id);
              
              // Store each thread tweet in database as it's posted
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
              console.error(`[Background] Failed to post thread tweet ${i + 1}:`, error.message);
              if (isRateLimitedError(error)) {
                const waitMs = getRateLimitWaitMs(error);
                const waitSeconds = Math.ceil(waitMs / 1000);
                console.error(`[Background] Rate limit hit while posting thread tweet ${i + 1}. Stopping remaining posts to avoid hammering Twitter. Retry after ~${waitSeconds}s.`);
                break;
              }
              // Continue for non-rate-limit errors
            }
          }
          
          console.log(`✅ [Background] Thread posting complete! Posted ${threadTweets.length + 1}/${thread.length} tweets`);
        };

        // Start background posting (fire and forget)
        postRemainingTweets().catch(err => {
          console.error('❌ [Background] Thread posting error:', err);
        });

        // Don't wait for remaining tweets - return immediately after first tweet
      } else {
        // Regular single tweet
        // Post main tweet
        console.log('Preparing single tweet data...');
        const tweetData = {
          text: decodeHTMLEntities(content),
          ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
        };
        
        console.log('Posting single tweet to Twitter API...', {
          hasText: !!tweetData.text,
          textLength: tweetData.text?.length,
          hasMedia: !!tweetData.media,
          mediaIds: mediaIds
        });

        tweetResponse = await withRateLimitRetry(
          () => twitterClient.v2.tweet(tweetData),
          { label: 'single-post' }
        );
        console.log('Single tweet posted successfully:', {
          tweetId: tweetResponse.data?.id,
          text: tweetResponse.data?.text?.substring(0, 50) + '...'
        });
      }

      // Store tweet(s) in database
      const mainContent = thread && thread.length > 0 ? thread[0] : content;
      
      // Only set account_id for team accounts (isTeamAccount = true)
      // Personal accounts (isTeamAccount = false or undefined) will have NULL account_id
      const accountId = twitterAccount.isTeamAccount ? twitterAccount.id : null;
      const authorId = twitterAccount.twitter_user_id || null;
      
      // Insert main tweet
      const { rows } = await pool.query(
        `INSERT INTO tweets (
          user_id, account_id, author_id, tweet_id, content, 
          media_urls, thread_tweets, credits_used, 
          impressions, likes, retweets, replies, status, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 0, 'posted', 'platform')
        RETURNING *`,
        [
          userId,
          accountId,  // NULL for personal accounts, integer ID for team accounts
          authorId,
          tweetResponse.data.id,
          mainContent,
          JSON.stringify(thread && thread.length > 0 && threadMedia && threadMedia[0] ? threadMedia[0] : (media || [])),
          JSON.stringify(threadTweets),
          0  // No credits used for posting
        ]
      );
      
      // Note: For threads, only the first tweet is inserted here
      // Remaining tweets are inserted by background process as they post
      // This is intentional - no need to update this section

      res.json({
        success: true,
        tweet: {
          id: rows[0].id,
          tweet_id: tweetResponse.data.id,
          content: mainContent,
          url: `https://twitter.com/${twitterAccount.username}/status/${tweetResponse.data.id}`,
          credits_used: 0,  // No credits charged for posting
          thread_count: thread ? thread.length : 1,
          thread_status: thread && thread.length > 1 ? 'First tweet posted, remaining tweets posting in background...' : 'Posted'
        }
      });

    } catch (twitterError) {
      // Note: No credit refund needed since posting is free
      console.log('Twitter API error occurred - no credits to refund since posting is free');
      
      // Check if it's a rate limit error (429)
      const isRateLimitError = isRateLimitedError(twitterError);
      const is401Error = isUnauthorizedError(twitterError);
      
      // Check if it's a 403 (permissions) error
      const is403Error = twitterError.code === 403 || 
                        twitterError.message?.includes('403') ||
                        twitterError.toString().includes('403');
      
      if (isRateLimitError) {
        console.log('✅ Rate limit detected - Twitter API returned 429');
        
        // Calculate retry time
        const retryAfterMs = getRateLimitWaitMs(twitterError);
        const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
        const resetTime = new Date(Date.now() + retryAfterMs);
        
        // Safely check threadTweets length (it might not be defined if error happens in non-thread code)
        const postedCount = (threadTweets?.length || 0) + 1; // +1 for the first tweet
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
        console.log('Twitter API returned 401 Unauthorized', {
          accountId: twitterAccount?.id,
          isTeamAccount: twitterAccount?.isTeamAccount,
          hasRefreshToken: !!twitterAccount?.refresh_token,
        });
        throw {
          code: 'TWITTER_AUTH_EXPIRED',
          message: 'Twitter session expired or revoked. Please reconnect your account.',
          details: twitterError.message
        };
      } else if (is403Error) {
        console.log('🔐 Permissions error detected - Twitter API returned 403');
        throw {
          code: 'TWITTER_PERMISSIONS_ERROR',
          message: 'Twitter permissions expired. Please reconnect your account.',
          details: twitterError.message
        };
      } else {
        console.log('❌ Other Twitter API error:', twitterError.message);
        throw {
          code: 'TWITTER_API_ERROR',
          message: 'Failed to post tweet',
          details: twitterError.message
        };
      }
    }

  } catch (error) {
    console.error('Post tweet error:', error);
    
    // Handle specific error types
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
    
    // Generic server error
    res.status(500).json({ error: 'Failed to post tweet' });
  }
});

// Generate AI tweet content
router.post('/ai-generate', validateRequest(aiGenerateSchema), async (req, res) => {
  try {
    const { prompt, provider, style, hashtags, mentions, max_tweets } = req.body;
    const userId = req.user.id;

    // Calculate credit cost for AI text generation
    const creditCost = 1.2; // 1.2 credits per AI text generation request

    // Get JWT token AFTER authentication middleware (which may have refreshed it)
    // Check if middleware set a new token in response headers first
    let userToken = null;
    
    // Try to extract token from Set-Cookie header if it was refreshed
    const setCookieHeader = res.getHeaders()['set-cookie'];
    if (setCookieHeader) {
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      const accessTokenCookie = cookies.find(cookie => 
        typeof cookie === 'string' && cookie.startsWith('accessToken=')
      );
      if (accessTokenCookie) {
        userToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
        console.log('Using refreshed token from response header for AI generation');
      }
    }
    
    // Fallback to request cookies or Authorization header
    if (!userToken) {
      userToken = req.cookies?.accessToken;
      if (!userToken) {
        const authHeader = req.headers['authorization'];
        userToken = authHeader && authHeader.split(' ')[1];
      }
      console.log('Using token from request for AI generation');
    }

    // Check and deduct credits
    const creditCheck = await creditService.checkAndDeductCredits(userId, 'ai_generation', creditCost, userToken);
    if (!creditCheck.success) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        required: creditCost,
        available: creditCheck.available
      });
    }

    try {
      // Generate content using AI service
      const generatedTweets = await aiService.generateTweets({
        prompt,
        provider,
        style,
        hashtags,
        mentions,
        max_tweets,
        userId
      });

      // Store generation record
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
      // Refund credits on AI service failure
      console.log('Attempting to refund credits due to AI generation error...');
      try {
        await creditService.refundCredits(userId, 'ai_generation_failed', creditCost, userToken);
      } catch (refundError) {
        console.log('Refund failed (non-critical):', refundError.message);
      }
      throw aiError;
    }

  } catch (error) {
    console.error('AI generation error:', error);
    res.status(500).json({ error: 'Failed to generate AI content' });
  }
});

// Get user's tweets - alias as /history for backwards compatibility
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

      countQuery = `
        SELECT COUNT(*) FROM tweets t
        ${whereClause}
      `;

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

      countQuery = `
        SELECT COUNT(*) FROM tweets t
        ${whereClause}
      `;

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

    console.log(`[GET /tweets/history] Successfully returned ${rows.length} tweets`);

  } catch (error) {
    console.error('[GET /tweets/history] Error:', error);
    console.error('[GET /tweets/history] Error stack:', error.stack);
    console.error('[GET /tweets/history] Error code:', error.code);
    console.error('[GET /tweets/history] SQL query was:', sqlQuery);
    console.error('[GET /tweets/history] Query params were:', queryParams);
    
    // Check for database connection errors
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

    // Get tweet details for user
    let { rows } = await pool.query(
      'SELECT * FROM tweets WHERE id = $1 AND user_id = $2',
      [tweetId, userId]
    );

    let tweet = rows[0];

    // If not found, check if it's a team tweet the user has access to
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

    // Create Twitter client with OAuth 2.0
    const twitterClient = new TwitterApi(req.twitterAccount.access_token);

    try {
      // Delete from Twitter
      await twitterClient.v2.deleteTweet(tweet.tweet_id);

      // Keep in history as deleted for retention window.
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
      console.error('Twitter delete error:', twitterError);

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
    console.error('Delete tweet error:', error);
    res.status(500).json({ error: 'Failed to delete tweet' });
  }
});

export default router;
