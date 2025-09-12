import Joi from 'joi';

export const validateRequest = (schema) => {
  return (req, res, next) => {
    console.log('[validateRequest] Incoming body:', JSON.stringify(req.body));
    const { error } = schema.validate(req.body);
    if (error) {
      console.error('[validateRequest] Validation error:', error.details.map(detail => detail.message));
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
  content: Joi.string().min(1).max(280).when('thread', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required()
  }),
  media: Joi.array().items(Joi.string()).max(4).optional(),
  scheduled_for: Joi.date().greater('now').optional(),
  thread: Joi.array().items(Joi.string().min(1).max(280)).max(25).optional(),
  threadMedia: Joi.array().items(
    Joi.array().items(Joi.string()).max(4)
  ).max(25).optional()
}).or('content', 'thread');

// AI generation validation
export const aiGenerateSchema = Joi.object({
  prompt: Joi.string().min(10).max(1000).required(),
  provider: Joi.string().valid('openai', 'perplexity', 'google').required(),
  style: Joi.string().valid('professional', 'casual', 'witty', 'inspirational').optional(),
  hashtags: Joi.boolean().optional(),
  mentions: Joi.array().items(Joi.string()).max(5).optional(),
  max_tweets: Joi.number().min(1).max(10).default(1)
});

// Schedule validation (accepts content/media for single, or thread/threadMedia for thread)
export const scheduleSchema = Joi.object({
  content: Joi.string().allow('').max(280),
  media: Joi.array().items(Joi.string()).max(4),
  thread: Joi.array().items(Joi.string().min(1).max(280)).max(25),
  threadMedia: Joi.array().items(Joi.string()).max(25),
  scheduled_for: Joi.date().greater('now').required(),
  timezone: Joi.string().optional()
}).custom((value, helpers) => {
  const hasContent = typeof value.content === 'string' && value.content.trim().length > 0;
  const hasMedia = Array.isArray(value.media) && value.media.length > 0;
  const hasThread = Array.isArray(value.thread) && value.thread.length > 0 && value.thread.some(t => t && t.trim().length > 0);
  if (!hasContent && !hasMedia && !hasThread) {
    return helpers.error('any.custom', { message: 'Please enter some content or add images' });
  }
  return value;
}, 'Require content, media, or thread');

// Analytics validation (simplified)
export const analyticsQuerySchema = Joi.object({
  start_date: Joi.date().required(),
  end_date: Joi.date().greater(Joi.ref('start_date')).required(),
  metrics: Joi.array().items(
    Joi.string().valid('impressions', 'likes', 'retweets', 'replies')
  ).optional()
});
