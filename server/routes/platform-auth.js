import express from 'express';
import axios from 'axios';
import { setAuthCookies } from '../utils/cookieUtils.js';

const router = express.Router();

// Cross-domain authentication endpoint
// This endpoint checks Platform authentication and creates local auth cookies
router.post('/check-platform-auth', async (req, res) => {
  try {
    console.log('Checking Platform authentication...');
    
    // Make a request to Platform to check authentication
    // The browser will send Platform cookies with this request
    const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
    
    const response = await axios.get(`${platformUrl}/api/auth/me`, {
      headers: {
        // Forward cookies from the request
        'Cookie': req.headers.cookie || ''
      },
      withCredentials: true
    });
    
    if (response.data.success && response.data.user) {
      // User is authenticated on Platform
      // We need to get the tokens somehow - let's create a special endpoint on Platform
      
      // For now, create local session without tokens (user will need to refresh)
      console.log('User authenticated on Platform:', response.data.user);
      
      res.json({
        success: true,
        authenticated: true,
        user: response.data.user,
        message: 'Cross-domain authentication successful'
      });
    } else {
      res.json({
        success: false,
        authenticated: false,
        message: 'Not authenticated on Platform'
      });
    }
  } catch (error) {
    console.error('Platform auth check failed:', error.message);
    res.json({
      success: false,
      authenticated: false,
      message: 'Platform authentication check failed'
    });
  }
});

export default router;
