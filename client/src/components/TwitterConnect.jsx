import React, { useState, useEffect } from 'react';
import { Twitter, ExternalLink, Shield, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { twitter } from '../utils/api';
import toast from 'react-hot-toast';

const TwitterConnect = () => {
  const { user, isAuthenticated } = useAuth();
  const { isTeamMode } = useAccount();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [twitterAccount, setTwitterAccount] = useState(null);
  const teamModeLockMessage = 'You are in Team mode. Personal Twitter connection is disabled.';

  useEffect(() => {
    // Only check Twitter status if user is authenticated
    if (isAuthenticated && user) {
      checkTwitterStatus();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    const allowedOrigins = new Set([window.location.origin]);
    try {
      const apiOrigin = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3002').origin;
      allowedOrigins.add(apiOrigin);
    } catch {
      // Ignore malformed env URL
    }

    // Listen for postMessage from OAuth popup
    const handlePopupMessage = (event) => {
      // Verify origin for security
      if (!allowedOrigins.has(event.origin)) {
        return;
      }

      console.log('📨 Received popup message:', event.data);

      if (event.data.type === 'twitter_auth_success' || event.data.type === 'TWITTER_AUTH_SUCCESS') {
        console.log('✅ Popup auth success:', event.data.username);
        toast.success(`🎉 Twitter account @${event.data.username} connected successfully!`);
        checkTwitterStatus();
        setConnecting(false);
      } else if (event.data.type === 'twitter_auth_error' || event.data.type === 'TWITTER_AUTH_ERROR') {
        console.log('❌ Popup auth error:', event.data.error);
        toast.error('❌ Twitter authentication failed. Please try again.');
        setConnecting(false);
      }
    };

    window.addEventListener('message', handlePopupMessage);
    
    return () => {
      window.removeEventListener('message', handlePopupMessage);
    };
  }, []);

  const checkTwitterStatus = async () => {
    console.log('🔍 Checking Twitter connection status...');
    console.log('User ID:', user?.id);
    
    try {
      console.log('🌐 Making status request to server...');
      const response = await twitter.getStatus();
      
      console.log('✅ Status response received:');
      console.log('Response status:', response.status);
      console.log('Response data:', response.data);
      
      setConnected(response.data.connected);
      console.log('Connected status:', response.data.connected);
      
      if (response.data.connected && response.data.account) {
        console.log('Twitter account info:', response.data.account);
        setTwitterAccount(response.data.account);
      } else {
        console.log('No Twitter account connected or no account data');
        setTwitterAccount(null);
      }
    } catch (error) {
      console.error('❌ Failed to check Twitter status:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      if (error.response?.status === 401) {
        console.error('Authentication error during status check');
        toast.error('Authentication required to check Twitter status');
      } else {
        console.error('General error during status check');
        toast.error('Failed to check Twitter connection status');
      }
      setConnected(false);
      setTwitterAccount(null);
    } finally {
      setLoading(false);
      console.log('🔄 Twitter status check completed');
    }
  };

  const handleConnect = async () => {
    if (isTeamMode) {
      toast.error(teamModeLockMessage);
      return;
    }

    console.log('🔗 Twitter Connect - Starting client-side OAuth flow');
    console.log('User authenticated:', isAuthenticated);
    console.log('User data:', user);
    
    if (!isAuthenticated || !user) {
      console.error('❌ Authentication required');
      toast.error('You must be logged in to connect Twitter');
      return;
    }

    try {
      setConnecting(true);
      console.log('🌐 Making connect request to server...');
      
      const response = await twitter.connect();
      
      console.log('✅ Server response received:');
      console.log('Response status:', response.status);
      console.log('Response data:', response.data);
      
      if (response.data.url) {
        console.log('🔗 OAuth URL received:', response.data.url);
        console.log('State:', response.data.state);
        
        // Add popup parameter to the OAuth URL
        const oauthUrl = response.data.url + '&popup=true';
        console.log('🪟 Modified OAuth URL for popup:', oauthUrl);
        
        // Store user context for the popup
        const userContext = {
          id: user.id,
          email: user.email,
          timestamp: Date.now()
        };
        localStorage.setItem('twitter_connect_user', JSON.stringify(userContext));
        console.log('💾 User context stored:', userContext);
        
        // Show connecting toast
        toast.loading('Opening Twitter authorization window...', { duration: 3000 });
        
        console.log('🪟 Opening OAuth popup window...');
        
        // Open popup window
        const popup = window.open(
          oauthUrl,
          'twitter-oauth',
          'width=600,height=700,scrollbars=yes,resizable=yes,location=yes,menubar=no,toolbar=no,status=yes'
        );

        if (!popup) {
          console.error('❌ Popup blocked');
          toast.error('Popup was blocked. Please allow popups and try again.');
          return;
        }

        console.log('🪟 Popup opened successfully:', popup);

        // Add additional popup debugging
        popup.addEventListener('beforeunload', () => {
          console.log('🪟 Popup beforeunload event fired');
        });

        popup.addEventListener('unload', () => {
          console.log('🪟 Popup unload event fired');
        });

        // Monitor popup for completion
        const checkPopup = setInterval(() => {
          try {
            // Check if popup is closed
            if (popup.closed) {
              console.log('🪟 Popup window closed');
              clearInterval(checkPopup);
              
              // Check for success/error in localStorage or URL
              setTimeout(async () => {
                console.log('🔄 Refreshing Twitter status after popup close...');
                await checkTwitterStatus();
                setConnecting(false);
              }, 1000);
              
              return;
            }

            // Try to access popup URL (will throw error if still on Twitter domain)
            const popupUrl = popup.location.href;
            console.log('🔍 Popup URL:', popupUrl);
            
            // Check if we're back on our domain (successful auth)
            if (popupUrl.includes(window.location.origin)) {
              console.log('✅ OAuth completed - popup returned to our domain');
              popup.close();
              clearInterval(checkPopup);
              
              // Wait a moment then refresh status
              setTimeout(async () => {
                console.log('� Refreshing Twitter status after successful auth...');
                await checkTwitterStatus();
                setConnecting(false);
                toast.success('Twitter account connected successfully!');
              }, 1000);
            }
          } catch (error) {
            // This is expected while on Twitter domain due to CORS
            // We'll just wait for the popup to close or return to our domain
          }
        }, 1000);

        // Timeout after 5 minutes
        setTimeout(() => {
          if (!popup.closed) {
            console.log('⏰ OAuth timeout - closing popup');
            popup.close();
            clearInterval(checkPopup);
            setConnecting(false);
            toast.error('Authentication timed out. Please try again.');
          }
        }, 300000); // 5 minutes

        // Monitor for Twitter's onboarding error
        setTimeout(() => {
          try {
            // Check if popup is still open but might have errors
            if (!popup.closed && popup.location.href.includes('twitter.com')) {
              console.log('🔍 Checking for Twitter onboarding errors...');
              
              // Add console message about the common error
              console.warn(`
                ⚠️  If you see "POST https://api.twitter.com/1.1/onboarding/referrer.json 400" errors,
                this is a known Twitter issue with Web App OAuth. The authentication should still work.
                Just complete the authorization process normally.
              `);
            }
          } catch (e) {
            // Expected error due to CORS while on Twitter domain
          }
        }, 3000);

      } else {
        console.error('❌ No OAuth URL in response');
        console.error('Response data:', response.data);
        toast.error('Could not get Twitter OAuth URL');
      }
    } catch (error) {
      console.error('❌ Twitter connect error:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        }
      });
      
      if (error.response?.status === 401) {
        console.error('Authentication error - user may need to re-login');
        toast.error('Authentication required to connect Twitter');
      } else if (error.response?.status === 400 && error.response?.data?.connected) {
        console.log('Twitter already connected');
        toast.error('Twitter account is already connected');
        // Refresh status to update UI
        await checkTwitterStatus();
      } else if (!navigator.onLine) {
        console.error('Network connectivity issue');
        toast.error('No internet connection. Please check your network.');
      } else {
        console.error('General connection error');
        toast.error('Failed to initiate Twitter connection. Please try again.');
      }
    } finally {
      setConnecting(false);
      console.log('🔄 Twitter Connect - Process completed');
    }
  };

  const handleDisconnect = async () => {
    if (isTeamMode) {
      toast.error(teamModeLockMessage);
      return;
    }

    if (!isAuthenticated || !user) {
      toast.error('Authentication required to disconnect Twitter');
      return;
    }

    try {
      await twitter.disconnect();
      setConnected(false);
      setTwitterAccount(null);
      toast.success('Twitter account disconnected successfully');
    } catch (error) {
      console.error('Twitter disconnect error:', error);
      if (error.response?.status === 401) {
        toast.error('Authentication required to disconnect Twitter');
      } else {
        toast.error('Failed to disconnect Twitter account');
      }
    }
  };

  // Don't render if user is not authenticated
  if (!isAuthenticated || !user) {
    return (
      <div className="card">
        <div className="flex items-center justify-center space-x-3 p-4">
          <Shield className="h-8 w-8 text-gray-400" />
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900">Authentication Required</h3>
            <p className="text-sm text-gray-600">
              Please log in to connect your Twitter account
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center space-x-3">
          <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          <span className="text-gray-600">Checking Twitter connection...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {isTeamMode && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Team mode is active. Personal Twitter connect/disconnect is locked.
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Twitter className={`h-8 w-8 ${connected ? 'text-blue-500' : 'text-gray-400'}`} />
            {connected && (
              <CheckCircle className="absolute -top-1 -right-1 h-4 w-4 text-green-500 bg-white rounded-full" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Twitter Account</h3>
            <p className="text-sm text-gray-600">
              {connected 
                ? (twitterAccount?.twitterUsername 
                    ? `Connected as @${twitterAccount.twitterUsername}`
                    : 'Twitter account is connected'
                  )
                : 'Connect your Twitter account to start posting'
              }
            </p>
            {connected && twitterAccount?.connectedAt && (
              <p className="text-xs text-gray-500 mt-1">
                Connected on {new Date(twitterAccount.connectedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {connected && (
            <div className="flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Connected</span>
            </div>
          )}
          
          {connected ? (
            <button
              onClick={handleDisconnect}
              disabled={isTeamMode}
              className="btn btn-outline btn-sm text-red-600 border-red-600 hover:bg-red-50 hover:border-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Disconnect
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={handleConnect}
                disabled={connecting || isTeamMode}
                className="btn btn-primary btn-sm flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4" />
                    <span>Connect Twitter</span>
                  </>
                )}
              </button>
              
              {/* Helpful note about Twitter OAuth errors */}
              <div className="text-xs text-gray-500 max-w-sm">
                <div className="flex items-start space-x-1">
                  <Shield className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    If you see network errors during authentication, ignore them and complete the process. 
                    This is a known Twitter issue that doesn't affect functionality.
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Debug button - test direct OAuth */}
          {!connected && (
            <button
              onClick={async () => {
                if (isTeamMode) {
                  toast.error(teamModeLockMessage);
                  return;
                }
                try {
                  const response = await twitter.connect();
                  if (response.data.url) {
                    console.log('🔍 Testing direct OAuth redirect...');
                    window.location.href = response.data.url;
                  }
                } catch (error) {
                  console.error('Direct OAuth test failed:', error);
                }
              }}
              className="btn btn-outline btn-sm text-blue-600 border-blue-600 hover:bg-blue-50"
            >
              Test Direct
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TwitterConnect;

