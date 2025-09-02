import Joi from 'joi';

export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }
    next();
  };
};

// Tweet content validation
export const tweetSchema = Joi.object({
  content: Joi.string().min(1).max(280).required(),
  media: Joi.array().items(Joi.string()).max(4).optional(),
  scheduled_for: Joi.date().greater('now').optional(),
  thread: Joi.array().items(
    Joi.object({
      content: Joi.string().min(1).max(280).required(),
      media: Joi.array().items(Joi.string()).max(4).optional()
    })
  ).max(25).optional()
});

// AI generation validation
export const aiGenerateSchema = Joi.object({
  prompt: Joi.string().min(10).max(1000).required(),
  provider: Joi.string().valid('openai', 'perplexity', 'google').required(),
  style: Joi.string().valid('professional', 'casual', 'witty', 'inspirational').optional(),
  hashtags: Joi.boolean().optional(),
  mentions: Joi.array().items(Joi.string()).max(5).optional(),
  max_tweets: Joi.number().min(1).max(10).default(1)
});

// Schedule validation
export const scheduleSchema = Joi.object({
  tweet_id: Joi.string().uuid().required(),
  scheduled_for: Joi.date().greater('now').required(),
  timezone: Joi.string().optional()
});

// Analytics validation (simplified)
export const analyticsQuerySchema = Joi.object({
  start_date: Joi.date().required(),
  end_date: Joi.date().greater(Joi.ref('start_date')).required(),
  metrics: Joi.array().items(
    Joi.string().valid('impressions', 'likes', 'retweets', 'replies')
  ).optional()
});
