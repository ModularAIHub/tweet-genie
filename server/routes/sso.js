// SSO routes for Tweet Genie authentication from main platform
import express from 'express';
import jwt from 'jsonwebtoken';
import { validateSSOToken } from '../middleware/sso.js';

const router = express.Router();

// SSO authentication endpoint
router.get('/sso', validateSSOToken, (req, res) => {
    try {
        const { userId, teamId, role, email, name, teamName } = req.ssoUser;
        
        // Create session or set authentication cookies
        req.session = req.session || {};
        req.session.ssoUser = req.ssoUser;
        
        // Generate access token for regular API endpoints
        const accessToken = jwt.sign(
            {
                userId,
                teamId,
                role,
                email,
                name,
                teamName
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        // Set access token cookie for API authentication
        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 1000 // 1 hour
        });
        
        // Log the successful SSO authentication
        console.log(`SSO Authentication successful for ${email} (${role}) from team ${teamName}`);
        
        // Redirect to TweetGenie frontend with success message
        const frontendUrl = process.env.TWEET_GENIE_FRONTEND_URL || 'http://localhost:5174';
        const dashboardUrl = `${frontendUrl}/?sso=success&role=${role}&team=${encodeURIComponent(teamName)}`;
        res.redirect(dashboardUrl);
        
    } catch (error) {
        console.error('SSO authentication error:', error);
        const frontendUrl = process.env.TWEET_GENIE_FRONTEND_URL || 'http://localhost:5174';
        res.redirect(`${frontendUrl}/?sso=error`);
    }
});

// Get current SSO user info (API endpoint)
router.get('/sso/user', validateSSOToken, (req, res) => {
    res.json({
        success: true,
        user: req.ssoUser
    });
});

// SSO logout
router.post('/sso/logout', (req, res) => {
    // Clear session
    if (req.session) {
        req.session.ssoUser = null;
    }
    
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

export default router;