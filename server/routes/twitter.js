import express from 'express';

const router = express.Router();

// Twitter integration endpoints removed - functionality will be re-implemented

export default router;

// Handle Twitter OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;
    
    if (!oauth_token || !oauth_verifier) {
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`);
    }

    // Redirect to client with tokens
    res.redirect(`${process.env.CLIENT_URL}/twitter-callback?oauth_token=${oauth_token}&oauth_verifier=${oauth_verifier}`);
  } catch (error) {
    console.error('Twitter callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`);
  }
});
