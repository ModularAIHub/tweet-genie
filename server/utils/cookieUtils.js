/**
 * Cookie utility functions for handling authentication cookies
 * across different environments (localhost vs production)
 */

const DEFAULT_SESSION_COOKIE_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;

const parseDurationToMs = (value, fallbackMs) => {
  const raw = String(value || '').trim();
  if (!raw) return fallbackMs;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }

  const match = raw.match(/^(\d+)\s*(ms|s|m|h|d|w)$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  }[unit];

  return Number.isFinite(amount) && multiplier ? amount * multiplier : fallbackMs;
};

const getSessionCookieMaxAgeMs = () =>
  parseDurationToMs(process.env.AUTH_SESSION_MAX_AGE || process.env.JWT_REFRESH_EXPIRES_IN, DEFAULT_SESSION_COOKIE_MAX_AGE_MS);

const isLocalhostLike = () => {
  const clientUrl = String(process.env.CLIENT_URL || '');
  const cookieDomain = String(process.env.COOKIE_DOMAIN || '');
  return clientUrl.includes('localhost') || clientUrl.includes('127.0.0.1') || cookieDomain === 'localhost';
};

/**
 * Get cookie options based on environment
 * @param {number} maxAge - Cookie expiration time in milliseconds
 * @returns {object} Cookie options object
 */
export const getCookieOptions = (maxAge = getSessionCookieMaxAgeMs()) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const useCrossSiteCookie = isProduction && !isLocalhostLike();
  
  const options = {
    httpOnly: true,
    secure: useCrossSiteCookie,
    sameSite: useCrossSiteCookie ? 'none' : 'lax',
    maxAge,
    path: '/' // Ensure cookie is available for all paths
  };
  
  // Set domain based on environment
  if (useCrossSiteCookie) {
    options.domain = process.env.COOKIE_DOMAIN || '.suitegenie.in';
  }
  // For localhost, don't set domain (defaults to current host)
  // This allows cookies to work on localhost:3000, localhost:3002, etc.
  
  return options;
};

/**
 * Get cookie clear options (used for logout)
 * @returns {object} Cookie clear options object
 */
export const getClearCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const useCrossSiteCookie = isProduction && !isLocalhostLike();
  
  const options = {
    httpOnly: true,
    secure: useCrossSiteCookie,
    sameSite: useCrossSiteCookie ? 'none' : 'lax',
    path: '/' // Match the path used when setting cookies
  };
  
  // Set domain based on environment
  if (useCrossSiteCookie) {
    options.domain = process.env.COOKIE_DOMAIN || '.suitegenie.in';
  }
  
  return options;
};

/**
 * Set authentication cookies with proper options
 * @param {object} res - Express response object
 * @param {string} accessToken - Access token to set
 * @param {string} refreshToken - Refresh token to set (optional)
 */
export const setAuthCookies = (res, accessToken, refreshToken = null) => {
  const sessionCookieMaxAgeMs = getSessionCookieMaxAgeMs();
  const accessTokenOptions = getCookieOptions(sessionCookieMaxAgeMs);
  res.cookie('accessToken', accessToken, accessTokenOptions);
  
  // Set refresh token if provided
  if (refreshToken) {
    const refreshTokenOptions = getCookieOptions(sessionCookieMaxAgeMs);
    res.cookie('refreshToken', refreshToken, refreshTokenOptions);
  }
};

/**
 * Clear authentication cookies
 * @param {object} res - Express response object
 */
export const clearAuthCookies = (res) => {
  const clearOptions = getClearCookieOptions();
  res.clearCookie('accessToken', clearOptions);
  res.clearCookie('refreshToken', clearOptions);
};
