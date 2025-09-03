import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import pool from '../config/database.js';
import { validateRequest } from '../middleware/validation.js';
import { validateTwitterConnection } from '../middleware/auth.js';
import { tweetSchema, aiGenerateSchema } from '../middleware/validation.js';
import { creditService } from '../services/creditService.js';
import { aiService } from '../services/aiService.js';
import { mediaService } from '../services/mediaService.js';

const router = express.Router();

// Post a tweet
router.post('/', validateRequest(tweetSchema), validateTwitterConnection, async (req, res) => {
  try {
    const { content, media, thread, threadMedia } = req.body;
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

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

      let tweetResponse;
      let threadTweets = [];

      // If we have a thread, post the first tweet from the thread as the main tweet
      if (thread && thread.length > 0) {
        console.log('Processing thread with', thread.length, 'tweets');
        
        // Use the first thread tweet as the main tweet
        const firstTweetText = thread[0];
        let firstTweetMediaIds = [];
        
        // Check if we have media for the first thread tweet
        if (threadMedia && threadMedia[0] && threadMedia[0].length > 0) {
          console.log('Uploading media for first thread tweet...');
          
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
          
          firstTweetMediaIds = await mediaService.uploadMedia(threadMedia[0], twitterClient, oauth1Tokens);
          console.log('Media upload completed for first thread tweet, IDs:', firstTweetMediaIds);
        }

        // Post the first tweet
        const firstTweetData = {
          text: firstTweetText,
          ...(firstTweetMediaIds.length > 0 && { media: { media_ids: firstTweetMediaIds } })
        };
        
        console.log('Posting first thread tweet to Twitter API...', {
          hasText: !!firstTweetData.text,
          textLength: firstTweetData.text?.length,
          hasMedia: !!firstTweetData.media,
          mediaIds: firstTweetMediaIds
        });

        tweetResponse = await twitterClient.v2.tweet(firstTweetData);
        console.log('First thread tweet posted successfully:', {
          tweetId: tweetResponse.data?.id,
          text: tweetResponse.data?.text?.substring(0, 50) + '...'
        });

        // Post remaining thread tweets (skip the first one since it's already posted)
        let previousTweetId = tweetResponse.data.id;

        for (let i = 1; i < thread.length; i++) {
          const threadTweetText = thread[i];
          let threadMediaIds = [];
          
          // Check if we have specific media for this thread tweet
          if (threadMedia && threadMedia[i] && threadMedia[i].length > 0) {
            console.log(`Uploading media for thread tweet ${i + 1}...`);
            
            const oauth1Tokens = {
              accessToken: twitterAccount.oauth1_access_token,
              accessTokenSecret: twitterAccount.oauth1_access_token_secret
            };
            
            threadMediaIds = await mediaService.uploadMedia(threadMedia[i], twitterClient, oauth1Tokens);
            console.log(`Media upload completed for thread tweet ${i + 1}, IDs:`, threadMediaIds);
          }

          const threadTweetData = {
            text: threadTweetText,
            reply: { in_reply_to_tweet_id: previousTweetId },
            ...(threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
          };

          console.log(`Posting thread tweet ${i + 1}:`, {
            text: threadTweetText.substring(0, 50) + '...',
            hasMedia: threadMediaIds.length > 0,
            mediaCount: threadMediaIds.length,
            replyingTo: previousTweetId
          });

          const threadResponse = await twitterClient.v2.tweet(threadTweetData);
          threadTweets.push(threadResponse.data);
          previousTweetId = threadResponse.data.id;
          
          console.log(`Thread tweet ${i + 1} posted successfully:`, threadResponse.data.id);
        }
      } else {
        // Regular single tweet
        // Post main tweet
        console.log('Preparing single tweet data...');
        const tweetData = {
          text: content,
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

      // Store tweet in database
      const mainContent = thread && thread.length > 0 ? thread[0] : content;
      const { rows } = await pool.query(
        `INSERT INTO tweets (
          user_id, tweet_id, content, 
          media_urls, thread_tweets, credits_used, 
          impressions, likes, retweets, replies, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 'posted')
        RETURNING *`,
        [
          userId,
          tweetResponse.data.id,
          mainContent,
          JSON.stringify(media || []),
          JSON.stringify(threadTweets),
          0  // No credits used for posting
        ]
      );

      res.json({
        success: true,
        tweet: {
          id: rows[0].id,
          tweet_id: tweetResponse.data.id,
          content: mainContent,
          url: `https://twitter.com/${twitterAccount.username}/status/${tweetResponse.data.id}`,
          credits_used: 0,  // No credits charged for posting
          thread_count: thread ? thread.length : 1
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
        throw {
          code: 'TWITTER_RATE_LIMIT',
          message: 'Twitter rate limit reached. Please try again later.',
          details: twitterError.message,
          retryAfter: twitterError.rateLimit?.reset || 'unknown'
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

// Get user's tweets
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE t.user_id = $1';
    const params = [req.user.id];

    if (status) {
      whereClause += ' AND t.status = $2';
      params.push(status);
    }

    const { rows } = await pool.query(
      `SELECT t.*, ta.twitter_username as username, ta.twitter_display_name as display_name
       FROM tweets t
       JOIN twitter_auth ta ON t.user_id = ta.user_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM tweets t ${whereClause}`,
      params
    );

    res.json({
      tweets: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Get tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch tweets' });
  }
});

// Delete a tweet
router.delete('/:tweetId', validateTwitterConnection, async (req, res) => {
  try {
    const { tweetId } = req.params;
    const userId = req.user.id;

    // Get tweet details
    const { rows } = await pool.query(
      'SELECT * FROM tweets WHERE id = $1 AND user_id = $2',
      [tweetId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tweet not found' });
    }

    const tweet = rows[0];

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
