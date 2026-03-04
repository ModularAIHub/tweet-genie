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

      if (event.data.type === 'twitter_auth_success' || event.data.type === 'TWITTER_AUTH_SUCCESS') {
        toast.success(`🎉 Twitter account @${event.data.username} connected successfully!`);
        checkTwitterStatus();
        setConnecting(false);
      } else if (event.data.type === 'twitter_auth_error' || event.data.type === 'TWITTER_AUTH_ERROR') {
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
    try {
      const response = await twitter.getStatus();
      
      setConnected(response.data.connected);
      
      if (response.data.connected && response.data.account) {
        setTwitterAccount(response.data.account);
      } else {
        setTwitterAccount(null);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('❌ Failed to check Twitter status:', error);
        console.error('Error details:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
      }
      
      if (error.response?.status === 401) {
        if (import.meta.env.DEV) console.error('Authentication error during status check');
        toast.error('Authentication required to check Twitter status');
      } else {
        if (import.meta.env.DEV) console.error('General error during status check');
        toast.error('Failed to check Twitter connection status');
      }
      setConnected(false);
      setTwitterAccount(null);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (isTeamMode) {
      toast.error(teamModeLockMessage);
      return;
    }

    if (!isAuthenticated || !user) {
      toast.error('You must be logged in to connect Twitter');
      return;
    }

    try {
      setConnecting(true);
      
      const response = await twitter.connect();
      
      if (response.data.url) {
        // Add popup parameter to the OAuth URL
        const oauthUrl = response.data.url + '&popup=true';
        
        // Store user context for the popup
        const userContext = {
          id: user.id,
          email: user.email,
          timestamp: Date.now()
        };
        localStorage.setItem('twitter_connect_user', JSON.stringify(userContext));
        
        // Show connecting toast
        toast.loading('Opening Twitter authorization window...', { duration: 3000 });
        
        // Open popup window
        const popup = window.open(
          oauthUrl,
          'twitter-oauth',
          'width=600,height=700,scrollbars=yes,resizable=yes,location=yes,menubar=no,toolbar=no,status=yes'
        );

        if (!popup) {
          toast.error('Popup was blocked. Please allow popups and try again.');
          return;
        }

        // Monitor popup for completion
        const checkPopup = setInterval(() => {
          try {
            // Check if popup is closed
            if (popup.closed) {
              clearInterval(checkPopup);
              
              // Check for success/error in localStorage or URL
              setTimeout(async () => {
                await checkTwitterStatus();
                setConnecting(false);
              }, 1000);
              
              return;
            }

            // Try to access popup URL (will throw error if still on Twitter domain)
            const popupUrl = popup.location.href;
            
            // Check if we're back on our domain (successful auth)
            if (popupUrl.includes(window.location.origin)) {
              popup.close();
              clearInterval(checkPopup);
              
              // Wait a moment then refresh status
              setTimeout(async () => {

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
              // Known Twitter onboarding error is expected and doesn't affect functionality
            }
          } catch (e) {
            // Expected error due to CORS while on Twitter domain
          }
        }, 3000);

      } else {
        toast.error('Could not get Twitter OAuth URL');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
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
      }
      
      if (error.response?.status === 401) {
        if (import.meta.env.DEV) console.error('Authentication error - user may need to re-login');
        toast.error('Authentication required to connect Twitter');
      } else if (error.response?.status === 400 && error.response?.data?.connected) {
        toast.error('Twitter account is already connected');
        // Refresh status to update UI
        await checkTwitterStatus();
      } else if (!navigator.onLine) {
        if (import.meta.env.DEV) console.error('Network connectivity issue');
        toast.error('No internet connection. Please check your network.');
      } else {
        if (import.meta.env.DEV) console.error('General connection error');
        toast.error('Failed to initiate Twitter connection. Please try again.');
      }
    } finally {
      setConnecting(false);
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
      if (import.meta.env.DEV) console.error('Twitter disconnect error:', error);
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
                    window.location.href = response.data.url;
                  }
                } catch (error) {
                  if (import.meta.env.DEV) console.error('Direct OAuth test failed:', error);
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

