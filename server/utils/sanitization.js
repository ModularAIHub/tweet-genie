/**
 * Backend input sanitization utilities
 */

// Dangerous patterns to remove
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /javascript:/gi,
  /data:text\/html/gi,
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  /<(object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi,
  /style\s*=\s*["'][^"']*expression\s*\([^"']*["']/gi,
];

// SQL injection patterns - more precise detection
const SQL_INJECTION_PATTERNS = [
  // Classic SQL injection patterns
  /('\s*(OR|AND)\s*'?\d+\s*['"]?\s*=\s*['"]?\d+)/gi,
  /('\s*(OR|AND)\s*['"]?\w+['"]?\s*=\s*['"]?\w+['"]?)/gi,
  /(;\s*(DROP|DELETE|TRUNCATE|ALTER)\s+)/gi,
  /(\bUNION\s+SELECT\b)/gi,
  /(\bSELECT\s+.*\bFROM\s+)/gi,
  /(\bINSERT\s+INTO\s+)/gi,
  /(\bUPDATE\s+.*\bSET\s+)/gi,
  /(\bDELETE\s+FROM\s+)/gi,
  // SQL comments
  /(--|\/\*|\*\/)/g,
  // Dangerous SQL functions
  /(\bEXEC\s*\(|\bEXECUTE\s*\()/gi,
];

// NoSQL injection patterns
const NOSQL_INJECTION_PATTERNS = [
  /\$where/gi,
  /\$regex/gi,
  /\$gt/gi,
  /\$lt/gi,
  /\$ne/gi,
  /\$in/gi,
  /\$nin/gi,
];

// XSS patterns
const XSS_PATTERNS = [
  /<script/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /expression\s*\(/gi,
  /vbscript:/gi,
  /data:text\/html/gi,
];

/**
 * Sanitize user input text
 * @param {string} input - Raw user input
 * @param {object} options - Sanitization options
 * @returns {string} - Sanitized input
 */
export const sanitizeInput = (input, options = {}) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const {
    maxLength = 5000,
    allowHTML = false,
    stripTags = true,
    preventInjection = true
  } = options;

  let sanitized = input.trim();

  // 1. Length restriction
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // 2. Remove dangerous patterns
  if (!allowHTML) {
    DANGEROUS_PATTERNS.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });
  }

  // 3. Prevent injection attacks
  if (preventInjection) {
    // SQL injection - only check if content looks like SQL
    const looksLikeSQL = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|UNION)\b/gi.test(sanitized);
    
    if (looksLikeSQL) {
      SQL_INJECTION_PATTERNS.forEach(pattern => {
        if (pattern.test(sanitized)) {
          console.warn('Potential SQL injection attempt detected:', sanitized.substring(0, 100));
          sanitized = sanitized.replace(pattern, '[FILTERED]');
        }
      });
    }

    // NoSQL injection
    NOSQL_INJECTION_PATTERNS.forEach(pattern => {
      if (pattern.test(sanitized)) {
        console.warn('Potential NoSQL injection attempt detected:', sanitized.substring(0, 100));
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    });

    // XSS
    XSS_PATTERNS.forEach(pattern => {
      if (pattern.test(sanitized)) {
        console.warn('Potential XSS attempt detected:', sanitized.substring(0, 100));
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    });
  }

  // 4. Strip HTML tags if required
  if (stripTags) {
    sanitized = sanitized.replace(/<[^>]*>/g, '');
  }

  // 5. Encode special characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized.trim();
};

/**
 * Sanitize AI prompt to prevent prompt injection
 * @param {string} prompt - AI prompt
 * @returns {string} - Sanitized prompt
 */
export const sanitizeAIPrompt = (prompt) => {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  let sanitized = prompt.trim();

  // Remove potential prompt injection attempts (but be more lenient for creative content)
  const promptInjectionPatterns = [
    /ignore\s+previous\s+instructions/gi,
    /ignore\s+all\s+previous\s+instructions/gi,
    /forget\s+everything/gi,
    /new\s+instructions/gi,
    /you\s+are\s+now\s+(a|an)\s+/gi,
    /pretend\s+to\s+be\s+(a|an)\s+/gi,
    /roleplay\s+as\s+(a|an)\s+/gi,
    /act\s+as\s+(a|an)\s+(hacker|criminal|terrorist)/gi,
  ];

  promptInjectionPatterns.forEach(pattern => {
    if (pattern.test(sanitized)) {
      console.warn('Potential prompt injection detected:', sanitized.substring(0, 100));
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  });

  // Only remove truly dangerous characters, allow creative punctuation
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000);
  }

  return sanitized;
};

/**
 * Validate and sanitize tweet content
 * @param {string} content - Tweet content
 * @returns {object} - Validation result
 */
export const validateTweetContent = (content) => {
  const result = {
    isValid: true,
    errors: [],
    warnings: [],
    sanitizedContent: ''
  };

  if (!content || typeof content !== 'string') {
    result.isValid = false;
    result.errors.push('Content is required');
    return result;
  }

  const sanitized = sanitizeInput(content, { maxLength: 500 });

  if (sanitized.length === 0) {
    result.isValid = false;
    result.errors.push('Content cannot be empty after sanitization');
    return result;
  }

  if (sanitized.length > 280) {
    result.isValid = false;
    result.errors.push(`Content too long: ${sanitized.length}/280 characters`);
  }

  // Check for spam patterns
  const words = sanitized.toLowerCase().split(/\s+/);
  const uniqueWords = [...new Set(words)];
  
  if (words.length > 10 && uniqueWords.length / words.length < 0.5) {
    result.warnings.push('Content appears repetitive');
  }

  // Check for excessive special characters
  const specialChars = sanitized.match(/[^\w\s]/g) || [];
  if (specialChars.length > sanitized.length * 0.3) {
    result.warnings.push('Content contains many special characters');
  }

  result.sanitizedContent = sanitized;
  return result;
};

/**
 * Sanitize image generation prompt
 * @param {string} prompt - Image prompt
 * @returns {string} - Sanitized prompt
 */
export const sanitizeImagePrompt = (prompt) => {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  let sanitized = sanitizeInput(prompt, { maxLength: 1000 });

  // Remove potentially harmful content for image generation
  const harmfulImageTerms = [
    /\b(nude|naked|nsfw|explicit|sexual|porn|xxx)\b/gi,
    /\b(violence|blood|gore|weapon|gun|knife|bomb)\b/gi,
    /\b(hate|racist|nazi|terrorism|illegal|drug)\b/gi,
    /\b(copyright|trademark|disney|marvel|pokemon)\b/gi,
  ];

  harmfulImageTerms.forEach(pattern => {
    if (pattern.test(sanitized)) {
      console.warn('Potentially inappropriate image prompt detected');
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  });

  return sanitized;
};

/**
 * Rate limiting check
 * @param {string} identifier - User ID or IP
 * @param {string} action - Action type
 * @param {number} limit - Request limit
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} - Whether request is allowed
 */
const rateLimitStore = new Map();

export const checkRateLimit = (identifier, action, limit = 10, windowMs = 60000) => {
  const key = `${identifier}:${action}`;
  const now = Date.now();
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  const data = rateLimitStore.get(key);
  
  if (now > data.resetTime) {
    // Reset window
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (data.count >= limit) {
    return false;
  }
  
  data.count++;
  return true;
};

export default {
  sanitizeInput,
  sanitizeAIPrompt,
  validateTweetContent,
  sanitizeImagePrompt,
  checkRateLimit
};
