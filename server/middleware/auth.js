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
      // For web requests, redirect to platform for login
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5174'}${req.originalUrl}`;
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
        console.log('❌ No token - redirecting to platform login:', platformLoginUrl);
        return res.redirect(platformLoginUrl);
      }
      // For API requests, return 401
      console.log('No token - returning 401 for API request');
      return res.status(401).json({ error: 'Access token required' });
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
    // Check if user has valid Twitter connection
    const { rows } = await pool.query(
      'SELECT * FROM twitter_accounts WHERE user_id = $1 AND is_active = true',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    req.twitterAccount = rows[0];
    next();
  } catch (error) {
    console.error('Twitter validation error:', error);
    res.status(500).json({ error: 'Failed to validate Twitter connection' });
  }
};
