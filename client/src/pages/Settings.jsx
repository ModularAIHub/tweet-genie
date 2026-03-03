import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Twitter, 
  Key, 
  Link as LinkIcon,
  Unlink,
  Check,
  X,
  Eye,
  EyeOff,
  Bot,
  Clock,
  RotateCcw,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Inbox,
  Send,
} from 'lucide-react';
import { twitter, providers, autopilot as autopilotAPI, strategy as strategyAPI } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import { useAccount } from '../contexts/AccountContext';

const Settings = () => {
  const { isTeamMode } = useAccount();
  const navigate = useNavigate();
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

  // ── Autopilot state ─────────────────────────────────────────────────────
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [autopilotConfig, setAutopilotConfig] = useState(null);
  const [autopilotLoading, setAutopilotLoading] = useState(false);
  const [autopilotUpdating, setAutopilotUpdating] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const [pendingUndos, setPendingUndos] = useState([]);
  const [autopilotQueue, setAutopilotQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueActionLoading, setQueueActionLoading] = useState({});

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

  // ── Autopilot helpers ───────────────────────────────────────────────────
  const fetchStrategies = async () => {
    try {
      const res = await strategyAPI.list();
      const list = res.data?.data || res.data || [];
      const active = list.filter((s) => s.status === 'active');
      setStrategies(active);
      if (active.length > 0 && !selectedStrategyId) {
        setSelectedStrategyId(active[0].id);
      }
    } catch {
      // non-critical
    }
  };

  const fetchAutopilotConfig = async (strategyId) => {
    if (!strategyId) return;
    setAutopilotLoading(true);
    try {
      const res = await autopilotAPI.getConfig(strategyId);
      setAutopilotConfig(res.data?.data || res.data || null);
    } catch {
      setAutopilotConfig(null);
    } finally {
      setAutopilotLoading(false);
    }
  };

  const fetchActivityLog = async () => {
    setActivityLogLoading(true);
    try {
      const res = await autopilotAPI.getActivityLog({ limit: 30 });
      setActivityLog(res.data?.data || []);
    } catch {
      setActivityLog([]);
    } finally {
      setActivityLogLoading(false);
    }
  };

  const fetchPendingUndos = async () => {
    try {
      const res = await autopilotAPI.getPendingUndo();
      setPendingUndos(res.data?.data || []);
    } catch {
      setPendingUndos([]);
    }
  };

  const handleToggleAutopilot = async () => {
    if (!selectedStrategyId) return;
    setAutopilotUpdating(true);
    const next = !autopilotConfig?.is_enabled;
    try {
      const res = await autopilotAPI.updateConfig(selectedStrategyId, { is_enabled: next });
      setAutopilotConfig(res.data?.data || res.data || null);
      toast.success(next
        ? 'Autopilot enabled — tweets will be auto-scheduled after generation.'
        : 'Autopilot disabled — tweets will go to your review queue.');
      if (next) fetchPendingUndos();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update autopilot');
    } finally {
      setAutopilotUpdating(false);
    }
  };

  const handleToggleRequireApproval = async () => {
    if (!selectedStrategyId) return;
    setAutopilotUpdating(true);
    const next = !autopilotConfig?.require_approval;
    try {
      const res = await autopilotAPI.updateConfig(selectedStrategyId, { require_approval: next });
      setAutopilotConfig(res.data?.data || res.data || null);
      toast.success(next
        ? 'Approval required — new autopilot tweets will go to Content Queue for review.'
        : 'Auto-approve enabled — new autopilot tweets will be scheduled automatically.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update setting');
    } finally {
      setAutopilotUpdating(false);
    }
  };

  const handleChangePostsPerDay = async (value) => {
    if (!selectedStrategyId) return;
    setAutopilotUpdating(true);
    try {
      const res = await autopilotAPI.updateConfig(selectedStrategyId, { posts_per_day: value });
      setAutopilotConfig(res.data?.data || res.data || null);
      toast.success(`Posting frequency set to ${value}x per day`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update frequency');
    } finally {
      setAutopilotUpdating(false);
    }
  };

  const handleUndoTweet = async (scheduledTweetId) => {
    try {
      await autopilotAPI.undoTweet(scheduledTweetId);
      setPendingUndos((prev) => prev.filter((t) => t.id !== scheduledTweetId));
      toast.success('Tweet undone — moved back to review queue');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to undo tweet');
    }
  };

  const fetchAutopilotQueue = async (strategyId) => {
    const sid = strategyId || selectedStrategyId;
    if (!sid) return;
    setQueueLoading(true);
    try {
      const res = await autopilotAPI.getQueue(sid, { status: 'pending,approved' });
      setAutopilotQueue(res.data?.data || []);
    } catch {
      setAutopilotQueue([]);
    } finally {
      setQueueLoading(false);
    }
  };

  const handleApproveQueueItem = async (queueId) => {
    setQueueActionLoading((p) => ({ ...p, [queueId]: true }));
    try {
      await autopilotAPI.approveItem(queueId);
      setAutopilotQueue((prev) => prev.map((i) => i.id === queueId ? { ...i, status: 'approved' } : i));
      toast.success('Content approved — will be scheduled automatically');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to approve');
    } finally {
      setQueueActionLoading((p) => ({ ...p, [queueId]: false }));
    }
  };

  const handleRejectQueueItem = async (queueId) => {
    setQueueActionLoading((p) => ({ ...p, [queueId]: true }));
    try {
      await autopilotAPI.rejectItem(queueId, 'Rejected by user');
      setAutopilotQueue((prev) => prev.filter((i) => i.id !== queueId));
      toast.success('Content rejected');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reject');
    } finally {
      setQueueActionLoading((p) => ({ ...p, [queueId]: false }));
    }
  };

  useEffect(() => {
    if (activeTab === 'autopilot') {
      fetchStrategies();
      fetchActivityLog();
      fetchPendingUndos();
      fetchAutopilotQueue();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedStrategyId && activeTab === 'autopilot') {
      fetchAutopilotConfig(selectedStrategyId);
      fetchAutopilotQueue(selectedStrategyId);
    }
  }, [selectedStrategyId]);

  const tabs = [
    { id: 'twitter', name: 'Twitter Account', icon: Twitter },
    { id: 'autopilot', name: 'Autopilot', icon: Bot },
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

      {/* Autopilot Tab */}
      {activeTab === 'autopilot' && (
        <div className="space-y-6">
          {/* Strategy selector */}
          {strategies.length > 1 && (
            <div className="card">
              <label className="block text-sm font-medium text-gray-700 mb-2">Strategy</label>
              <select
                value={selectedStrategyId || ''}
                onChange={(e) => setSelectedStrategyId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>{s.niche || 'Strategy'} — {s.status}</option>
                ))}
              </select>
            </div>
          )}

          {strategies.length === 0 && (
            <div className="card text-center py-8">
              <Bot className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h4 className="text-lg font-medium text-gray-900 mb-2">No Active Strategy</h4>
              <p className="text-gray-600">Create a strategy first to use autopilot.</p>
            </div>
          )}

          {strategies.length > 0 && (
            <>
              {/* Autopilot toggle */}
              <div className="card">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                      <Bot className="h-5 w-5" />
                      Autopilot Mode
                    </h3>
                    <p className="text-sm text-gray-600 mb-1">
                      When enabled, weekly generated tweets are automatically scheduled — skipping the review queue.
                    </p>
                    {autopilotConfig?.is_enabled ? (
                      <p className="text-xs text-green-700 flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        Active — tweets auto-schedule with a 1-hour undo window
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Disabled — tweets go to review queue for manual approval
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!autopilotConfig?.is_enabled}
                    aria-label="Enable Autopilot"
                    disabled={autopilotLoading || autopilotUpdating}
                    onClick={handleToggleAutopilot}
                    className="relative flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '999px',
                      background: autopilotConfig?.is_enabled ? '#059669' : '#d1d5db',
                      border: 'none',
                      padding: 0,
                      cursor: autopilotLoading || autopilotUpdating ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s ease',
                    }}
                  >
                    {autopilotUpdating ? (
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
                          left: autopilotConfig?.is_enabled ? '23px' : '3px',
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

                {autopilotConfig?.is_enabled && (
                  <div className="mt-5 space-y-4">
                    {/* Require Approval Toggle */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">Require Approval</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {autopilotConfig?.require_approval
                            ? 'New tweets go to Content Queue as "Pending" — you approve before posting.'
                            : 'New tweets are auto-approved and scheduled immediately — fully hands-free.'}
                        </p>
                      </div>
                      <button
                        onClick={handleToggleRequireApproval}
                        disabled={autopilotUpdating}
                        role="switch"
                        aria-checked={!!autopilotConfig?.require_approval}
                        className="relative inline-flex flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out disabled:opacity-50"
                        style={{
                          width: '44px',
                          height: '24px',
                          background: autopilotConfig?.require_approval ? '#059669' : '#d1d5db',
                          border: 'none',
                          padding: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            backgroundColor: 'white',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            transition: 'left 0.2s ease',
                            position: 'absolute',
                            top: '3px',
                            left: autopilotConfig?.require_approval ? '23px' : '3px',
                          }}
                        />
                      </button>
                    </div>

                    {/* Posts Per Day Selector */}
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-sm font-medium text-gray-900 mb-1">Posting Frequency</p>
                      <p className="text-xs text-gray-500 mb-3">How many tweets per day should autopilot schedule?</p>
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            onClick={() => handleChangePostsPerDay(n)}
                            disabled={autopilotUpdating}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                              (autopilotConfig?.posts_per_day || 3) === n
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
                            } disabled:opacity-50`}
                          >
                            {n}x
                          </button>
                        ))}
                        <span className="text-xs text-gray-500 ml-2">per day</span>
                      </div>
                    </div>

                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        Every autopilot-scheduled tweet has a 1-hour undo window. After that, it will be posted at its scheduled time.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Pending Undo Tweets */}
              {pendingUndos.length > 0 && (
                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-amber-600" />
                    Undo Window ({pendingUndos.length})
                  </h3>
                  <div className="space-y-3">
                    {pendingUndos.map((tweet) => {
                      const timeLeft = Math.max(0, Math.round((new Date(tweet.undo_deadline) - Date.now()) / 60000));
                      return (
                        <div key={tweet.id} className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-900 line-clamp-2">{tweet.content}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Scheduled: {new Date(tweet.scheduled_for).toLocaleString()}
                              {' '}&middot;{' '}
                              <span className="text-amber-600 font-medium">{timeLeft}m left to undo</span>
                            </p>
                          </div>
                          <button
                            onClick={() => handleUndoTweet(tweet.id)}
                            className="btn btn-secondary btn-sm flex items-center gap-1 flex-shrink-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Undo
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Autopilot Content Queue */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Inbox className="h-5 w-5 text-indigo-600" />
                    Content Queue
                    {autopilotQueue.length > 0 && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        {autopilotQueue.length}
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => navigate('/content-review')}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
                  >
                    View all in Content Queue &rarr;
                  </button>
                </div>
                {queueLoading ? (
                  <div className="flex justify-center py-6">
                    <LoadingSpinner size="md" />
                  </div>
                ) : autopilotQueue.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    No queued content. Autopilot generates and queues tweets automatically when enabled.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto">
                    {autopilotQueue.map((item) => {
                      const isPending = item.status === 'pending';
                      const isApproved = item.status === 'approved';
                      const isLoading = queueActionLoading[item.id];
                      return (
                        <div key={item.id} className={`p-4 rounded-lg border ${
                          isApproved ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50'
                        }`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              isApproved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {isApproved ? 'Approved' : 'Pending review'}
                            </span>
                            {item.prompt_category && (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">
                                {item.prompt_category}
                              </span>
                            )}
                            {item.scheduled_for && (
                              <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
                                <Send className="h-3 w-3" />
                                {new Date(item.scheduled_for).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed mb-3">
                            {item.generated_content}
                          </p>
                          {item.prompt_text && (
                            <p className="text-xs text-indigo-500 mb-3 truncate">
                              Prompt: {item.prompt_text}
                            </p>
                          )}
                          {isPending && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleApproveQueueItem(item.id)}
                                disabled={isLoading}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                              >
                                <CheckCircle className="h-3 w-3" /> Approve
                              </button>
                              <button
                                onClick={() => handleRejectQueueItem(item.id)}
                                disabled={isLoading}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                              >
                                <XCircle className="h-3 w-3" /> Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Activity Log */}
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                  Autopilot Activity Log
                </h3>
                {activityLogLoading ? (
                  <div className="flex justify-center py-6">
                    <LoadingSpinner size="md" />
                  </div>
                ) : activityLog.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    No autopilot activity yet. Enable autopilot to see scheduled actions here.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {activityLog.map((entry) => {
                      const actionColors = {
                        auto_scheduled: 'text-green-700 bg-green-50',
                        generated: 'text-blue-700 bg-blue-50',
                        undo: 'text-amber-700 bg-amber-50',
                        approved: 'text-green-700 bg-green-50',
                        rejected: 'text-red-700 bg-red-50',
                        posted: 'text-green-700 bg-green-50',
                        failed: 'text-red-700 bg-red-50',
                      };
                      const color = actionColors[entry.action] || 'text-gray-700 bg-gray-50';
                      return (
                        <div key={entry.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
                            {entry.action.replace('_', ' ')}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 truncate">
                              {entry.niche && <span className="font-medium">{entry.niche}</span>}
                              {entry.tweets_count > 0 && ` — ${entry.tweets_count} tweet${entry.tweets_count > 1 ? 's' : ''}`}
                              {entry.category && ` (${entry.category})`}
                              {!entry.success && entry.error_message && (
                                <span className="text-red-600"> — {entry.error_message}</span>
                              )}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {new Date(entry.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
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
