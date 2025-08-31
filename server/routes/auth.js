import express from 'express';
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000 // 15 minutes - matches Platform
    });

    // Set refresh token if available
    if (refreshToken) {
      console.log('Setting refresh token cookie...');
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000 // 15 minutes - matches Platform
    });

    // Set refresh token if available
    if (refreshToken) {
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
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

// Logout route - clears cookie
router.post('/logout', (req, res) => {
  res.clearCookie('authToken');
  res.json({ success: true });
});

// This route will be used to validate tokens from the main hub
router.get('/validate', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email
      }
    });
  } catch (error) {
    console.error('Auth validation error:', error);
    res.status(500).json({ error: 'Authentication validation failed' });
  }
});

export default router;
