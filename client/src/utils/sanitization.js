/**
 * Input sanitization utilities for user input and AI-generated content
 */

// List of potentially harmful patterns
const DANGEROUS_PATTERNS = [
  // Script tags
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  // Event handlers
  /on\w+\s*=\s*["'][^"']*["']/gi,
  // JavaScript URLs
  /javascript:/gi,
  // Data URLs with scripts
  /data:text\/html/gi,
  // Iframe tags
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  // Object/embed tags
  /<(object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi,
  // Style with expression
  /style\s*=\s*["'][^"']*expression\s*\([^"']*["']/gi,
];

// Suspicious keywords that might indicate malicious content
const SUSPICIOUS_KEYWORDS = [
  'javascript:',
  'vbscript:',
  'onload=',
  'onerror=',
  'onclick=',
  'onmouseover=',
  'onfocus=',
  'onblur=',
  'onchange=',
  'onsubmit=',
  '<script',
  '</script>',
  'document.cookie',
  'document.write',
  'window.location',
  'eval(',
  'setTimeout(',
  'setInterval(',
  'innerHTML',
  'outerHTML'
];

/**
 * Sanitize user input text
 * @param {string} input - Raw user input
 * @param {object} options - Sanitization options
 * @returns {string} - Sanitized input
 */
export const sanitizeUserInput = (input, options = {}) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const {
    maxLength = 10000,
    allowNewlines = true,
    allowEmojis = true,
    allowHashtags = true,
    allowMentions = true,
    allowUrls = true,
    preserveSpacing = false, // New option to preserve normal spacing
    encodeHTML = false // New option - only encode HTML when needed (e.g., for display in HTML context)
  } = options;

  let sanitized = input;

  // 1. Trim whitespace
  sanitized = sanitized.trim();

  // 2. Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // 3. Remove dangerous HTML/script patterns
  DANGEROUS_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });

  // 4. Encode HTML entities (only if encodeHTML is true)
  // For tweet content, we DON'T want HTML encoding (tweets are plain text)
  if (encodeHTML) {
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  } else {
    // For plain text (tweets), just remove dangerous HTML tags
    sanitized = sanitized
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  }

  // 5. Check for suspicious keywords and log warnings (but don't replace, just remove the actual malicious code)
  SUSPICIOUS_KEYWORDS.forEach(keyword => {
    if (sanitized.toLowerCase().includes(keyword.toLowerCase())) {
      console.warn(`Suspicious keyword detected in input: ${keyword}`);
      // Only remove if it's actually in executable context, not just mentioned
      // Don't replace with [REMOVED] - that creates garbage text
      const executablePattern = new RegExp(`${keyword}\s*[=(]`, 'gi');
      if (executablePattern.test(sanitized)) {
        sanitized = sanitized.replace(executablePattern, '');
      }
    }
  });

  // 6. Handle special Twitter elements
  if (!allowHashtags) {
    sanitized = sanitized.replace(/#\w+/g, '');
  }

  if (!allowMentions) {
    sanitized = sanitized.replace(/@\w+/g, '');
  }

  if (!allowUrls) {
    // Simple URL removal (could be enhanced)
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '');
  }

  if (!allowNewlines) {
    sanitized = sanitized.replace(/\n/g, ' ');
  }

  // 7. Handle whitespace based on preserveSpacing option
  if (preserveSpacing) {
    // For AI prompts and content where spacing matters, only remove excessive whitespace
    sanitized = sanitized.replace(/\s{4,}/g, '   '); // Replace 4+ spaces with 3 spaces
  } else {
    // For regular content, only normalize excessive whitespace but preserve normal spaces
    sanitized = sanitized.replace(/\s{3,}/g, '  '); // Replace 3+ spaces with 2 spaces
  }

  return sanitized;
};

/**
 * Sanitize AI-generated content
 * @param {string} content - AI-generated content
 * @param {object} options - Sanitization options
 * @returns {string} - Sanitized content
 */
export const sanitizeAIContent = (content, options = {}) => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const {
    maxLength = 5000,
    preserveFormatting = true,
    allowMarkdown = false
  } = options;

  let sanitized = content;

  // 1. Remove citation numbers and references that AI sometimes adds
  // Remove [1], [2], [3], etc. anywhere in the text
  sanitized = sanitized.replace(/\[\d+\]/g, '');
  
  // Remove citation patterns like (1), (2), etc.
  sanitized = sanitized.replace(/\(\d+\)/g, '');
  
  // Remove source citations at the end like "Source: [1]" or "Sources: [1][2]"
  sanitized = sanitized.replace(/\s*sources?:\s*\[?\d+\]?.*$/gi, '');

  // 2. Remove AI conversational prefixes and artifacts
  sanitized = sanitized
    .replace(/^(Here's a tweet:|Here's|Tweet:|AI:|Assistant:|Bot:)\s*/gi, '')
    .replace(/^(Here are \d+ tweets?:|Caption:)\s*/gi, '')
    .replace(/\[AI_GENERATED\]/gi, '')
    .replace(/\*\*Note:\*\*.*/gi, '')
    .replace(/\*Disclaimer:.*/gi, '')
    .replace(/^\d+\.\s+/gm, ''); // Remove numbered list prefixes like "1. "

  // 3. Detect and remove AI refusal/meta-commentary garbage
  // These are common patterns when AI refuses or explains instead of generating content
  const refusalPatterns = [
    /I appreciate the detailed instructions, but.*/gi,
    /I need to clarify my role.*/gi,
    /I'm (Perplexity|Claude|ChatGPT|an AI|a language model).*/gi,
    /I cannot (generate|create|write).*/gi,
    /I'm not designed to.*/gi,
    /I don't feel comfortable.*/gi,
    /As an AI (assistant|model).*/gi,
    /I apologize, but I (can't|cannot).*/gi,
    /I'm (sorry|unable) to.*/gi,
    /trained to synthesize information.*/gi,
    /search assistant trained.*/gi
  ];

  refusalPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });

  // 3. Clean up markdown if not allowed
  if (!allowMarkdown) {
    sanitized = sanitized
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '');
  }

  // 4. Decode HTML entities (in case AI or sanitization added them)
  // Tweets are plain text, not HTML, so decode everything
  sanitized = sanitized
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");

  // 5. Only remove truly dangerous executable patterns (but don't encode)
  // Just strip them out since tweets are plain text
  sanitized = sanitized
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // 6. Clean up excessive whitespace
  sanitized = sanitized
    .replace(/\s{3,}/g, '  ')
    .trim();

  // 7. Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // 8. Validate content quality
  if (sanitized.length < 10) {
    console.warn('AI generated content too short:', sanitized);
  }

  // 5. Check for repetitive content
  const words = sanitized.split(/\s+/);
  const uniqueWords = [...new Set(words)];
  if (words.length > 20 && uniqueWords.length / words.length < 0.3) {
    console.warn('AI content appears repetitive');
  }

  return sanitized.trim();
};

/**
 * Validate tweet content before posting
 * @param {string} content - Tweet content
 * @returns {object} - Validation result
 */
export const validateTweetContent = (content) => {
  const result = {
    isValid: true,
    errors: [],
    warnings: []
  };

  if (!content || typeof content !== 'string') {
    result.isValid = false;
    result.errors.push('Content is required');
    return result;
  }

  const sanitized = sanitizeUserInput(content, {
    encodeHTML: false // Tweets are plain text
  });

  // Length validation
  if (sanitized.length === 0) {
    result.isValid = false;
    result.errors.push('Content cannot be empty after sanitization');
  }

  if (sanitized.length > 280) {
    result.isValid = false;
    result.errors.push(`Content too long: ${sanitized.length}/280 characters`);
  }

  // Content quality checks
  if (sanitized.length < 10) {
    result.warnings.push('Content is very short');
  }

  // Check for only special characters
  if (!/[a-zA-Z0-9]/.test(sanitized)) {
    result.warnings.push('Content contains only special characters');
  }

  // Check for excessive caps
  const capsPercentage = (sanitized.match(/[A-Z]/g) || []).length / sanitized.length;
  if (capsPercentage > 0.5 && sanitized.length > 20) {
    result.warnings.push('Content contains excessive capital letters');
  }

  result.sanitizedContent = sanitized;
  return result;
};

/**
 * Sanitize image prompts
 * @param {string} prompt - Image generation prompt
 * @returns {string} - Sanitized prompt
 */
export const sanitizeImagePrompt = (prompt) => {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  let sanitized = prompt;

  // Remove potentially harmful content for image generation
  const harmfulImageTerms = [
    'nude', 'naked', 'nsfw', 'explicit', 'sexual', 'porn', 'xxx',
    'violence', 'blood', 'gore', 'weapon', 'gun', 'knife', 'bomb',
    'hate', 'racist', 'nazi', 'terrorism', 'illegal', 'drug',
    'copyright', 'trademark', 'disney', 'marvel', 'pokemon'
  ];

  harmfulImageTerms.forEach(term => {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    if (regex.test(sanitized)) {
      console.warn(`Potentially inappropriate image prompt term detected: ${term}`);
      sanitized = sanitized.replace(regex, '[FILTERED]');
    }
  });

  // Basic sanitization with preserveSpacing for image prompts
  sanitized = sanitizeUserInput(sanitized, {
    maxLength: 1000,
    allowNewlines: false,
    allowHashtags: false,
    allowMentions: false,
    allowUrls: false,
    preserveSpacing: true  // Allow normal spaces in image prompts
  });

  return sanitized;
};

/**
 * Clean and validate file uploads
 * @param {File} file - File object
 * @returns {object} - Validation result
 */
export const validateFileUpload = (file) => {
  const result = {
    isValid: true,
    errors: [],
    warnings: []
  };

  if (!file) {
    result.isValid = false;
    result.errors.push('No file provided');
    return result;
  }

  // File type validation
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    result.isValid = false;
    result.errors.push(`Invalid file type: ${file.type}`);
  }

  // File size validation (5MB)
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    result.isValid = false;
    result.errors.push(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 5MB)`);
  }

  // File name sanitization
  const safeName = file.name
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .substring(0, 100);

  result.sanitizedName = safeName;
  return result;
};

export default {
  sanitizeUserInput,
  sanitizeAIContent,
  validateTweetContent,
  sanitizeImagePrompt,
  validateFileUpload
};
