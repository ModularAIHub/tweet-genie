import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';

export const authenticateToken = async (req, res, next) => {
  try {
    // First try to get token from httpOnly cookie
    let token = req.cookies?.authToken;
    
    // Fallback to Authorization header for API compatibility
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      // For web requests, redirect to platform for login
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const redirectUrl = encodeURIComponent(req.originalUrl);
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(`${process.env.TWEET_GENIE_URL || 'http://localhost:5174'}${redirectUrl}`)}`;
        return res.redirect(platformLoginUrl);
      }
      // For API requests, return 401
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user details from platform
    try {
      const response = await axios.get(`${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-API-Key': process.env.PLATFORM_API_KEY
        }
      });

      req.user = {
        id: decoded.userId,
        email: decoded.email,
        ...response.data.user
      };
    } catch (platformError) {
      // If platform is unavailable or token is invalid, redirect for re-auth
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const redirectUrl = encodeURIComponent(req.originalUrl);
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(`${process.env.TWEET_GENIE_URL || 'http://localhost:5174'}${redirectUrl}`)}`;
        return res.redirect(platformLoginUrl);
      }
      
      // Fallback to token data if platform is unavailable
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
        const redirectUrl = encodeURIComponent(req.originalUrl);
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(`${process.env.TWEET_GENIE_URL || 'http://localhost:5174'}${redirectUrl}`)}`;
        return res.redirect(platformLoginUrl);
      }
      return res.status(401).json({ error: 'Token expired' });
    }
    
    // For invalid tokens, redirect to platform
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const redirectUrl = encodeURIComponent(req.originalUrl);
      const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(`${process.env.TWEET_GENIE_URL || 'http://localhost:5174'}${redirectUrl}`)}`;
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
