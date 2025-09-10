/**
 * Cookie utility functions for handling authentication cookies
 * across different environments (localhost vs production)
 */

/**
 * Get cookie options based on environment
 * @param {number} maxAge - Cookie expiration time in milliseconds
 * @returns {object} Cookie options object
 */
export const getCookieOptions = (maxAge = 15 * 60 * 1000) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge
  };
  
  // Set domain based on environment
  if (isProduction) {
    options.domain = '.suitegenie.in';
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
  
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  };
  
  // Set domain based on environment
  if (isProduction) {
    options.domain = '.suitegenie.in';
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
  // Set access token (15 minutes)
  const accessTokenOptions = getCookieOptions(15 * 60 * 1000);
  res.cookie('accessToken', accessToken, accessTokenOptions);
  
  // Set refresh token if provided (7 days)
  if (refreshToken) {
    const refreshTokenOptions = getCookieOptions(7 * 24 * 60 * 60 * 1000);
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
