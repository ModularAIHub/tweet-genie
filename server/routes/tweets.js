const router = express.Router();
import { decodeHTMLEntities } from '../utils/decodeHTMLEntities.js';

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
    
    const saved = [];
    for (const item of items) {
      // Save as draft (status = 'draft')
      const { text, isThread, threadParts } = item;
      const { rows } = await pool.query(
        `INSERT INTO tweets (user_id, account_id, content, is_thread, thread_parts, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
         RETURNING *`,
        [userId, accountId, text, !!isThread, isThread ? JSON.stringify(threadParts) : null]
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
        console.log('Using refreshed token from response header');
      }
    }
    
    // Fallback to request cookies or Authorization header
    if (!userToken) {
      userToken = req.cookies?.accessToken;
      if (!userToken) {
        const authHeader = req.headers['authorization'];
        userToken = authHeader && authHeader.split(' ')[1];
      }
      console.log('Using token from request');
    }

    // Tweet posting is now FREE - no credit deduction
    console.log('Tweet posting is free - no credits deducted');

    // Create Twitter client with OAuth 2.0
    console.log('Creating Twitter client with access token:', {
      hasToken: !!twitterAccount.access_token,
      tokenLength: twitterAccount.access_token?.length,
      tokenPreview: twitterAccount.access_token?.substring(0, 20) + '...'
    });
    
    const twitterClient = new TwitterApi(twitterAccount.access_token);

    // Test token permissions first
    try {
      console.log('Testing Twitter token permissions...');
      const userTest = await twitterClient.v2.me();
      console.log('✅ Token has read access:', !!userTest.data);
      console.log('User data:', { id: userTest.data?.id, username: userTest.data?.username });
      
      // Simple test to see if we can make any API calls
      console.log('Testing basic API access...');
      
    } catch (testError) {
      console.error('❌ Token test failed:', {
        message: testError.message,
        code: testError.code,
        status: testError.status,
        data: testError.data
      });
      
      // If basic API calls fail, the token is definitely invalid
      throw {
        code: 'TWITTER_TOKEN_INVALID',
        message: 'Twitter token is invalid or expired. Please reconnect your account.',
        details: testError.message
      };
    }

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
        
        mediaIds = await mediaService.uploadMedia(media, twitterClient, oauth1Tokens);
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
          firstTweetMediaIds = await mediaService.uploadMedia(threadMedia[0], twitterClient, oauth1Tokens);
        }
        const firstTweetData = {
          text: decodeHTMLEntities(thread[0]),
          ...(firstTweetMediaIds.length > 0 && { media: { media_ids: firstTweetMediaIds } })
        };
        tweetResponse = await twitterClient.v2.tweet(firstTweetData);
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
              // Fast delays for better UX (4-6 seconds) - balances speed with rate limits
              const delayMs = 4000 + Math.random() * 2000; // 4-6 seconds
              console.log(`⏳ [Background] Waiting ${Math.round(delayMs/1000)}s before posting tweet ${i + 1}/${thread.length}...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));

              const threadTweetText = thread[i];
              let threadMediaIds = [];
              
              // Check if we have specific media for this thread tweet
              if (threadMedia && threadMedia[i] && threadMedia[i].length > 0) {
                console.log(`[Background] Uploading media for thread tweet ${i + 1}...`);
                const oauth1Tokens = {
                  accessToken: twitterAccount.oauth1_access_token,
                  accessTokenSecret: twitterAccount.oauth1_access_token_secret
                };
                threadMediaIds = await mediaService.uploadMedia(threadMedia[i], twitterClient, oauth1Tokens);
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

              const threadResponse = await twitterClient.v2.tweet(threadTweetData);
              threadTweets.push(threadResponse.data);
              previousTweetId = threadResponse.data.id;
              
              console.log(`✅ [Background] Thread tweet ${i + 1}/${thread.length} posted successfully:`, threadResponse.data.id);
              
              // Store each thread tweet in database as it's posted
              const accountId = twitterAccount.isTeamAccount ? twitterAccount.id : null;
              const threadTweetMediaUrls = threadMedia && threadMedia[i] ? threadMedia[i] : [];
              
              await pool.query(
                `INSERT INTO tweets (
                  user_id, account_id, tweet_id, content, 
                  media_urls, credits_used, 
                  impressions, likes, retweets, replies, status, source
                ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 'posted', 'platform')`,
                [
                  userId,
                  accountId,
                  threadResponse.data.id,
                  threadTweetText,
                  JSON.stringify(threadTweetMediaUrls),
                  0
                ]
              );
              
            } catch (error) {
              console.error(`❌ [Background] Failed to post thread tweet ${i + 1}:`, error.message);
              // Continue trying to post remaining tweets even if one fails
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

        tweetResponse = await twitterClient.v2.tweet(tweetData);
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
      
      // Insert main tweet
      const { rows } = await pool.query(
        `INSERT INTO tweets (
          user_id, account_id, tweet_id, content, 
          media_urls, thread_tweets, credits_used, 
          impressions, likes, retweets, replies, status, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, 'posted', 'platform')
        RETURNING *`,
        [
          userId,
          accountId,  // NULL for personal accounts, integer ID for team accounts
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
      const isRateLimitError = twitterError.code === 429 || 
                              twitterError.message?.includes('429') ||
                              twitterError.toString().includes('429');
      
      // Check if it's a 403 (permissions) error
      const is403Error = twitterError.code === 403 || 
                        twitterError.message?.includes('403') ||
                        twitterError.toString().includes('403');
      
      if (isRateLimitError) {
        console.log('✅ Rate limit detected - Twitter API returned 429');
        
        // Calculate retry time
        let retryAfterMinutes = 15; // Default fallback
        let resetTime = null;
        
        if (twitterError.rateLimit?.reset) {
          resetTime = new Date(twitterError.rateLimit.reset * 1000);
          retryAfterMinutes = Math.ceil((resetTime - Date.now()) / 60000);
        }
        
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
  let sqlQuery = ''; // Declare outside try block for error logging
  let countQuery = '';
  let queryParams = [];
  
  try {
    console.log('[GET /tweets/history] Request received', {
      user: req.user,
      query: req.query,
      headers: {
        'x-selected-account-id': req.headers['x-selected-account-id'],
        authorization: req.headers.authorization ? 'present' : 'missing'
      }
    });

    if (!req.user || !req.user.id) {
      console.error('[GET /tweets/history] No user ID found in request');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { page = 1, limit = 20, status } = req.query;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    queryParams = [req.user.id];
    let countParams = [req.user.id];

    if (selectedAccountId) {
      console.log('[GET /tweets/history] Selected account ID:', selectedAccountId);
      
      // First check if this is a team account the user has access to
      const teamCheckResult = await pool.query(`
        SELECT ta.id, ta.team_id 
        FROM team_accounts ta
        INNER JOIN team_members tm ON ta.team_id = tm.team_id
        WHERE ta.id::TEXT = $1::TEXT AND tm.user_id = $2 AND tm.status = 'active'
      `, [selectedAccountId, req.user.id]);
      
      console.log('[GET /tweets/history] Team account check result:', teamCheckResult.rows);
      
      if (teamCheckResult.rows.length > 0) {
        let whereClause = `WHERE t.account_id::TEXT = $1::TEXT`;
        if (status) {
          whereClause += ` AND t.status = $2`;
          queryParams.push(status);
          countParams.push(status);
        }
        // Log account ID and query parameters for debugging
        console.log('[TEAM HISTORY DEBUG] SelectedAccountId:', selectedAccountId);
        console.log('[TEAM HISTORY DEBUG] QueryParams:', queryParams);
        console.log('[TEAM HISTORY DEBUG] CountParams:', countParams);
        console.log('[TEAM HISTORY DEBUG] WhereClause:', whereClause);
        // Team mode: show all tweets for the selected team account
        queryParams = [selectedAccountId];
        countParams = [selectedAccountId];

        // Log account ID and query parameters for debugging
        console.log('[TEAM HISTORY DEBUG] SelectedAccountId:', selectedAccountId);
        console.log('[TEAM HISTORY DEBUG] QueryParams:', queryParams);
        console.log('[TEAM HISTORY DEBUG] CountParams:', countParams);
        console.log('[TEAM HISTORY DEBUG] WhereClause:', whereClause);

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
      } else {
        // Not a team account or user doesn't have access - treat as personal account
        console.log('[GET /tweets/history] Not a team account, treating as personal');
        queryParams = [req.user.id];
        countParams = [req.user.id];
        
        let whereClause = 'WHERE t.user_id = $1 AND (t.account_id IS NULL OR t.account_id = 0)';
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

        queryParams.push(parsedLimit, parsedOffset);
      }
    } else {
      // Personal mode: join with twitter_auth, filter out team tweets
      let whereClause = 'WHERE t.user_id = $1 AND (t.account_id IS NULL OR t.account_id = 0)';
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

      queryParams.push(parsedLimit, parsedOffset);
    }

    const { rows } = await pool.query(sqlQuery, queryParams);
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      tweets: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
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

    // Create Twitter client with OAuth 2.0
    const twitterClient = new TwitterApi(req.twitterAccount.access_token);

    try {
      // Delete from Twitter
      await twitterClient.v2.deleteTweet(tweet.tweet_id);

      // Update status in database
      await pool.query(
        'UPDATE tweets SET status = $1 WHERE id = $2',
        ['deleted', tweetId]
      );

      res.json({ success: true, message: 'Tweet deleted successfully' });

    } catch (twitterError) {
      console.error('Twitter delete error:', twitterError);
      res.status(400).json({ error: 'Failed to delete tweet from Twitter' });
    }

  } catch (error) {
    console.error('Delete tweet error:', error);
    res.status(500).json({ error: 'Failed to delete tweet' });
  }
});

export default router;
