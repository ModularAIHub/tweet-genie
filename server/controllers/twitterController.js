import Twitter from '../models/Twitter.js';
import axios from 'axios';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import CryptoJS from 'crypto-js';

// Initialize OAuth 1.0a client
const oauth = OAuth({
  consumer: {
    key: process.env.TWITTER_CLIENT_ID,
    secret: process.env.TWITTER_CLIENT_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64);
  },
});

class TwitterController {
  // Get Twitter connection status
  static async getStatus(req, res) {
    try {
      const twitterAuth = await Twitter.getAuthByUserId(req.user.id);
      const isConnected = !!twitterAuth;
      
      let accountInfo = null;
      if (isConnected) {
        accountInfo = {
          twitterUserId: twitterAuth.twitter_user_id,
          twitterUsername: twitterAuth.twitter_username,
          connectedAt: twitterAuth.created_at,
          tokenExpires: twitterAuth.token_expires_at
        };
      }

      const stats = await Twitter.getAccountStats(req.user.id);

      res.json({
        connected: isConnected,
        account: accountInfo,
        stats
      });
    } catch (error) {
      console.error('Twitter status check error:', error);
      res.status(500).json({ 
        error: 'Failed to check Twitter status',
        details: error.message 
      });
    }
  }

  // Initiate Twitter OAuth connection
  // Initiate Twitter OAuth 1.0a connection
  static async connect(req, res) {
    console.log('🔗 Twitter Connect - Starting OAuth 1.0a flow');
    console.log('User ID:', req.user?.id);
    console.log('User Email:', req.user?.email);
    
    try {
      // Debug environment variables
      console.log('🔧 Environment Variables Check:');
      console.log('TWITTER_CLIENT_ID:', process.env.TWITTER_CLIENT_ID ? '✅ Set' : '❌ Missing');
      console.log('TWITTER_CLIENT_SECRET:', process.env.TWITTER_CLIENT_SECRET ? '✅ Set' : '❌ Missing');
      console.log('TWITTER_REDIRECT_URI:', process.env.TWITTER_REDIRECT_URI || '❌ Missing');
      
      if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET || !process.env.TWITTER_REDIRECT_URI) {
        console.error('❌ Missing required Twitter environment variables');
        return res.status(500).json({ 
          error: 'Twitter configuration is incomplete',
          details: 'Missing required environment variables'
        });
      }

      // Check if already connected
      console.log('🔍 Checking existing Twitter connection...');
      const existingAuth = await Twitter.getAuthByUserId(req.user.id);
      console.log('Existing auth found:', !!existingAuth);
      
      if (existingAuth) {
        console.log('⚠️ User already has active Twitter connection');
        return res.status(400).json({ 
          error: 'Twitter account already connected',
          connected: true 
        });
      }

      // Step 1: Get request token from Twitter (OAuth 1.0a)
      console.log('🔐 Getting OAuth 1.0a request token...');
      
      const requestTokenUrl = 'https://api.twitter.com/oauth/request_token';
      const requestData = {
        url: requestTokenUrl,
        method: 'POST',
        data: {
          oauth_callback: process.env.TWITTER_REDIRECT_URI
        }
      };

      const token = {
        key: '',
        secret: ''
      };

      const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
      
      console.log('Making request token call to Twitter...');
      const response = await axios.post(requestTokenUrl, `oauth_callback=${encodeURIComponent(process.env.TWITTER_REDIRECT_URI)}`, {
        headers: {
          ...authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log('✅ Request token response received');
      
      // Parse the response
      const responseParams = new URLSearchParams(response.data);
      const oauthToken = responseParams.get('oauth_token');
      const oauthTokenSecret = responseParams.get('oauth_token_secret');
      const oauthCallbackConfirmed = responseParams.get('oauth_callback_confirmed');

      if (!oauthToken || !oauthTokenSecret || oauthCallbackConfirmed !== 'true') {
        throw new Error('Invalid request token response from Twitter');
      }

      console.log('OAuth token received:', oauthToken);
      console.log('Token secret length:', oauthTokenSecret?.length);

      // Save request token temporarily (we'll use state as the key)
      const state = crypto.randomBytes(16).toString('hex');
      await Twitter.saveOAuthState(state, req.user.id, JSON.stringify({
        oauth_token: oauthToken,
        oauth_token_secret: oauthTokenSecret,
        type: 'oauth1a'
      }));

      // Step 2: Redirect user to Twitter authorization
      const authUrl = `https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}&oauth_callback=${encodeURIComponent(process.env.TWITTER_REDIRECT_URI)}`;
      
      console.log('🌐 Generated OAuth 1.0a URL:');
      console.log('Authorization URL:', authUrl);
      console.log('OAuth Token:', oauthToken);
      console.log('Callback URL:', process.env.TWITTER_REDIRECT_URI);

      console.log('✅ Twitter Connect - OAuth 1.0a flow initiated successfully');
      res.json({ 
        url: authUrl,
        state,
        oauth_token: oauthToken,
        message: 'Redirect to Twitter for authorization (OAuth 1.0a)',
        type: 'oauth1a'
      });

    } catch (error) {
      console.error('❌ Twitter OAuth 1.0a connect error:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack
      });
      res.status(500).json({ 
        error: 'Failed to initiate Twitter connection',
        details: error.message,
        type: 'oauth1a_error'
      });
    }
  }

  // Handle Twitter OAuth callback (supports both OAuth 1.0a and 2.0)
  static async callback(req, res) {
    console.log('🔄 Twitter Callback - Processing OAuth response');
    console.log('Request URL:', req.url);
    console.log('Request method:', req.method);
    console.log('Query parameters:', req.query);
    
    // OAuth 1.0a parameters
    const { oauth_token, oauth_verifier, denied } = req.query;
    // OAuth 2.0 parameters  
    const { code, state, error: oauthError } = req.query;

    try {
      // Handle OAuth 1.0a callback
      if (oauth_token && oauth_verifier) {
        console.log('📋 Processing OAuth 1.0a callback');
        return await this.handleOAuth1aCallback(req, res, oauth_token, oauth_verifier);
      }
      
      // Handle OAuth 1.0a denial
      if (denied) {
        console.log('❌ OAuth 1.0a access denied by user');
        const redirectUrl = `${process.env.CLIENT_URL}/dashboard?error=twitter_auth_denied`;
        return res.redirect(redirectUrl);
      }
      
      // Handle OAuth 2.0 callback (legacy support)
      if (code && state) {
        console.log('📋 Processing OAuth 2.0 callback (legacy)');
        return await this.handleOAuth2Callback(req, res, code, state);
      }

      // Handle OAuth errors
      if (oauthError) {
        console.error('❌ Twitter OAuth error received:', oauthError);
        const redirectUrl = `${process.env.CLIENT_URL}/dashboard?error=twitter_auth_failed`;
        return res.redirect(redirectUrl);
      }

      // No valid OAuth parameters
      console.error('❌ No valid OAuth parameters found in callback');
      const redirectUrl = `${process.env.CLIENT_URL}/dashboard?error=missing_oauth_params`;
      return res.redirect(redirectUrl);

    } catch (error) {
      console.error('❌ Twitter callback error:', error);
      const redirectUrl = `${process.env.CLIENT_URL}/dashboard?error=callback_failed`;
      return res.redirect(redirectUrl);
    }
  }

  // Handle OAuth 1.0a callback processing
  static async handleOAuth1aCallback(req, res, oauth_token, oauth_verifier) {
    console.log('🔐 Processing OAuth 1.0a token exchange...');
    console.log('OAuth token:', oauth_token);
    console.log('OAuth verifier:', oauth_verifier);

    try {
      // Find the stored request token data
      const stateData = await Twitter.getOAuthStateByToken(oauth_token);
      if (!stateData) {
        throw new Error('OAuth token not found or expired');
      }

      const tokenData = JSON.parse(stateData.code_verifier);
      if (tokenData.type !== 'oauth1a' || tokenData.oauth_token !== oauth_token) {
        throw new Error('Invalid OAuth 1.0a token data');
      }

      console.log('✅ Found stored token data');

      // Step 2: Exchange request token for access token
      const accessTokenUrl = 'https://api.twitter.com/oauth/access_token';
      const requestData = {
        url: accessTokenUrl,
        method: 'POST',
        data: {
          oauth_verifier: oauth_verifier
        }
      };

      const token = {
        key: oauth_token,
        secret: tokenData.oauth_token_secret
      };

      const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
      
      console.log('Making access token request...');
      const response = await axios.post(
        accessTokenUrl, 
        `oauth_verifier=${oauth_verifier}`,
        {
          headers: {
            ...authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      console.log('✅ Access token response received');
      
      // Parse access token response
      const responseParams = new URLSearchParams(response.data);
      const accessToken = responseParams.get('oauth_token');
      const accessTokenSecret = responseParams.get('oauth_token_secret');
      const userId = responseParams.get('user_id');
      const screenName = responseParams.get('screen_name');

      if (!accessToken || !accessTokenSecret) {
        throw new Error('Invalid access token response from Twitter');
      }

      console.log('Access token received for user:', screenName);
      console.log('Twitter user ID:', userId);

      // Get user profile to verify the connection
      const userProfileUrl = 'https://api.twitter.com/1.1/account/verify_credentials.json';
      const profileRequestData = {
        url: userProfileUrl,
        method: 'GET'
      };

      const profileToken = {
        key: accessToken,
        secret: accessTokenSecret
      };

      const profileAuthHeader = oauth.toHeader(oauth.authorize(profileRequestData, profileToken));
      
      const profileResponse = await axios.get(userProfileUrl, {
        headers: profileAuthHeader
      });

      const twitterUser = profileResponse.data;
      console.log('✅ Twitter user profile retrieved:', twitterUser.screen_name);

      // Save the Twitter authentication
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setFullYear(tokenExpiresAt.getFullYear() + 1); // OAuth 1.0a tokens don't expire, but set 1 year for consistency

      await Twitter.saveAuth(stateData.user_id, {
        accessToken: accessToken,
        refreshToken: accessTokenSecret, // Use token secret as refresh token for OAuth 1.0a
        tokenExpiresAt: tokenExpiresAt,
        twitterUserId: userId,
        username: screenName,
        displayName: twitterUser.name,
        profileImageUrl: twitterUser.profile_image_url_https,
        type: 'oauth1a'
      });

      console.log('✅ Twitter OAuth 1.0a authentication saved successfully');

      // Clean up OAuth state
      await Twitter.deleteOAuthState(stateData.state);

      // Redirect to success
      const redirectUrl = `${process.env.CLIENT_URL}/dashboard?twitter_connected=true&username=${encodeURIComponent(screenName)}`;
      
      const successHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Twitter Connected</title>
  <script>
    console.log('🪟 Twitter OAuth 1.0a success page loaded');
    
    try {
      localStorage.setItem('twitter_auth_result', JSON.stringify({
        success: true,
        username: '${screenName}',
        timestamp: Date.now(),
        type: 'oauth1a'
      }));
    } catch(e) {
      console.warn('Could not set localStorage:', e);
    }
    
    if (window.opener && !window.opener.closed) {
      console.log('📨 Sending success message to parent window');
      try {
        window.opener.postMessage({
          type: 'twitter_auth_success',
          username: '${screenName}'
        }, '${process.env.CLIENT_URL}');
      } catch(e) {
        console.warn('Could not post message to opener:', e);
      }
      
      setTimeout(function() {
        console.log('🚪 Closing popup window');
        window.close();
      }, 1000);
    } else {
      console.log('🔄 Redirecting to dashboard');
      window.location.href = '${redirectUrl}';
    }
  </script>
</head>
<body>
  <div style="text-align: center; padding: 40px; font-family: Arial, sans-serif;">
    <h2>✅ Twitter Connected Successfully!</h2>
    <p>Connected as @${screenName}</p>
    <p>OAuth 1.0a authentication completed</p>
    <p id="popup-msg">This window will close automatically...</p>
  </div>
</body>
</html>`;

      res.set('Content-Type', 'text/html');
      return res.send(successHtml);

    } catch (error) {
      console.error('❌ OAuth 1.0a callback error:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      const redirectUrl = `${process.env.CLIENT_URL}/dashboard?error=oauth1a_callback_failed`;
      return res.redirect(redirectUrl);
    }
  }

  // Disconnect Twitter account
  static async disconnect(req, res) {
    try {
      const twitterAuth = await Twitter.getAuthByUserId(req.user.id);
      
      if (!twitterAuth) {
        return res.status(404).json({ 
          error: 'No Twitter account connected',
          connected: false 
        });
      }

      // Revoke Twitter token (optional but recommended)
      try {
        await axios.post(
          'https://api.twitter.com/2/oauth2/revoke',
          new URLSearchParams({
            token: twitterAuth.access_token,
            client_id: process.env.TWITTER_CLIENT_ID,
            client_secret: process.env.TWITTER_CLIENT_SECRET,
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }
        );
      } catch (revokeError) {
        console.warn('Failed to revoke Twitter token:', revokeError.message);
        // Continue with disconnection even if revoke fails
      }

      // Delete from database
      await Twitter.deleteAuth(req.user.id);

      res.json({ 
        success: true, 
        message: 'Twitter account disconnected successfully',
        connected: false 
      });

    } catch (error) {
      console.error('Twitter disconnect error:', error);
      res.status(500).json({ 
        error: 'Failed to disconnect Twitter account',
        details: error.message 
      });
    }
  }

  // Refresh Twitter token
  static async refreshToken(req, res) {
    try {
      const twitterAuth = await Twitter.getAuthByUserId(req.user.id);
      
      if (!twitterAuth) {
        return res.status(404).json({ error: 'No Twitter account connected' });
      }

      if (!twitterAuth.refresh_token) {
        return res.status(400).json({ error: 'No refresh token available' });
      }

      // Refresh the token
      const tokenResponse = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: twitterAuth.refresh_token,
          client_id: process.env.TWITTER_CLIENT_ID,
          client_secret: process.env.TWITTER_CLIENT_SECRET,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000));

      // Update tokens in database
      await Twitter.updateTokens(req.user.id, access_token, refresh_token, tokenExpiresAt);

      res.json({ 
        success: true, 
        message: 'Twitter token refreshed successfully',
        expiresAt: tokenExpiresAt 
      });

    } catch (error) {
      console.error('Twitter token refresh error:', error);
      res.status(500).json({ 
        error: 'Failed to refresh Twitter token',
        details: error.message 
      });
    }
  }

  // Get Twitter user profile
  static async getProfile(req, res) {
    try {
      const twitterAuth = await Twitter.getAuthByUserId(req.user.id);
      
      if (!twitterAuth) {
        return res.status(404).json({ error: 'No Twitter account connected' });
      }

      // Check if token is expired
      if (Twitter.isTokenExpired(twitterAuth.token_expires_at)) {
        return res.status(401).json({ 
          error: 'Twitter token expired',
          expired: true 
        });
      }

      // Get Twitter user profile
      const userResponse = await axios.get(
        'https://api.twitter.com/2/users/me?user.fields=id,username,name,description,profile_image_url,public_metrics,verified,created_at',
        {
          headers: { 
            'Authorization': `Bearer ${twitterAuth.access_token}`,
            'Accept': 'application/json'
          }
        }
      );

      res.json({ 
        success: true,
        profile: userResponse.data.data 
      });

    } catch (error) {
      console.error('Twitter profile error:', error);
      
      if (error.response?.status === 401) {
        return res.status(401).json({ 
          error: 'Twitter authentication failed',
          expired: true 
        });
      }

      res.status(500).json({ 
        error: 'Failed to get Twitter profile',
        details: error.message 
      });
    }
  }

  // Admin: Get all connected accounts
  static async getAllAccounts(req, res) {
    try {
      // Check if user is admin (you might want to add proper admin middleware)
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const accounts = await Twitter.getAllConnectedAccounts();
      
      res.json({ 
        success: true,
        accounts,
        total: accounts.length 
      });

    } catch (error) {
      console.error('Get all Twitter accounts error:', error);
      res.status(500).json({ 
        error: 'Failed to get Twitter accounts',
        details: error.message 
      });
    }
  }
}

export default TwitterController;
