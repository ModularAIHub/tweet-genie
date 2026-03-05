import React, { useState, useEffect, useRef } from 'react';
import { 
  Twitter, 
  Key, 
  Link as LinkIcon,
  Unlink,
  Check,
  X,
  Eye,
  EyeOff
} from 'lucide-react';
import { twitter, providers } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import { useAccount } from '../contexts/AccountContext';

const Settings = () => {
  const { isTeamMode } = useAccount();
  const [activeTab, setActiveTab] = useState('twitter');
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [twitterTokenStatus, setTwitterTokenStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const oauthMessageReceivedRef = useRef(false);
  const OAUTH_RESULT_STORAGE_KEY = 'suitegenie_oauth_result';
  const teamModeLockMessage = 'You are in Team mode. Personal Twitter connections are disabled.';

  // ── X Premium / posting preference state ─────────────────────────────────
  const [xLongPostEnabled, setXLongPostEnabled] = useState(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);

  const getAllowedPopupOrigins = () => {
    const allowed = new Set([window.location.origin]);
    try {
      const apiOrigin = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3002').origin;
      allowed.add(apiOrigin);
    } catch {
      // Ignore malformed env URL
    }
    return allowed;
  };

  const refreshAfterOauth = async () => {
    await fetchData();
  };

  // ── Fetch posting preferences ─────────────────────────────────────────────
  const fetchPostingPreferences = async () => {
    try {
      const res = await fetch('/api/twitter/posting-preferences', {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setXLongPostEnabled(Boolean(data.x_long_post_enabled));
    } catch {
      // Non-critical — default stays false
    }
  };

  useEffect(() => {
    fetchData();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('twitter_connected') === 'true') {
      toast.success('Twitter account connected successfully!');
      fetchData().catch(() => {});
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (urlParams.get('oauth1_connected') === 'true') {
      toast.success('Media upload permissions enabled successfully!');
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    const callbackError = urlParams.get('error');
    if (callbackError) {
      const errorMessages = {
        oauth1_connection_failed: 'Failed to enable media permissions. Please try again.',
        connection_failed: 'Failed to connect Twitter account. Please try again.',
        oauth_denied: 'Twitter authorization was denied.',
        no_code: 'Twitter callback did not return an authorization code.',
      };
      toast.error(errorMessages[callbackError] || 'Twitter connection failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const handleStoredOauthResult = async () => {
      try {
        const raw = localStorage.getItem(OAUTH_RESULT_STORAGE_KEY);
        if (!raw) return;

        const payload = JSON.parse(raw);
        if (!payload?.type) return;

        if (payload.type === 'TWITTER_AUTH_SUCCESS' || payload.type === 'twitter_auth_success') {
          toast.success('Twitter account connected successfully!');
          await refreshAfterOauth();
        } else if (payload.type === 'TWITTER_AUTH_ERROR' || payload.type === 'twitter_auth_error') {
          toast.error(payload.error || 'Failed to connect Twitter account');
        }
      } catch {
        // ignore invalid payload
      } finally {
        localStorage.removeItem(OAUTH_RESULT_STORAGE_KEY);
      }
    };

    const storageListener = (event) => {
      if (event.key === OAUTH_RESULT_STORAGE_KEY) {
        handleStoredOauthResult().catch(() => {});
      }
    };
    window.addEventListener('storage', storageListener);
    handleStoredOauthResult().catch(() => {});

    return () => {
      window.removeEventListener('storage', storageListener);
    };
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [accountsRes, tokenStatusRes] = await Promise.allSettled([
        twitter.getStatus(),
        twitter.getTokenStatus(),
      ]);
      const data = accountsRes.status === 'fulfilled' ? accountsRes.value.data : {};
      if (Array.isArray(data.accounts)) {
        setTwitterAccounts(data.accounts);
      } else if (data.account) {
        setTwitterAccounts([data.account]);
      } else {
        setTwitterAccounts([]);
      }

      if (tokenStatusRes.status === 'fulfilled') {
        setTwitterTokenStatus(tokenStatusRes.value?.data || null);
      } else {
        setTwitterTokenStatus(null);
      }

      if (accountsRes.status === 'rejected') {
        throw accountsRes.reason;
      }

      // Fetch posting preferences in parallel with accounts
      await fetchPostingPreferences();
    } catch (error) {
      console.error('Failed to fetch settings data:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  // ── Toggle X Premium extended posts ──────────────────────────────────────
  const handleToggleXPremium = async () => {
    if (isTeamMode) {
      toast.error('Posting preferences are managed per team account in team mode.');
      return;
    }

    const next = !xLongPostEnabled;
    setIsUpdatingPreference(true);
    try {
      const res = await fetch('/api/twitter/posting-preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xLongPostEnabled: next }),
      });

      if (!res.ok) {
        throw new Error('Failed to update preference');
      }

      setXLongPostEnabled(next);
      toast.success(
        next
          ? 'X Premium enabled - posts can now be up to 2,000 characters.'
          : 'Reverted to standard 280 character limit.'
      );
    } catch {
      toast.error('Failed to update preference. Please try again.');
    } finally {
      setIsUpdatingPreference(false);
    }
  };

  const handleOAuth1Connect = async () => {
    if (isTeamMode) {
      toast.error(teamModeLockMessage);
      return;
    }

    try {
      oauthMessageReceivedRef.current = false;
      const response = await twitter.connectOAuth1();
      const { url } = response.data;

      const popup = window.open(url, 'twitter-oauth1-auth', 'width=600,height=600,scrollbars=yes,resizable=yes');

      if (!popup) {
        toast.error('Popup was blocked. Please allow popups and try again.');
        return;
      }

      const allowedOrigins = getAllowedPopupOrigins();
      const handleMessage = async (event) => {
        if (!allowedOrigins.has(event.origin)) return;
        if (event.source !== popup) return;

        const type = event.data?.type;
        if (type === 'TWITTER_AUTH_SUCCESS' || type === 'twitter_auth_success') {
          oauthMessageReceivedRef.current = true;
          window.removeEventListener('message', handleMessage);
          toast.success('Media upload permissions enabled successfully!');
          await refreshAfterOauth();
          if (!popup.closed) popup.close();
        } else if (type === 'TWITTER_AUTH_ERROR' || type === 'twitter_auth_error') {
          oauthMessageReceivedRef.current = true;
          window.removeEventListener('message', handleMessage);
          toast.error(event.data?.error || 'Failed to enable media permissions. Please try again.');
          if (!popup.closed) popup.close();
        }
      };
      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          if (!oauthMessageReceivedRef.current) {
            refreshAfterOauth();
          }
        }
      }, 1000);
    } catch (error) {
      console.error('OAuth 1.0a connect error:', error);
      toast.error(error?.response?.data?.error || 'Failed to initiate OAuth 1.0a connection');
    }
  };

  const getOAuth2StatusUI = () => {
    if (
      twitterTokenStatus &&
      twitterTokenStatus.connected === false &&
      !twitterTokenStatus.requiresTeamAccountSelection
    ) {
      return {
        card: 'bg-red-50 border-red-200',
        text: 'text-red-600',
        badge: 'text-red-600',
        label: 'OAuth 2.0 not usable (Reconnect required)',
        detail: 'A Twitter account row exists, but posting auth is not valid. Reconnect Twitter.',
        statusText: 'Reconnect',
      };
    }

    if (
      twitterTokenStatus?.connected &&
      twitterTokenStatus?.isExpired &&
      twitterTokenStatus?.postingReady === false
    ) {
      return {
        card: 'bg-red-50 border-red-200',
        text: 'text-red-600',
        badge: 'text-red-600',
        label: 'OAuth 2.0 expired (Reconnect required)',
        detail: 'Posting may fail until you reconnect Twitter.',
        statusText: 'Expired',
      };
    }

    if (twitterTokenStatus?.connected && twitterTokenStatus?.needsRefresh) {
      return {
        card: 'bg-amber-50 border-amber-200',
        text: 'text-amber-700',
        badge: 'text-amber-700',
        label: 'OAuth 2.0 connected (Expiring soon)',
        detail: 'The app will try to refresh your token automatically.',
        statusText: 'Connected',
      };
    }

    return {
      card: 'bg-green-50 border-green-200',
      text: 'text-green-600',
      badge: 'text-green-600',
      label: 'OAuth 2.0 Connected (Text tweets)',
      detail: null,
      statusText: 'Connected',
    };
  };

  const handleTwitterConnect = async () => {
    if (isTeamMode) {
      toast.error(teamModeLockMessage);
      return;
    }

    try {
      oauthMessageReceivedRef.current = false;
      const response = await twitter.connect();
      const { url, oauth_token_secret } = response.data;
      if (oauth_token_secret) {
        sessionStorage.setItem('oauth_token_secret', oauth_token_secret);
      }

      const popup = window.open(url, 'twitter-auth', 'width=600,height=600,scrollbars=yes,resizable=yes');

      if (!popup) {
        toast.error('Popup was blocked. Please allow popups and try again.');
        return;
      }

      const allowedOrigins = getAllowedPopupOrigins();

      const handleMessage = async (event) => {
        if (!allowedOrigins.has(event.origin)) return;
        if (event.source !== popup) return;

        const type = event.data?.type;
        if (type === 'TWITTER_AUTH_SUCCESS' || type === 'twitter_auth_success') {
          oauthMessageReceivedRef.current = true;
          window.removeEventListener('message', handleMessage);
          toast.success('Twitter account connected successfully!');
          await refreshAfterOauth();
          if (!popup.closed) popup.close();
        } else if (type === 'TWITTER_AUTH_ERROR' || type === 'twitter_auth_error') {
          oauthMessageReceivedRef.current = true;
          window.removeEventListener('message', handleMessage);
          toast.error(event.data?.error || 'Failed to connect Twitter account');
          if (!popup.closed) popup.close();
        }
      };

      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          sessionStorage.removeItem('oauth_token_secret');
          if (!oauthMessageReceivedRef.current) {
            refreshAfterOauth();
          }
        }
      }, 1000);
    } catch (error) {
      console.error('Twitter connect error:', error);
      toast.error(error?.response?.data?.error || 'Failed to initiate Twitter connection');
    }
  };

  const handleTwitterDisconnect = async () => {
    if (isTeamMode) {
      toast.error(teamModeLockMessage);
      return;
    }

    if (!confirm('Are you sure you want to disconnect this Twitter account?')) {
      return;
    }

    try {
      await twitter.disconnect();
      toast.success('Twitter account disconnected successfully!');
      fetchData();
    } catch (error) {
      console.error('Twitter disconnect error:', error);
      toast.error(error?.response?.data?.error || 'Failed to disconnect Twitter account');
    }
  };

  const tabs = [{ id: 'twitter', name: 'Twitter Account', icon: Twitter }];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  const oauth2StatusUI = getOAuth2StatusUI();
  const showReconnectAction =
    !isTeamMode &&
    (
      (!!twitterTokenStatus?.connected &&
        !!twitterTokenStatus?.isExpired &&
        twitterTokenStatus?.postingReady === false) ||
      (twitterTokenStatus &&
        twitterTokenStatus.connected === false &&
        !twitterTokenStatus.requiresTeamAccountSelection)
    );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">Manage your Twitter connections</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-5 w-5 mr-2" />
                {tab.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Twitter Account Tab */}
      {activeTab === 'twitter' && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Twitter Account Connection</h3>

            {isTeamMode && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Team mode is active</p>
                <p className="mt-1 text-sm text-amber-800">
                  Personal Twitter account connect/disconnect is locked while you are posting as a
                  team account. Connect a Twitter account in your team settings to continue.
                </p>
              </div>
            )}

            {twitterAccounts.length > 0 ? (
              <div className="space-y-4">
                {twitterAccounts.map((account) => (
                  <div key={account.id} className="space-y-4">
                    {/* OAuth 2.0 Connection Status */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border ${oauth2StatusUI.card}`}>
                      <div className="flex items-center space-x-4">
                        <img
                          src={account.profile_image_url}
                          alt="Profile"
                          className="h-12 w-12 rounded-full"
                        />
                        <div>
                          <h4 className="font-medium text-gray-900">{account.display_name}</h4>
                          <p className="text-sm text-gray-600">@{account.username}</p>
                          <p className="text-xs text-gray-500">
                            {account.followers_count?.toLocaleString()} followers •{' '}
                            {account.following_count?.toLocaleString()} following
                          </p>
                          <p className={`text-xs font-medium ${oauth2StatusUI.text}`}>
                            {oauth2StatusUI.label}
                          </p>
                          {oauth2StatusUI.detail ? (
                            <p className="text-xs text-gray-600 mt-1">{oauth2StatusUI.detail}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className={`flex items-center text-sm ${oauth2StatusUI.badge}`}>
                          <Check className="h-4 w-4 mr-1" />
                          {oauth2StatusUI.statusText}
                        </span>
                        {showReconnectAction ? (
                          <button
                            onClick={handleTwitterConnect}
                            disabled={isTeamMode}
                            className="btn btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <LinkIcon className="h-4 w-4 mr-1" />
                            Reconnect
                          </button>
                        ) : null}
                        <button
                          onClick={() => handleTwitterDisconnect()}
                          disabled={isTeamMode}
                          className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Unlink className="h-4 w-4 mr-1" />
                          Disconnect
                        </button>
                      </div>
                    </div>

                    {/* OAuth 1.0a Status */}
                    <div
                      className={`p-4 rounded-lg border ${
                        account.has_oauth1
                          ? 'bg-green-50 border-green-200'
                          : 'bg-blue-50 border-blue-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 mb-1">
                            Media Upload Permissions (OAuth 1.0a)
                          </h4>
                          <p className="text-sm text-gray-600 mb-2">
                            Required for posting images, videos, and GIFs
                          </p>
                          {account.has_oauth1 ? (
                            <p className="text-xs text-green-600 flex items-center">
                              <Check className="h-3 w-3 mr-1" />
                              📷 Media uploads enabled
                            </p>
                          ) : (
                            <p className="text-xs text-blue-600">
                              📷 Enable media uploads with additional Twitter authentication
                            </p>
                          )}
                        </div>
                        {account.has_oauth1 ? (
                          <span className="flex items-center text-green-600 text-sm">
                            <Check className="h-4 w-4 mr-1" />
                            Enabled
                          </span>
                        ) : (
                          <button
                            onClick={handleOAuth1Connect}
                            disabled={isTeamMode}
                            className="btn btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <LinkIcon className="h-4 w-4 mr-1" />
                            Enable Media
                          </button>
                        )}
                      </div>
                    </div>

                    {/* ── X Premium / Extended Posts Toggle ──────────────────── */}
                    <div
                      className={`p-4 rounded-lg border transition-colors ${
                        xLongPostEnabled
                          ? 'bg-purple-50 border-purple-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <h4 className="font-medium text-gray-900 mb-1">
                            X Premium - Extended Posts
                          </h4>
                          <p className="text-sm text-gray-600 mb-1">
                            Enable posts up to 2,000 characters. Only turn this on if your X
                            account has an active Premium subscription.
                          </p>
                          {xLongPostEnabled ? (
                            <p className="text-xs text-purple-700 flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              Extended limit active - AI will also generate longer content
                            </p>
                          ) : (
                            <p className="text-xs text-gray-500">
                              Currently using standard 280 character limit
                            </p>
                          )}
                        </div>

                        {/* Toggle button */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={xLongPostEnabled}
                          aria-label="Enable X Premium extended posts"
                          disabled={isTeamMode || isUpdatingPreference}
                          onClick={handleToggleXPremium}
                          className="relative flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                          style={{
                            width: '44px',
                            height: '24px',
                            borderRadius: '999px',
                            background: xLongPostEnabled ? '#7c3aed' : '#d1d5db',
                            border: 'none',
                            padding: 0,
                            cursor: isTeamMode || isUpdatingPreference ? 'not-allowed' : 'pointer',
                            transition: 'background 0.2s ease',
                          }}
                        >
                          {isUpdatingPreference ? (
                            // Subtle spinner inside toggle while saving
                            <div
                              style={{
                                position: 'absolute',
                                top: '4px',
                                left: '13px',
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                border: '2px solid rgba(255,255,255,0.4)',
                                borderTopColor: 'white',
                                animation: 'spin 0.6s linear infinite',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                position: 'absolute',
                                top: '3px',
                                left: xLongPostEnabled ? '23px' : '3px',
                                width: '18px',
                                height: '18px',
                                borderRadius: '50%',
                                background: 'white',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                                transition: 'left 0.2s ease',
                              }}
                            />
                          )}
                        </button>
                      </div>

                      {isTeamMode && (
                        <p className="mt-2 text-xs text-amber-700">
                          Posting preferences are per-account and managed individually outside of team mode.
                        </p>
                      )}
                    </div>
                    {/* ────────────────────────────────────────────────────────── */}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Twitter className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  {isTeamMode
                    ? 'Personal Twitter Is Locked In Team Mode'
                    : 'No Twitter Account Connected'}
                </h4>
                <p className="text-gray-600 mb-6">
                  {isTeamMode
                    ? 'Connect a Twitter account to your team from Team settings, then use it here.'
                    : 'Connect your Twitter account to start posting and managing your content'}
                </p>
                <button
                  onClick={handleTwitterConnect}
                  disabled={isTeamMode}
                  className="btn btn-primary btn-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Connect Twitter Account
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spinner keyframe — inline so no CSS file dependency */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Settings;
