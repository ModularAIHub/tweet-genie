import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Edit3,
  Calendar,
  BarChart3,
  Plus,
  TrendingUp,
  Users,
  MessageCircle,
  Heart,
  Repeat2,
  Twitter,
  UserX,
} from 'lucide-react';
import { analytics as analyticsAPI, tweets, credits } from '../utils/api';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import TeamRedirectHandler from '../components/TeamRedirectHandler';

const Dashboard = () => {
  // No auto-redirect. User must click Twitter button to start connection.
  const { selectedAccount, accounts, loading: accountsLoading } = useAccount();
  const totalConnectedAccounts = accounts.length;
  const maxAccounts = 8;
  // Debug logging for accounts
  useEffect(() => {
    console.log('[Dashboard] Accounts:', accounts);
    console.log('[Dashboard] Selected Account:', selectedAccount);
    console.log('[Dashboard] Accounts Loading:', accountsLoading);
  }, [accounts, selectedAccount, accountsLoading]);
  const accountAPI = useAccountAwareAPI();
  
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [recentTweets, setRecentTweets] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [userTeamStatus, setUserTeamStatus] = useState(null); // null = loading, true = in team, false = individual

  // Check user's team status on component mount
  useEffect(() => {
    const checkUserTeamStatus = async () => {
      try {
        const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';
        const response = await fetch(`${apiBaseUrl}/api/twitter/user/profile`, {
          credentials: 'include'
        });
        if (response.ok) {
          const userProfile = await response.json();
          const isInTeam = userProfile.team_id || (userProfile.teamMemberships && userProfile.teamMemberships.length > 0);
          setUserTeamStatus(isInTeam);
        } else {
          setUserTeamStatus(false); // Default to individual user
        }
      } catch (error) {
        console.error('Error checking user team status:', error);
        setUserTeamStatus(false); // Default to individual user
      }
    };
    checkUserTeamStatus();
  }, []);

  useEffect(() => {
    // For team users: wait for account selection
    // For individual users: fetch data immediately
    if (!accountsLoading) {
      if (accounts.length > 0 && selectedAccount) {
        // Team user with selected account
        fetchDashboardData();
      } else if (accounts.length === 0) {
        // Individual user - fetch data immediately
        fetchDashboardData();
      }
    }
  }, [selectedAccount, accountsLoading, accounts]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // For team users, use account-aware API calls
      // For individual users, use original API calls
      const isTeamUser = accounts.length > 0;
      
      const [analyticsRes, tweetsRes, creditsRes] = await Promise.allSettled([
        isTeamUser ? accountAPI.getAnalytics('30d') : analyticsAPI.getOverview({ days: 30 }),
        isTeamUser ? accountAPI.getTweetHistory(1, 5) : tweets.list({ limit: 5 }),
        credits.getBalance(), // Credits are user-level, not account-specific
      ]);

      if (analyticsRes.status === 'fulfilled') {
        if (isTeamUser) {
          const analyticsResponse = await analyticsRes.value.json();
          setAnalyticsData(analyticsResponse.data || analyticsResponse);
        } else {
          setAnalyticsData(analyticsRes.value.data);
        }
      }

      if (tweetsRes.status === 'fulfilled') {
        if (isTeamUser) {
          const tweetsResponse = await tweetsRes.value.json();
          setRecentTweets(tweetsResponse.data?.tweets || tweetsResponse.tweets || []);
        } else {
          setRecentTweets(tweetsRes.value.data.tweets || []);
        }
      }

      if (creditsRes.status === 'fulfilled') {
        setCreditBalance(creditsRes.value.data);
      }

    } catch (error) {
      console.error('Dashboard data fetch error:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (accountsLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading accounts...</p>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    // Show loading while checking team status
    if (userTeamStatus === null) {
      console.log('[Dashboard] userTeamStatus is null, loading...');
      return (
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      );
    }
    // If no accounts, show connection options
    console.log('[Dashboard] No accounts found, showing connection options. userTeamStatus:', userTeamStatus);
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <UserX className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Twitter Account Connected</h3>
          <p className="text-gray-600 mb-6">
            Connect your social media accounts to get started.
          </p>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <a
              href="http://localhost:5173/team"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Twitter className="h-4 w-4 mr-2" />
              Twitter
            </a>
            <a
              href="#"
              className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-600 rounded-lg cursor-not-allowed"
              tabIndex={-1}
              aria-disabled="true"
            >
              <svg className="h-4 w-4 mr-2" />
              LinkedIn
            </a>
            <a
              href="#"
              className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-600 rounded-lg cursor-not-allowed"
              tabIndex={-1}
              aria-disabled="true"
            >
              <svg className="h-4 w-4 mr-2" />
              Facebook
            </a>
            <a
              href="#"
              className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-600 rounded-lg cursor-not-allowed"
              tabIndex={-1}
              aria-disabled="true"
            >
              <svg className="h-4 w-4 mr-2" />
              Instagram
            </a>
          </div>
          <div className="mt-4">
            <div className="text-sm text-gray-500 mb-2">
              <span className="font-semibold">Team Limit:</span> 8 accounts total<br />
              <span className="font-semibold">Connection Access:</span> Only Owner & Admin can connect/disconnect<br />
              All team members can use connected accounts for content creation
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Always show Social Accounts section if accounts exist
  let socialAccountsSection = null;
  if (accounts.length > 0) {
    console.log('[Dashboard] Social Accounts Section accounts:', accounts);
    socialAccountsSection = (
      <div className="card p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Social Accounts</h3>
          <span className="text-sm text-gray-600">{totalConnectedAccounts} / {maxAccounts} connected</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account, idx) => {
            // Use id, twitter_user_id, team_id, or fallback to idx
            const key = account.id || account.twitter_user_id || account.team_id || idx;
            return (
              <div key={key} className="card flex items-center space-x-4 p-4">
                <img
                  src={account.profile_image_url || account.twitter_profile_image_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'}
                  alt={account.username || account.twitter_username}
                  className="h-12 w-12 rounded-full border"
                />
                <div>
                  <div className="font-semibold text-gray-900">
                    @{account.username || account.twitter_username}
                  </div>
                  <div className="text-sm text-gray-600">
                    {account.display_name || account.twitter_display_name}
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

  if (!selectedAccount) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Selecting account...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading dashboard for @{selectedAccount.username}...</p>
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
      bgColor: 'bg-blue-50',
    },
    {
      name: 'Total Impressions',
      value: analyticsData?.overview?.total_impressions || 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      name: 'Total Likes',
      value: analyticsData?.overview?.total_likes || 0,
      icon: Heart,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      name: 'Total Retweets',
      value: analyticsData?.overview?.total_retweets || 0,
      icon: Repeat2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  const quickActions = [
    {
      name: 'Compose Tweet',
      description: 'Create and post a new tweet',
      href: '/compose',
      icon: Edit3,
      color: 'bg-primary-600 hover:bg-primary-700',
    },
    {
      name: 'Schedule Tweet',
      description: 'Plan your content ahead',
      href: '/scheduling',
      icon: Calendar,
      color: 'bg-green-600 hover:bg-green-700',
    },
    {
      name: 'View Analytics',
      description: 'Check your performance',
      href: '/analytics',
      icon: BarChart3,
      color: 'bg-purple-600 hover:bg-purple-700',
    },
  ];

  return (
    <>
      <TeamRedirectHandler />
      <div className="space-y-8">
        {/* Debug: Show raw accounts array */}
        <div className="card p-4 mb-4 bg-yellow-50 text-xs text-gray-800">
          <strong>Debug: Raw Accounts Array</strong>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(accounts, null, 2)}</pre>
        </div>
        {/* Social Accounts Section */}
        {socialAccountsSection}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-2 text-gray-600">
              Welcome back! Here's an overview of your Twitter activity.
            </p>
          </div>
          <Link
            to="/compose"
            className="btn btn-primary btn-lg"
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
              <div key={stat.name} className="card">
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
          <div className="card">
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
                className="card hover:shadow-lg transition-shadow cursor-pointer group"
              >
                <div className="text-center">
                  <div className={`inline-flex p-4 rounded-lg ${action.color} group-hover:scale-110 transition-transform`}>
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

        {/* Recent Tweets */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Recent Tweets</h3>
            <Link
              to="/compose"
              className="text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              View all
            </Link>
          </div>

          {recentTweets.length > 0 ? (
            <div className="space-y-4">
              {recentTweets.map((tweet) => (
                <div
                  key={tweet.id}
                  className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 bg-twitter-500 rounded-full flex items-center justify-center">
                      <Twitter className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium text-gray-900">
                        @{tweet.username}
                      </p>
                      <span className={`badge ${
                        tweet.status === 'posted' ? 'badge-success' :
                        tweet.status === 'scheduled' ? 'badge-info' :
                        'badge-warning'
                      }`}>
                        {tweet.status}
                      </span>
                    </div>
                    <p className="mt-1 text-gray-700 line-clamp-2">
                      {tweet.content}
                    </p>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                      <span className="flex items-center">
                        <Heart className="h-4 w-4 mr-1" />
                        {tweet.likes || 0}
                      </span>
                      <span className="flex items-center">
                        <Repeat2 className="h-4 w-4 mr-1" />
                        {tweet.retweets || 0}
                      </span>
                      <span className="flex items-center">
                        <MessageCircle className="h-4 w-4 mr-1" />
                        {tweet.replies || 0}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Edit3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No tweets yet</p>
              <p className="text-sm text-gray-500 mt-2">
                Start creating content to see your tweets here
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Dashboard;
