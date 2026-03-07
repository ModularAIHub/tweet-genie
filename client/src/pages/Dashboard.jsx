import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Edit3,
  Calendar,
  BarChart3,
  Plus,
  TrendingUp,
  Users,
  MessageCircle,
  Lock,
  Heart,
  Repeat2,
  Twitter,
  Zap,
  Target,
  Layers,
} from 'lucide-react';
import { credits, CREDIT_BALANCE_UPDATED_EVENT } from '../utils/api';
import { useAccount } from '../contexts/AccountContext';
import { useAuth } from '../contexts/AuthContext';
import { hasProPlanAccess } from '../utils/planAccess';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import { DashboardSkeleton } from '../components/Skeletons';
import TeamRedirectHandler from '../components/TeamRedirectHandler';
import { isPageVisible } from '../utils/requestCache';

const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = Number.parseInt(
  import.meta.env.VITE_DASHBOARD_BOOTSTRAP_TIMEOUT_MS || '8000',
  10
);

const Dashboard = () => {
  // No auto-redirect. User must click Twitter button to start connection.
  const { user } = useAuth();
  const { selectedAccount, accounts, loading: accountsLoading, isTeamMode } = useAccount();
  const totalConnectedAccounts = accounts.length;
  const maxAccounts = isTeamMode ? 8 : 1;
  const hasProAccess = hasProPlanAccess(user);

  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [recentTweets, setRecentTweets] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const bootstrapInFlightRef = useRef(false);

  // Get fresh accountAPI on every render to capture current selectedAccount
  const accountAPI = useAccountAwareAPI();

  useEffect(() => {
    const canFetch =
      !accountsLoading &&
      ((accounts.length > 0 && selectedAccount) || accounts.length === 0);

    if (!canFetch) {
      return undefined;
    }

    const fetchIfVisible = () => {
      if (!isPageVisible()) return;
      fetchDashboardData();
    };

    fetchIfVisible();

    if (isPageVisible()) {
      return undefined;
    }

    const onVisibilityChange = () => {
      fetchIfVisible();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [selectedAccount, accountsLoading, accounts.length]);

  const fetchDashboardData = async () => {
    if (bootstrapInFlightRef.current) {
      return;
    }

    bootstrapInFlightRef.current = true;
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(DASHBOARD_BOOTSTRAP_TIMEOUT_MS) && DASHBOARD_BOOTSTRAP_TIMEOUT_MS > 0
      ? DASHBOARD_BOOTSTRAP_TIMEOUT_MS
      : 8000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      setLoading(true);
      setHasAttemptedFetch(true);

      try {
        const bootstrapResponse = await accountAPI.fetchForCurrentAccount('/api/dashboard/bootstrap?days=50', {
          cacheTtlMs: 20000,
          signal: controller.signal,
        });

        if (!bootstrapResponse?.ok) {
          throw new Error(`Dashboard bootstrap failed (${bootstrapResponse?.status || 'unknown'})`);
        }

        const payload = await bootstrapResponse.json();
        const normalizedPayload = payload && typeof payload === 'object' ? payload : null;
        const isDisconnected = Boolean(normalizedPayload?.disconnected);

        setAnalyticsData(isDisconnected ? null : normalizedPayload);
        setRecentTweets(Array.isArray(normalizedPayload?.recent_tweets) ? normalizedPayload.recent_tweets : []);
        setCreditBalance(normalizedPayload?.credits || null);
      } catch (error) {
        const isTimeoutError = error?.name === 'AbortError';
        const errorMessage = isTimeoutError
          ? `Dashboard bootstrap timed out after ${timeoutMs}ms`
          : (error?.message || error);
        console.error('Dashboard data fetch error:', errorMessage);
        // Don't throw - allow dashboard to display even if fetch fails
        setAnalyticsData(null);
        setRecentTweets([]);
        setCreditBalance(null);
      }

    } finally {
      clearTimeout(timeoutId);
      bootstrapInFlightRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const refreshCredits = async ({ bypass = false } = {}) => {
      try {
        const response = bypass
          ? await credits.getBalance()
          : await credits.getBalanceCached({ ttlMs: 20000, bypass });
        if (!cancelled) {
          setCreditBalance(response.data);
        }
      } catch {
        // Ignore transient credit refresh errors on passive updates.
      }
    };

    const onCreditBalanceUpdated = () => {
      if (!isPageVisible()) return;
      refreshCredits({ bypass: true });
    };

    const onFocus = () => {
      refreshCredits();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(CREDIT_BALANCE_UPDATED_EVENT, onCreditBalanceUpdated);
      window.addEventListener('focus', onFocus);
    }

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(CREDIT_BALANCE_UPDATED_EVENT, onCreditBalanceUpdated);
        window.removeEventListener('focus', onFocus);
      }
    };
  }, []);

  if (accountsLoading || loading) {
    return <DashboardSkeleton />;
  }

  // Build connect banner for users without Twitter connected (shown inline, not as replacement)
  let connectBanner = null;
  const needsTwitterConnect = accounts.length === 0 && hasAttemptedFetch;
  if (needsTwitterConnect) {
    connectBanner = (
      <div className="bg-gradient-to-r from-blue-50/50 via-white to-purple-50/50 backdrop-blur-sm border border-blue-100 rounded-2xl p-6 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-shrink-0 p-3 bg-blue-100 rounded-full">
            <Twitter className="h-8 w-8 text-blue-600" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="text-lg font-semibold text-gray-900">Connect your Twitter account</h3>
            <p className="text-sm text-gray-600 mt-1">
              Link your Twitter to start composing, scheduling, and automating tweets.
            </p>
          </div>
          <a
            href="/settings"
            className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all font-medium text-sm whitespace-nowrap shadow-md hover:shadow-lg hover:-translate-y-0.5"
          >
            <Twitter className="h-4 w-4 mr-2" />
            Connect Twitter
          </a>
        </div>
      </div>
    );
  }

  // Always show Social Accounts section if accounts exist
  let socialAccountsSection = null;
  if (accounts.length > 0) {
    socialAccountsSection = (
      <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-gray-200/50 p-6 mb-8 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Social Accounts</h3>
          <span className="text-sm text-gray-600">
            {isTeamMode ? `${totalConnectedAccounts} / ${maxAccounts} connected` : `${totalConnectedAccounts} connected`}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account, idx) => {
            // Use id, twitter_user_id, team_id, or fallback to idx
            const key = account.id || account.twitter_user_id || account.team_id || idx;
            return (
              <div key={key} className="card flex items-center space-x-4 p-4">
                <img
                  src={account.profile_image_url || account.twitter_profile_image_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'}
                  alt={account.account_username || account.username || account.twitter_username}
                  className="h-12 w-12 rounded-full border"
                />
                <div>
                  <div className="font-semibold text-gray-900">
                    @{account.account_username || account.username || account.twitter_username}
                  </div>
                  <div className="text-sm text-gray-600">
                    {account.account_display_name || account.display_name || account.twitter_display_name || account.nickname}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Connected
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const stats = [
    {
      name: 'Total Tweets',
      value: analyticsData?.overview?.total_tweets || 0,
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-gradient-to-br from-blue-50 to-blue-100/50',
    },
    {
      name: 'Total Impressions',
      value: analyticsData?.overview?.total_impressions || 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50',
    },
    {
      name: 'Total Likes',
      value: analyticsData?.overview?.total_likes || 0,
      icon: Heart,
      color: 'text-red-600',
      bgColor: 'bg-gradient-to-br from-rose-50 to-rose-100/50',
    },
    {
      name: 'Total Retweets',
      value: analyticsData?.overview?.total_retweets || 0,
      icon: Repeat2,
      color: 'text-purple-600',
      bgColor: 'bg-gradient-to-br from-indigo-50 to-indigo-100/50',
    },
  ];

  const quickActions = [
    {
      name: 'Compose Tweet',
      description: 'Create and post a new tweet',
      href: '/compose',
      icon: Edit3,
      color: 'bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
    },
    {
      name: 'Schedule Tweet',
      description: 'Plan your content ahead',
      href: '/scheduling',
      icon: Calendar,
      color: 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700',
    },
    {
      name: 'View Analytics',
      description: 'Check your performance',
      href: '/analytics',
      icon: BarChart3,
      color: 'bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700',
    },
  ];

  const powerFeatures = [
    {
      name: 'Bulk Generation',
      description: 'Generate multiple tweets at once with AI',
      benefits: ['Save time with batch creation', 'Maintain consistent voice', 'Plan weeks of content in minutes'],
      href: '/bulk-generation',
      icon: Layers,
      color: 'from-orange-500 to-red-600',
      proOnly: true,
    },
    {
      name: 'Strategy Builder',
      description: 'Create data-driven content strategies',
      benefits: ['AI-powered content planning', 'Audience targeting insights', 'Optimize posting schedule'],
      href: '/strategy',
      icon: Target,
      color: 'from-indigo-500 to-purple-600',
      proOnly: true,
    },
  ];
  const visiblePowerFeatures = powerFeatures;

  return (
    <>
      <TeamRedirectHandler />
      <div className="space-y-8">
        {/* Connect Twitter Banner (shows when no account connected) */}
        {connectBanner}

        {/* Social Accounts Section (shows when accounts exist) */}
        {socialAccountsSection}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-2 text-gray-600">
              Welcome back! Here's an overview of your Twitter activity.
            </p>
          </div>
          {/* Removed round icon and email from header */}
          <Link
            to="/compose"
            className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <Plus className="h-5 w-5 mr-2" />
            New Tweet
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.name} className="bg-white/80 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all hover:-translate-y-1">
                <div className="flex items-center">
                  <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Credits Balance */}
        {creditBalance && (
          <div className="bg-white/80 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Credit Balance</h3>
                <p className="text-3xl font-bold text-primary-600 mt-2">
                  {creditBalance.balance}
                </p>
                <p className="text-sm text-gray-600">
                  Credits available for posting and AI generation
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">Total Earned</p>
                <p className="text-lg font-semibold text-gray-900">
                  {creditBalance.total_earned}
                </p>
                <p className="text-sm text-gray-600 mt-2">Total Used</p>
                <p className="text-lg font-semibold text-gray-900">
                  {creditBalance.total_used}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.name}
                to={action.href}
                className="bg-white/80 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-xl hover:border-blue-100 transition-all cursor-pointer group hover:-translate-y-1"
              >
                <div className="text-center">
                  <div className={`inline-flex p-4 rounded-2xl ${action.color} shadow-lg shadow-${action.color.split('-')[2]}/20 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                    <Icon className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-gray-900">
                    {action.name}
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    {action.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Power Features */}
        {visiblePowerFeatures.length > 0 && (
          <div>
            <div className="flex items-center mb-6">
              <Zap className="h-6 w-6 text-yellow-500 mr-2" />
              <h2 className="text-2xl font-bold text-gray-900">Power Features</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {visiblePowerFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <Link
                    key={feature.name}
                    to={feature.href}
                    className="card hover:shadow-xl transition-all duration-300 cursor-pointer group overflow-hidden relative"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-5 transition-opacity`}></div>
                    <div className="relative">
                      <div className="flex items-start space-x-4">
                        <div className={`p-4 rounded-2xl bg-gradient-to-br ${feature.color} group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-xl shadow-${feature.color.split('-')[2]}/20`}>
                          <Icon className="h-7 w-7 text-white" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                            {feature.name}
                            {feature.proOnly && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${hasProAccess
                                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-100 text-amber-800 border-amber-200'
                                  }`}
                              >
                                {!hasProAccess && <Lock className="h-3 w-3" />}
                                Pro
                              </span>
                            )}
                          </h3>
                          <p className="text-sm text-gray-600 mb-4">
                            {feature.description}
                          </p>
                          <div className="space-y-2">
                            {feature.benefits.map((benefit, idx) => (
                              <div key={idx} className="flex items-start text-sm">
                                <span className="text-green-500 mr-2 mt-0.5">✓</span>
                                <span className="text-gray-700">{benefit}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center text-sm font-medium text-primary-600 group-hover:text-primary-700">
                        <span>{feature.proOnly && !hasProAccess ? 'View and Upgrade' : 'Get Started'}</span>
                        <svg className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Dashboard;
