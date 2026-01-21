import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { setAuthCookies } from '../utils/cookieUtils.js';

const router = express.Router();

// Secure login endpoint - receives POST data instead of URL tokens  
router.post('/secure-login', async (req, res) => {
  try {
    const { sessionId, redirect } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    
    console.log('Secure login attempt with session ID:', sessionId);
    
    // Fetch session data from Platform
    const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
    
    try {
      const sessionResponse = await axios.post(`${platformUrl}/api/auth/verify-session`, {
        sessionId: sessionId
      });
      
      if (!sessionResponse.data.success) {
        throw new Error('Invalid or expired session');
      }
      
      const { userId, email } = sessionResponse.data.user;
      console.log('Valid secure session for user:', email);
      
      // Create new tokens for Tweet Genie
      const accessToken = jwt.sign(
        { userId: userId, email: email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      const refreshToken = jwt.sign(
        { userId: userId },
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      // Set authentication cookies
      setAuthCookies(res, accessToken, refreshToken);
      
      console.log('Secure login successful, redirecting to:', redirect);
      
      // Redirect to the desired page
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:5174';
      const finalRedirect = redirect || '/dashboard';
      res.redirect(`${clientUrl}${finalRedirect}`);
      
    } catch (platformError) {
      console.error('Platform session verification failed:', platformError.message);
      throw new Error('Session verification failed');
    }
    
  } catch (error) {
    console.error('Secure login failed:', error.message);
    
    // Redirect to Platform login on failure
    const platformUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
    res.redirect(`${platformUrl}/login?error=secure_login_failed`);
  }
});

export default router;
