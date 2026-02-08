import React, { useState, useEffect } from 'react';
import { 
  Twitter, 
  Settings as SettingsIcon, 
  Key, 
  Sparkles,
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

const Settings = () => {
  const [activeTab, setActiveTab] = useState('twitter');
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [aiProviders, setAiProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showApiKey, setShowApiKey] = useState({});

  useEffect(() => {
    fetchData();
    
    // Check for OAuth 1.0a success parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('oauth1_connected') === 'true') {
      toast.success('Media upload permissions enabled successfully!');
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    if (urlParams.get('error') === 'oauth1_connection_failed') {
      toast.error('Failed to enable media permissions. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [accountsRes, providersRes] = await Promise.allSettled([
        twitter.getStatus(),
        providers.list(),
      ]);

      if (accountsRes.status === 'fulfilled') {
        // getStatus returns { account: ... } or { accounts: [...] }
        const data = accountsRes.value.data;
        if (Array.isArray(data.accounts)) {
          setTwitterAccounts(data.accounts);
        } else if (data.account) {
          setTwitterAccounts([data.account]);
        } else {
          setTwitterAccounts([]);
        }
      }

      if (providersRes.status === 'fulfilled') {
        setAiProviders(providersRes.value.data.providers || []);
      }
    } catch (error) {
      console.error('Failed to fetch settings data:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth1Connect = async () => {
    try {
      const response = await twitter.connectOAuth1();
      const { url } = response.data;
      
      // Open OAuth 1.0a auth in new popup window
      const popup = window.open(
        url,
        'twitter-oauth1-auth',
        'width=600,height=600,scrollbars=yes,resizable=yes'
      );
      
      // Listen for popup completion
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          // Check if OAuth 1.0a was successful by refreshing data
          setTimeout(() => {
            fetchData();
          }, 1000);
        }
      }, 1000);
      
    } catch (error) {
      console.error('OAuth 1.0a connect error:', error);
      toast.error('Failed to initiate OAuth 1.0a connection');
    }
  };

  const handleTwitterConnect = async () => {
    try {
      const response = await twitter.connect();
      const { url, oauth_token, state, oauth_token_secret } = response.data;
      // Store oauth_token_secret in sessionStorage for the callback (if needed)
      if (oauth_token_secret) {
        sessionStorage.setItem('oauth_token_secret', oauth_token_secret);
      }
      // Open Twitter auth in new popup window
      const popup = window.open(
        url,
        'twitter-auth',
        'width=600,height=600,scrollbars=yes,resizable=yes'
      );
      
      // Listen for messages from the popup
      const handleMessage = (event) => {
        // Ensure message is from our popup
        if (event.source !== popup) return;
        
        if (event.data.type === 'TWITTER_AUTH_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          toast.success('Twitter account connected successfully!');
          fetchData(); // Refresh data
          popup.close();
        } else if (event.data.type === 'TWITTER_AUTH_ERROR') {
          window.removeEventListener('message', handleMessage);
          toast.error(event.data.error || 'Failed to connect Twitter account');
          popup.close();
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Handle popup being closed manually
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          sessionStorage.removeItem('oauth_token_secret');
        }
      }, 1000);
      
    } catch (error) {
      console.error('Twitter connect error:', error);
      toast.error('Failed to initiate Twitter connection');
    }
  };

  const handleTwitterDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect this Twitter account?')) {
      return;
    }

    try {
      await twitter.disconnect();
      toast.success('Twitter account disconnected successfully!');
      fetchData();
    } catch (error) {
      console.error('Twitter disconnect error:', error);
      toast.error('Failed to disconnect Twitter account');
    }
  };

  const handleProviderConfigure = async (providerName, apiKey) => {
    try {
      await providers.configure(providerName, { api_key: apiKey });
      toast.success(`${providerName} configured successfully`);
      fetchData();
    } catch (error) {
      console.error('Provider configure error:', error);
      toast.error(`Failed to configure ${providerName}`);
    }
  };

  const handleProviderRemove = async (providerName) => {
    if (!confirm(`Are you sure you want to remove ${providerName}?`)) {
      return;
    }

    try {
      await providers.remove(providerName);
      toast.success(`${providerName} removed successfully`);
      fetchData();
    } catch (error) {
      console.error('Provider remove error:', error);
      toast.error(`Failed to remove ${providerName}`);
    }
  };

  const tabs = [
    { id: 'twitter', name: 'Twitter Account', icon: Twitter },
  ];

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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">
          Manage your Twitter connections
        </p>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Twitter Account Connection
            </h3>
            
            {twitterAccounts.length > 0 ? (
              <div className="space-y-4">
                {twitterAccounts.map((account) => (
                  <div key={account.id} className="space-y-4">
                    {/* OAuth 2.0 Connection Status */}
                    <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex items-center space-x-4">
                        <img
                          src={account.profile_image_url}
                          alt="Profile"
                          className="h-12 w-12 rounded-full"
                        />
                        <div>
                          <h4 className="font-medium text-gray-900">
                            {account.display_name}
                          </h4>
                          <p className="text-sm text-gray-600">
                            @{account.username}
                          </p>
                          <p className="text-xs text-gray-500">
                            {account.followers_count?.toLocaleString()} followers • 
                            {account.following_count?.toLocaleString()} following
                          </p>
                          <p className="text-xs text-green-600 font-medium">
                            ✓ OAuth 2.0 Connected (Text tweets)
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="flex items-center text-green-600 text-sm">
                          <Check className="h-4 w-4 mr-1" />
                          Connected
                        </span>
                        <button
                          onClick={() => handleTwitterDisconnect()}
                          className="btn btn-secondary btn-sm"
                        >
                          <Unlink className="h-4 w-4 mr-1" />
                          Disconnect
                        </button>
                      </div>
                    </div>

                    {/* OAuth 1.0a Status */}
                    <div className={`p-4 rounded-lg border ${account.has_oauth1 ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
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
                            className="btn btn-primary btn-sm"
                          >
                            <LinkIcon className="h-4 w-4 mr-1" />
                            Enable Media
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Twitter className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  No Twitter Account Connected
                </h4>
                <p className="text-gray-600 mb-6">
                  Connect your Twitter account to start posting and managing your content
                </p>
                <button
                  onClick={handleTwitterConnect}
                  className="btn btn-primary btn-md"
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Connect Twitter Account
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Provider Card Component
const ProviderCard = ({ provider, onConfigure, onRemove, showApiKey, onToggleApiKey }) => {
  const [apiKey, setApiKey] = useState('');
  const [isConfiguring, setIsConfiguring] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setIsConfiguring(true);
    try {
      await onConfigure(provider.name, apiKey);
      setApiKey('');
    } catch (error) {
      // Error handled in parent
    } finally {
      setIsConfiguring(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-lg font-medium text-gray-900">
            {provider.display_name}
          </h4>
          <p className="text-sm text-gray-600">
            Models: {provider.models?.join(', ')}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {provider.hub_available && (
            <span className="badge badge-success">Hub Available</span>
          )}
          {provider.user_configured && (
            <span className="badge badge-info">BYOK Configured</span>
          )}
        </div>
      </div>

      {!provider.user_configured ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${provider.display_name} API key`}
                className="input pr-10"
              />
              <button
                type="button"
                onClick={onToggleApiKey}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4 text-gray-400" />
                ) : (
                  <Eye className="h-4 w-4 text-gray-400" />
                )}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={!apiKey.trim() || isConfiguring}
            className="btn btn-primary btn-sm"
          >
            {isConfiguring ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                Configuring...
              </>
            ) : (
              <>
                <Key className="h-4 w-4 mr-2" />
                Configure
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-green-600 flex items-center">
            <Check className="h-4 w-4 mr-1" />
            API key configured
          </span>
          <button
            onClick={() => onRemove(provider.name)}
            className="btn btn-secondary btn-sm"
          >
            <X className="h-4 w-4 mr-1" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
};

export default Settings;
