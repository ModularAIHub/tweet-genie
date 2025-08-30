export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Twitter API errors
  if (err.code === 'TWITTER_API_ERROR') {
    return res.status(400).json({
      error: 'Twitter API error',
      message: err.message,
      details: err.details
    });
  }

  // Credit system errors
  if (err.code === 'INSUFFICIENT_CREDITS') {
    return res.status(402).json({
      error: 'Insufficient credits',
      message: err.message,
      required: err.required,
      available: err.available
    });
  }

  // Validation errors
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.details.map(detail => detail.message)
    });
  }

  // Database errors
  if (err.code && err.code.startsWith('23')) {
    return res.status(400).json({
      error: 'Database constraint violation',
      message: 'The operation violates data constraints'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
