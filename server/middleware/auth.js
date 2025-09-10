import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';

export const authenticateToken = async (req, res, next) => {
  try {
    console.log('🔐 Auth middleware called for:', req.method, req.path);
    console.log('🍪 All cookies:', req.cookies);
    console.log('🔑 Authorization header:', req.headers.authorization);
    
    // First try to get token from httpOnly cookie (Platform uses 'accessToken')
    let token = req.cookies?.accessToken;
    
    // Fallback to Authorization header for API compatibility
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    console.log('✅ Token found:', !!token);
    if (token) {
      console.log('🎫 Token preview:', token.substring(0, 20) + '...');
    }

    if (!token) {
      // Check if we have a refresh token to get a new access token
      if (req.cookies?.refreshToken) {
        console.log('❌ No access token but refresh token found - attempting automatic refresh...');
        try {
          const refreshResponse = await axios.post(
            `${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/refresh`,
            {},
            {
              headers: {
                'Cookie': `refreshToken=${req.cookies.refreshToken}`
              },
              withCredentials: true
            }
          );
          
          // Extract new access token from response cookies
          const setCookieHeader = refreshResponse.headers['set-cookie'];
          if (setCookieHeader) {
            const accessTokenCookie = setCookieHeader.find(cookie => 
              cookie.startsWith('accessToken=')
            );
            if (accessTokenCookie) {
              const newToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
              console.log('✅ New access token obtained from refresh token');
              
              // Set the new token in response cookies for future requests
              res.cookie('accessToken', newToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 15 * 60 * 1000 // 15 minutes
              });
              
              // Use the new token and continue with authentication
              token = newToken;
            } else {
              throw new Error('No access token in refresh response');
            }
          } else {
            throw new Error('No cookies in refresh response');
          }
        } catch (refreshError) {
          console.log('❌ Refresh token failed:', refreshError.message);
          // Fallback to login redirect if refresh fails
          if (req.headers.accept && req.headers.accept.includes('text/html')) {
            const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
            const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
            console.log('Redirecting to platform login after refresh failure:', platformLoginUrl);
            return res.redirect(platformLoginUrl);
          }
          return res.status(401).json({ error: 'Authentication required' });
        }
      } else {
        // No tokens at all - redirect to login
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
          const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
          const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
          console.log('❌ No tokens - redirecting to platform login:', platformLoginUrl);
          return res.redirect(platformLoginUrl);
        }
        // For API requests, return 401
        console.log('No tokens - returning 401 for API request');
        return res.status(401).json({ error: 'Access token required' });
      }
    }

    console.log('Verifying JWT token...');
    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token verified for user:', decoded.userId);
      console.log('Token payload:', decoded);
    } catch (jwtError) {
      console.log('JWT verification failed:', jwtError.message);
      console.log('JWT error name:', jwtError.name);
      console.log('JWT_SECRET configured:', !!process.env.JWT_SECRET);
      console.log('JWT_SECRET length:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0);
      
      // If token expired, try to refresh it
      if (jwtError.name === 'TokenExpiredError' && req.cookies?.refreshToken) {
        console.log('Token expired, attempting refresh...');
        try {
          const refreshResponse = await axios.post(
            `${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/refresh`,
            {},
            {
              headers: {
                'Cookie': `refreshToken=${req.cookies.refreshToken}`
              },
              withCredentials: true
            }
          );
          // Extract new access token from response cookies
          const setCookieHeader = refreshResponse.headers['set-cookie'];
          if (setCookieHeader) {
            const accessTokenCookie = setCookieHeader.find(cookie => 
              cookie.startsWith('accessToken=')
            );
            if (accessTokenCookie) {
              const newToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
              console.log('Token refreshed successfully');
              // Verify the new token
              decoded = jwt.verify(newToken, process.env.JWT_SECRET);
              console.log('New token verified for user:', decoded.userId);
              // Set the new token in response cookies for future requests
              res.cookie('accessToken', newToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 15 * 60 * 1000 // 15 minutes
              });
              // Use the new token for subsequent platform requests
              token = newToken;
            } else {
              throw new Error('No access token in refresh response');
            }
          } else {
            throw new Error('No cookies in refresh response');
          }
        } catch (refreshError) {
          console.log('Token refresh failed:', refreshError.message);
          // Redirect to login if refresh fails
          if (req.headers.accept && req.headers.accept.includes('text/html')) {
            const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
            const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
            console.log('Redirecting to platform login after refresh failure:', platformLoginUrl);
            return res.redirect(platformLoginUrl);
          }
          return res.status(401).json({ error: 'Authentication failed' });
        }
      } else {
        // If JWT is invalid or no refresh token, redirect to login for web requests
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
          const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
          const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
          console.log('JWT invalid - redirecting to login:', platformLoginUrl);
          return res.redirect(platformLoginUrl);
        }
        
        // For API requests, return 401
        return res.status(401).json({ error: 'Invalid token' });
      }
    }
    
    // Get user details from platform
    try {
      console.log('Calling platform /api/auth/me...');
      console.log('Platform URL:', process.env.PLATFORM_URL);
      
      const response = await axios.get(`${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
          // Removed X-API-Key as Platform doesn't use it
        }
      });

      console.log('Platform response status:', response.status);

      req.user = {
        id: decoded.userId,
        email: decoded.email,
        ...response.data
      };
      
      console.log('User authenticated successfully via platform');
    } catch (platformError) {
      console.log('Platform error details:');
      console.log('Status:', platformError.response?.status);
      console.log('Data:', platformError.response?.data);
      console.log('Message:', platformError.message);
      
      // For API requests, use fallback user data from JWT token
      if (!req.headers.accept || !req.headers.accept.includes('text/html')) {
        console.log('API request - using fallback user data from JWT token');
        req.user = {
          id: decoded.userId,
          email: decoded.email
        };
        return next();
      }
      
      // For web requests, only redirect if it's a 401/403 (auth issue)
      if (platformError.response?.status === 401 || platformError.response?.status === 403) {
        const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
        console.log('Platform auth error, redirecting to login:', platformLoginUrl);
        return res.redirect(platformLoginUrl);
      }
      
      // For other errors (500, network issues), use fallback
      console.log('Platform unavailable - using fallback user data from JWT token');
      req.user = {
        id: decoded.userId,
        email: decoded.email
      };
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      // For web requests, redirect to platform for re-authentication
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
        console.log('Token expired, redirecting to login:', platformLoginUrl);
        return res.redirect(platformLoginUrl);
      }
      return res.status(401).json({ error: 'Token expired' });
    }
    
    // For invalid tokens, redirect to platform
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
      const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
      console.log('Invalid token, redirecting to login:', platformLoginUrl);
      return res.redirect(platformLoginUrl);
    }
    
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export const validateTwitterConnection = async (req, res, next) => {
  try {
    // Check if user has valid Twitter connection in twitter_auth table
    const { rows } = await pool.query(
      'SELECT * FROM twitter_auth WHERE user_id = $1',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const twitterAuthData = rows[0];
    
    // Check if token is expired or expiring soon (refresh 10 minutes before expiry)
    const now = new Date();
    const tokenExpiry = new Date(twitterAuthData.token_expires_at);
    const refreshThreshold = new Date(tokenExpiry.getTime() - (10 * 60 * 1000)); // 10 minutes before expiry
    
    // More detailed logging
    console.log('Twitter token detailed check:', {
      userId: req.user.id,
      now: now.toISOString(),
      expires: tokenExpiry.toISOString(),
      refreshThreshold: refreshThreshold.toISOString(),
      tokenAge: Math.round((now - new Date(twitterAuthData.updated_at || twitterAuthData.created_at)) / 1000 / 60), // minutes old
      timeUntilExpiry: Math.round((tokenExpiry - now) / 1000 / 60), // minutes until expiry
      isExpired: tokenExpiry <= now,
      needsRefresh: now >= refreshThreshold,
      hasRefreshToken: !!twitterAuthData.refresh_token,
      refreshTokenPreview: twitterAuthData.refresh_token ? twitterAuthData.refresh_token.substring(0, 20) + '...' : 'none'
    });
    
    if (tokenExpiry <= now || now >= refreshThreshold) {
      const isExpired = tokenExpiry <= now;
      console.log(isExpired ? 'Twitter token EXPIRED, attempting refresh...' : 'Twitter token expiring soon, proactively refreshing...');
      
      // Try to refresh the token if we have a refresh token
      if (twitterAuthData.refresh_token) {
        try {
          const credentials = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
          
          console.log('Making Twitter token refresh request...');
          console.log('Using refresh token:', twitterAuthData.refresh_token.substring(0, 20) + '...');
          
          const refreshResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${credentials}`
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: twitterAuthData.refresh_token,
              client_id: process.env.TWITTER_CLIENT_ID,
            }),
          });

          const tokens = await refreshResponse.json();
          console.log('Twitter refresh response:', { 
            status: refreshResponse.status,
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token,
            expiresIn: tokens.expires_in,
            error: tokens.error,
            errorDescription: tokens.error_description
          });
          
          if (tokens.access_token) {
            console.log('✅ Twitter token refreshed successfully');
            
            // Update tokens in database
            const newExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
            const updateResult = await pool.query(
              'UPDATE twitter_auth SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
              [tokens.access_token, tokens.refresh_token || twitterAuthData.refresh_token, newExpiresAt, req.user.id]
            );
            
            console.log('Database updated with new tokens:', {
              newExpiresAt: newExpiresAt.toISOString(),
              hoursValid: Math.round((newExpiresAt - now) / 1000 / 60 / 60 * 100) / 100
            });
            
            // Use the new token
            twitterAuthData.access_token = tokens.access_token;
            twitterAuthData.refresh_token = tokens.refresh_token || twitterAuthData.refresh_token;
            twitterAuthData.token_expires_at = newExpiresAt;
          } else {
            console.log('❌ Failed to refresh Twitter token:', tokens);
            // Only return error if token is actually expired, not just expiring soon
            if (isExpired) {
              return res.status(401).json({ 
                error: 'Twitter token expired and refresh failed. Please reconnect your Twitter account.',
                code: 'TWITTER_TOKEN_EXPIRED',
                action: 'reconnect_twitter',
                details: tokens.error_description || tokens.error
              });
            }
          }
        } catch (refreshError) {
          console.error('❌ Twitter token refresh error:', refreshError);
          // Only return error if token is actually expired, not just expiring soon
          if (isExpired) {
            return res.status(401).json({ 
              error: 'Twitter token expired and refresh failed. Please reconnect your Twitter account.',
              code: 'TWITTER_TOKEN_EXPIRED',
              action: 'reconnect_twitter',
              details: refreshError.message
            });
          }
        }
      } else {
        console.log('❌ No refresh token available');
        // Only return error if token is actually expired, not just expiring soon
        if (isExpired) {
          return res.status(401).json({ 
            error: 'Twitter token expired. Please reconnect your Twitter account.',
            code: 'TWITTER_TOKEN_EXPIRED',
            action: 'reconnect_twitter'
          });
        }
      }
    } else {
      console.log('✅ Twitter token is still valid, no refresh needed');
    }

    // Map the twitter_auth data to the expected format for tweet posting
    req.twitterAccount = {
      id: twitterAuthData.id, // Use the UUID id from twitter_auth table
      twitter_user_id: twitterAuthData.twitter_user_id, // Keep the Twitter ID for reference
      username: twitterAuthData.twitter_username,
      display_name: twitterAuthData.twitter_display_name,
      access_token: twitterAuthData.access_token,
      access_token_secret: twitterAuthData.access_token_secret,
      refresh_token: twitterAuthData.refresh_token,
      oauth1_access_token: twitterAuthData.oauth1_access_token,
      oauth1_access_token_secret: twitterAuthData.oauth1_access_token_secret
    };
    
    next();
  } catch (error) {
    console.error('Twitter validation error:', error);
    res.status(500).json({ error: 'Failed to validate Twitter connection' });
  }
};
