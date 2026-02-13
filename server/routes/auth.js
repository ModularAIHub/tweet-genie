import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookieUtils.js';

const router = express.Router();
const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';

const authLog = (...args) => {
  if (AUTH_DEBUG) {
    console.log(...args);
  }
};

const sendAuthCompletionPage = (
  res,
  redirectTo,
  {
    message = 'Authentication completed. Returning to Tweet Genie...',
    eventType = 'AUTH_SUCCESS',
    payload = {},
  } = {}
) => {
  const eventData = JSON.stringify({ type: eventType, redirectTo, ...payload })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const safeMessage = String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeRedirect = JSON.stringify(redirectTo)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

  return res.send(`
    <html>
      <body>
        <script>
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage(${eventData}, '*');
            }
          } catch (e) {}

          setTimeout(function () {
            try { window.close(); } catch (e) {}
            setTimeout(function () {
              if (!window.closed) {
                window.location.replace(${safeRedirect});
              }
            }, 80);
          }, 20);
        </script>
        <p>${safeMessage}</p>
      </body>
    </html>
  `);
};

// Handle auth callback from platform - sets httpOnly cookie (GET method for redirects)
router.get('/callback', async (req, res) => {
  try {
    authLog('Auth callback called with query params:', req.query);
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
          authLog('Session token decoded successfully');
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
      authLog('No token provided, redirecting to platform login');
      // If no token, redirect to platform login
      const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
      return res.redirect(`${platformUrl}/login`);
    }

    authLog('Setting auth cookies...');
    setAuthCookies(res, finalToken, finalRefreshToken || null);

    // Redirect to original URL or dashboard (clean URL without tokens)
    const finalRedirectUrl = redirect || '/dashboard';
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5174';
    const redirectTo = `${clientUrl}${finalRedirectUrl}`;
    
    authLog('Completing auth callback, redirect target:', redirectTo);
    return sendAuthCompletionPage(res, redirectTo);
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

    setAuthCookies(res, token, refreshToken || null);

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
    const platformApiUrl = process.env.PLATFORM_API_URL || process.env.PLATFORM_URL || 'http://localhost:3000';
    const refreshToken = req.cookies?.refreshToken;
    const csrfToken = req.cookies?._csrf || req.headers['x-csrf-token'];
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required', code: 'NO_REFRESH_TOKEN' });
    }

    authLog('Attempting to refresh token via Platform...');

    const cookieParts = [`refreshToken=${refreshToken}`];
    const outboundHeaders = {
      'Content-Type': 'application/json',
    };

    if (csrfToken) {
      cookieParts.push(`_csrf=${csrfToken}`);
      outboundHeaders['x-csrf-token'] = csrfToken;
    }

    outboundHeaders.Cookie = cookieParts.join('; ');
    
    // Forward refresh request to Platform with proper cookie format
    const refreshResponse = await axios.post(
      `${platformApiUrl}/api/auth/refresh`,
      {},
      {
        headers: outboundHeaders,
        withCredentials: true,
        timeout: 10000,
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      }
    );

    // Check if refresh failed
    if (refreshResponse.status !== 200) {
      const refreshError = refreshResponse?.data?.error || refreshResponse?.data?.message || 'unknown';
      console.warn('Platform refresh failed:', refreshResponse.status, refreshError);
      // Clear invalid refresh token
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieDomain = process.env.COOKIE_DOMAIN || '.suitegenie.in';
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        ...(isProduction ? { domain: cookieDomain } : {})
      });
      return res.status(401).json({ 
        error: 'Token refresh failed', 
        code: 'REFRESH_FAILED',
        details: refreshResponse.data 
      });
    }

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
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: '/',
        ...(isProduction ? { domain: cookieDomain } : {})
      };
      const refreshTokenOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: '/',
        ...(isProduction ? { domain: cookieDomain } : {})
      };

      if (accessTokenCookie) {
        const newAccessToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
        res.cookie('accessToken', newAccessToken, accessTokenOptions);

        if (refreshTokenCookie) {
          const newRefreshToken = refreshTokenCookie.split('refreshToken=')[1].split(';')[0];
          res.cookie('refreshToken', newRefreshToken, refreshTokenOptions);
        }

        authLog('Token refreshed successfully');
        res.json({ success: true, message: 'Token refreshed' });
      } else {
        throw new Error('No access token in Platform response');
      }
    } else {
      throw new Error('No cookies in Platform response');
    }
  } catch (error) {
    console.error('Token refresh error:', error.message);
    if (AUTH_DEBUG && error.response) {
      console.error('Refresh response status:', error.response.status);
      console.error('Refresh response data:', error.response.data);
    }
    res.status(401).json({ 
      error: 'Token refresh failed', 
      code: 'REFRESH_ERROR',
      details: error.message 
    });
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
