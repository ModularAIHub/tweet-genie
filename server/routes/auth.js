import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookieUtils.js';

const router = express.Router();

// Handle auth callback from platform - sets httpOnly cookie (GET method for redirects)
router.get('/callback', async (req, res) => {
  try {
    console.log('Auth callback called with query params:', req.query);
    const { token, refreshToken, session, redirect } = req.query;
    
    let finalToken = token;
    let finalRefreshToken = refreshToken;
    
    // Handle session token approach (secure)
    if (session) {
      try {
        // Verify and decode the session token
        const decoded = jwt.verify(session, process.env.JWT_SECRET || 'your-secret-key');
        
        if (decoded.type === 'session') {
          // Extract the actual tokens from the session
          finalToken = decoded.accessToken;
          finalRefreshToken = decoded.refreshToken;
          console.log('Session token decoded successfully');
        } else {
          throw new Error('Invalid session token type');
        }
      } catch (error) {
        console.error('Session token verification failed:', error);
        const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        return res.redirect(`${platformUrl}/login?error=invalid_session`);
      }
    }
    
    if (!finalToken) {
      console.log('No token provided, redirecting to platform login');
      // If no token, redirect to platform login
      const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
      return res.redirect(`${platformUrl}/login`);
    }

    console.log('Setting auth cookies...');
    // Set httpOnly cookies that match Platform's cookie names
    res.cookie('accessToken', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Set refresh token if available
    if (refreshToken) {
      console.log('Setting refresh token cookie...');
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days - matches Platform
      });
    } else {
      console.log('No refresh token provided in callback');
    }

    // Redirect to original URL or dashboard (clean URL without tokens)
    const finalRedirectUrl = redirect || '/dashboard';
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5174';
    const redirectTo = `${clientUrl}${finalRedirectUrl}`;
    
    console.log('Redirecting to clean URL:', redirectTo);
    res.redirect(redirectTo);
  } catch (error) {
    console.error('Auth callback error:', error);
    const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
    res.redirect(`${platformUrl}/login?error=callback_failed`);
  }
});

// Handle auth callback from platform - sets httpOnly cookie (POST method for API)
router.post('/callback', async (req, res) => {
  try {
    const { token, refreshToken, redirectUrl } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    // Set httpOnly cookies that match Platform's cookie names
    res.cookie('accessToken', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
      maxAge: 15 * 60 * 1000 // 15 minutes - matches Platform
    });

    // Set refresh token if available
    if (refreshToken) {
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days - matches Platform
      });
    }

    // Note: Both tokens are now properly set for automatic refresh

    // Redirect to original URL or dashboard
    const finalRedirectUrl = redirectUrl || '/dashboard';
    res.json({ 
      success: true, 
      redirectUrl: finalRedirectUrl 
    });
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({ error: 'Authentication callback failed' });
  }
});

// Validate authentication and attempt refresh if needed
router.get('/validate', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Refresh token endpoint for client-side token refresh
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    console.log('Attempting to refresh token via Platform...');
    
    // Forward refresh request to Platform
    const refreshResponse = await axios.post(
      `${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/refresh`,
      {},
      {
        headers: {
          'Cookie': `refreshToken=${refreshToken}`
        },
        withCredentials: true
      }
    );

    // Extract new tokens from Platform response
    const setCookieHeader = refreshResponse.headers['set-cookie'];
    if (setCookieHeader) {
      const accessTokenCookie = setCookieHeader.find(cookie => 
        cookie.startsWith('accessToken=')
      );
      const refreshTokenCookie = setCookieHeader.find(cookie => 
        cookie.startsWith('refreshToken=')
      );

      // Cookie options for cross-subdomain auth
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieDomain = process.env.COOKIE_DOMAIN || '.suitegenie.in';
      const accessTokenOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000,
        ...(isProduction ? { domain: cookieDomain } : {})
      };
      const refreshTokenOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        ...(isProduction ? { domain: cookieDomain } : {})
      };

      if (accessTokenCookie) {
        const newAccessToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
        res.cookie('accessToken', newAccessToken, accessTokenOptions);

        if (refreshTokenCookie) {
          const newRefreshToken = refreshTokenCookie.split('refreshToken=')[1].split(';')[0];
          res.cookie('refreshToken', newRefreshToken, refreshTokenOptions);
        }

        console.log('Token refreshed successfully');
        res.json({ success: true, message: 'Token refreshed' });
      } else {
        throw new Error('No access token in Platform response');
      }
    } else {
      throw new Error('No cookies in Platform response');
    }
  } catch (error) {
    console.error('Token refresh error:', error.message);
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// Get CSRF token (for compatibility with frontend)
router.get('/csrf-token', (req, res) => {
  // For now, return a dummy CSRF token since Tweet Genie doesn't implement CSRF protection
  // This endpoint exists just to prevent frontend 404 errors
  res.json({ 
    csrfToken: 'dummy-csrf-token',
    message: 'CSRF protection not implemented in Tweet Genie' 
  });
});

// Logout route - clears cookie
router.post('/logout', (req, res) => {
  // Clear authentication cookies using utility function
  clearAuthCookies(res);
  res.json({ success: true });
});

export default router;
