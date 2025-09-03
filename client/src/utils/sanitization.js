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
    preserveSpacing = false // New option to preserve normal spacing
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

  // 4. Encode HTML entities
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // 5. Check for suspicious keywords and log warnings
  SUSPICIOUS_KEYWORDS.forEach(keyword => {
    if (sanitized.toLowerCase().includes(keyword.toLowerCase())) {
      console.warn(`Suspicious keyword detected in input: ${keyword}`);
      // Remove the suspicious content
      sanitized = sanitized.replace(new RegExp(keyword, 'gi'), '[REMOVED]');
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
    sanitized = sanitized.replace(/   +/g, '  ').trim(); // Replace 3+ spaces with 2 spaces
  } else {
    // For regular content, normalize all whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
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

  // 1. Basic safety sanitization
  sanitized = sanitizeUserInput(sanitized, {
    maxLength,
    allowNewlines: preserveFormatting,
    allowEmojis: true,
    allowHashtags: true,
    allowMentions: true,
    allowUrls: true
  });

  // 2. AI-specific cleaning
  // Remove AI artifacts
  sanitized = sanitized
    .replace(/^(AI:|Assistant:|Bot:)/gi, '') // Remove AI prefixes
    .replace(/\[AI_GENERATED\]/gi, '') // Remove AI markers
    .replace(/\*\*Note:\*\*.*/gi, '') // Remove AI notes
    .replace(/\*Disclaimer:.*/gi, ''); // Remove disclaimers

  // 3. Clean up common AI formatting issues
  if (!allowMarkdown) {
    sanitized = sanitized
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markdown
      .replace(/\*(.*?)\*/g, '$1') // Remove italic markdown
      .replace(/`(.*?)`/g, '$1') // Remove code markdown
      .replace(/#{1,6}\s/g, ''); // Remove heading markdown
  }

  // 4. Validate content quality
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

  const sanitized = sanitizeUserInput(content);

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
