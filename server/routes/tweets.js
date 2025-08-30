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
    const { content, media, thread } = req.body;
    const userId = req.user.id;
    const twitterAccount = req.twitterAccount;

    // Calculate credit cost
    let creditCost = 1; // Base cost for posting
    if (media && media.length > 0) creditCost += media.length; // Additional cost for media
    if (thread && thread.length > 0) creditCost += thread.length; // Additional cost for thread

    // Check and deduct credits
    const creditCheck = await creditService.checkAndDeductCredits(userId, 'tweet_post', creditCost);
    if (!creditCheck.success) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        required: creditCost,
        available: creditCheck.available
      });
    }

    // Create Twitter client
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: twitterAccount.access_token,
      accessSecret: twitterAccount.access_token_secret,
    });

    let tweetResponse;

    try {
      // Handle media upload if present
      let mediaIds = [];
      if (media && media.length > 0) {
        mediaIds = await mediaService.uploadMedia(media, twitterClient);
      }

      // Post main tweet
      const tweetData = {
        text: content,
        ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } })
      };

      tweetResponse = await twitterClient.v2.tweet(tweetData);

      // Handle thread if present
      let threadTweets = [];
      if (thread && thread.length > 0) {
        let previousTweetId = tweetResponse.data.id;

        for (const threadTweet of thread) {
          let threadMediaIds = [];
          if (threadTweet.media && threadTweet.media.length > 0) {
            threadMediaIds = await mediaService.uploadMedia(threadTweet.media, twitterClient);
          }

          const threadTweetData = {
            text: threadTweet.content,
            reply: { in_reply_to_tweet_id: previousTweetId },
            ...(threadMediaIds.length > 0 && { media: { media_ids: threadMediaIds } })
          };

          const threadResponse = await twitterClient.v2.tweet(threadTweetData);
          threadTweets.push(threadResponse.data);
          previousTweetId = threadResponse.data.id;
        }
      }

      // Store tweet in database
      const { rows } = await pool.query(
        `INSERT INTO tweets (
          user_id, twitter_account_id, tweet_id, content, 
          media_urls, thread_tweets, credits_used, 
          impressions, likes, retweets, replies, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, 'posted')
        RETURNING *`,
        [
          userId,
          twitterAccount.id,
          tweetResponse.data.id,
          content,
          JSON.stringify(media || []),
          JSON.stringify(threadTweets),
          creditCost
        ]
      );

      res.json({
        success: true,
        tweet: {
          id: rows[0].id,
          tweet_id: tweetResponse.data.id,
          content: content,
          url: `https://twitter.com/${twitterAccount.username}/status/${tweetResponse.data.id}`,
          credits_used: creditCost,
          thread_count: threadTweets.length
        }
      });

    } catch (twitterError) {
      // Refund credits on Twitter API failure
      await creditService.refundCredits(userId, 'tweet_post_failed', creditCost);
      
      throw {
        code: 'TWITTER_API_ERROR',
        message: 'Failed to post tweet',
        details: twitterError.message
      };
    }

  } catch (error) {
    console.error('Post tweet error:', error);
    if (error.code) throw error;
    res.status(500).json({ error: 'Failed to post tweet' });
  }
});

// Generate AI tweet content
router.post('/ai-generate', validateRequest(aiGenerateSchema), async (req, res) => {
  try {
    const { prompt, provider, style, hashtags, mentions, max_tweets } = req.body;
    const userId = req.user.id;

    // Calculate credit cost for AI generation
    const creditCost = max_tweets * 2; // 2 credits per AI-generated tweet

    // Check and deduct credits
    const creditCheck = await creditService.checkAndDeductCredits(userId, 'ai_generation', creditCost);
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
      await creditService.refundCredits(userId, 'ai_generation_failed', creditCost);
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
      `SELECT t.*, ta.username, ta.display_name
       FROM tweets t
       JOIN twitter_accounts ta ON t.twitter_account_id = ta.id
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

    // Create Twitter client
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: req.twitterAccount.access_token,
      accessSecret: req.twitterAccount.access_token_secret,
    });

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
