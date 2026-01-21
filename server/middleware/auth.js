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
            `${process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api'}/auth/refresh`,
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
                sameSite: 'none', // must be 'none' for cross-domain
                domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
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
          // Clear refreshToken cookie to prevent infinite loop
          res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none',
            domain: process.env.COOKIE_DOMAIN || '.suitegenie.in'
          });
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
            `${process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api'}/auth/refresh`,
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
                sameSite: 'none', // must be 'none' for cross-domain
                domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
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

    // Patch: Query team membership and set teamId/teamMemberships
    try {
      // Check for team membership in team_members table
      const teamMembershipResult = await pool.query(
        `SELECT team_id, role, status FROM team_members WHERE user_id = $1 AND status = 'active'`,
        [req.user.id]
      );
      if (teamMembershipResult.rows.length > 0) {
        // User is in one or more teams
  req.user.teamId = teamMembershipResult.rows[0].team_id;
  req.user.team_id = teamMembershipResult.rows[0].team_id; // snake_case for frontend compatibility
        req.user.teamMemberships = teamMembershipResult.rows.map(row => ({
          teamId: row.team_id,
          role: row.role,
          status: row.status
        }));
        console.log('[AUTH PATCH] User teamId set:', req.user.teamId);
        console.log('[AUTH PATCH] User teamMemberships:', req.user.teamMemberships);
      } else {
        req.user.teamId = undefined;
        req.user.teamMemberships = [];
        console.log('[AUTH PATCH] User has no active team memberships');
      }
    } catch (teamErr) {
      console.error('[AUTH PATCH] Error querying team memberships:', teamErr);
      req.user.teamId = undefined;
      req.user.teamMemberships = [];
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
    let twitterAuthData;
    let isTeamAccount = false;
    
    // Check for selected team account first (from header)
    const selectedAccountId = req.headers['x-selected-account-id'];
    const userId = req.user?.id || req.user?.userId;
    const teamId = req.user?.teamId || req.user?.team_id || req.ssoUser?.teamId;

    // Only try team account lookup if user is actually in a team AND has selected account ID
    if (selectedAccountId && teamId) {
      try {
        // Try to get team account credentials (OAuth2)
        const { rows } = await pool.query(
          'SELECT * FROM team_accounts WHERE id = $1 AND team_id = $2 AND active = true',
          [selectedAccountId, teamId]
        );
        if (rows.length > 0) {
          twitterAuthData = rows[0];
          isTeamAccount = true;
        }
      } catch (teamQueryErr) {
        // If team account query fails (e.g., invalid UUID format), ignore and fall back to personal account
        console.log('[validateTwitterConnection] Team account query failed, falling back to personal account:', teamQueryErr.message);
      }
    }
    
    // Fall back to personal twitter_auth if no team account
    if (!twitterAuthData) {
      const { rows } = await pool.query(
        'SELECT * FROM twitter_auth WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Twitter account not connected' });
      }

      twitterAuthData = rows[0];
    }
    
    // Check if token is expired or expiring soon (refresh 10 minutes before expiry)
    const now = new Date();
    const tokenExpiry = new Date(twitterAuthData.token_expires_at);
    const refreshThreshold = new Date(tokenExpiry.getTime() - (10 * 60 * 1000)); // 10 minutes before expiry
    const minutesUntilExpiry = Math.floor((tokenExpiry - now) / (60 * 1000));
    
    console.log('[Twitter Token Status]', {
      accountType: isTeamAccount ? 'team' : 'personal',
      expiresAt: tokenExpiry.toISOString(),
      minutesUntilExpiry,
      isExpired: tokenExpiry <= now,
      needsRefresh: now >= refreshThreshold
    });
    
    if (tokenExpiry <= now || now >= refreshThreshold) {
      const isExpired = tokenExpiry <= now;
      console.log(`[Twitter Token] ${isExpired ? '⚠️ Token EXPIRED' : '⏰ Token expiring soon, attempting refresh...'} (${minutesUntilExpiry} minutes until expiry)`);
      
      // Try to refresh the token if we have a refresh token
      if (twitterAuthData.refresh_token) {
        try {
          const credentials = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
          
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
          
          if (tokens.access_token) {
            console.log('✅ Twitter token refreshed successfully');
            // Update tokens in database
            const newExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
            console.log('[Twitter Token] New expiry:', newExpiresAt.toISOString());
            
            if (isTeamAccount) {
              // Update team_accounts table
              await pool.query(
                'UPDATE team_accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
                [tokens.access_token, tokens.refresh_token || twitterAuthData.refresh_token, newExpiresAt, twitterAuthData.id]
              );
            } else {
              // Update twitter_auth table
              await pool.query(
                'UPDATE twitter_auth SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4',
                [tokens.access_token, tokens.refresh_token || twitterAuthData.refresh_token, newExpiresAt, userId]
              );
            }
            
            // Use the new token
            twitterAuthData.access_token = tokens.access_token;
            twitterAuthData.refresh_token = tokens.refresh_token || twitterAuthData.refresh_token;
            twitterAuthData.token_expires_at = newExpiresAt;
          } else {
            console.warn('⚠️ Twitter token refresh returned no access token:', tokens);
            // Only return error if token is actually expired, not just expiring soon
            if (isExpired) {
              console.error('❌ Token expired and cannot be refreshed. User must reconnect.');
              return res.status(401).json({ 
                error: 'Twitter token expired and refresh failed. Please reconnect your Twitter account.',
                code: 'TWITTER_TOKEN_EXPIRED',
                action: 'reconnect_twitter',
                details: tokens.error_description || tokens.error,
                minutesUntilExpiry: 0
              });
            } else {
              console.warn(`⚠️ Token refresh failed but token still valid for ${minutesUntilExpiry} minutes. Continuing...`);
            }
          }
        } catch (refreshError) {
          console.error('❌ Twitter token refresh error:', refreshError.message);
          // Only return error if token is actually expired, not just expiring soon
          if (isExpired) {
            console.error('❌ Token expired and refresh failed. User must reconnect their Twitter account.');
            return res.status(401).json({ 
              error: 'Twitter token expired and refresh failed. Please reconnect your Twitter account.',
              code: 'TWITTER_TOKEN_EXPIRED',
              action: 'reconnect_twitter',
              details: refreshError.message,
              minutesUntilExpiry: 0
            });
          } else {
            console.warn(`⚠️ Token refresh failed but token still valid for ${minutesUntilExpiry} minutes. Continuing...`);
          }
        }
      } else {
        console.warn('⚠️ No refresh token available for this account');
        // Only return error if token is actually expired, not just expiring soon
        if (isExpired) {
          console.error('❌ Token expired and no refresh token. User must reconnect their Twitter account.');
          return res.status(401).json({ 
            error: 'Twitter token expired. Please reconnect your Twitter account.',
            code: 'TWITTER_TOKEN_EXPIRED',
            action: 'reconnect_twitter',
            minutesUntilExpiry: 0
          });
        } else {
          console.warn(`⚠️ No refresh token but token still valid for ${minutesUntilExpiry} minutes. Continuing...`);
        }
      }
    } else {
      console.log(`✅ Twitter token valid for ${minutesUntilExpiry} minutes`);
    }

    // Map the account data to the expected format for tweet posting
    req.twitterAccount = {
      id: twitterAuthData.id,
      twitter_user_id: twitterAuthData.twitter_user_id,
      username: twitterAuthData.twitter_username,
      display_name: twitterAuthData.twitter_display_name || twitterAuthData.twitter_username,
      access_token: twitterAuthData.access_token,
      access_token_secret: twitterAuthData.access_token_secret,
      refresh_token: twitterAuthData.refresh_token,
      oauth1_access_token: twitterAuthData.oauth1_access_token,
      oauth1_access_token_secret: twitterAuthData.oauth1_access_token_secret,
      isTeamAccount: isTeamAccount
    };
    
    next();
  } catch (error) {
    console.error('Twitter validation error:', error);
    res.status(500).json({ error: 'Failed to validate Twitter connection' });
  }
};
