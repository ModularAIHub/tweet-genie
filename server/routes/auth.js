import express from 'express';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Handle auth callback from platform - sets httpOnly cookie (GET method for redirects)
router.get('/callback', async (req, res) => {
  try {
    console.log('Auth callback called with query params:', req.query);
    const { token, refreshToken, redirect } = req.query;
    
    if (!token) {
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
      domain: '.kanishksaraswat.me',
      maxAge: 15 * 60 * 1000 // 15 minutes - matches Platform
    });

    // Set refresh token if available
    if (refreshToken) {
      console.log('Setting refresh token cookie...');
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: '.kanishksaraswat.me',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days - matches Platform
      });
    } else {
      console.log('No refresh token provided in callback');
    }

    // Redirect to original URL or dashboard
    const finalRedirectUrl = redirect || '/dashboard';
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5174';
    const redirectTo = `${clientUrl}${finalRedirectUrl}`;
    
    console.log('Redirecting to:', redirectTo);
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
      domain: '.kanishksaraswat.me',
      maxAge: 15 * 60 * 1000 // 15 minutes - matches Platform
    });

    // Set refresh token if available
    if (refreshToken) {
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: '.kanishksaraswat.me',
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

      if (accessTokenCookie) {
        const newAccessToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
        
        // Set new access token cookie
        res.cookie('accessToken', newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 15 * 60 * 1000 // 15 minutes
        });

        // Update refresh token if provided
        if (refreshTokenCookie) {
          const newRefreshToken = refreshTokenCookie.split('refreshToken=')[1].split(';')[0];
          res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
          });
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

// Logout route - clears cookie
router.post('/logout', (req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.json({ success: true });
});

export default router;
