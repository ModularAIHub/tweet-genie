import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Twitter,
  Edit3,
  Calendar,
  BarChart3,
  Plus,
  TrendingUp,
  Users,
  MessageCircle,
  Heart,
  Repeat2,
} from 'lucide-react';
import { analytics, tweets, credits, twitter } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [recentTweets, setRecentTweets] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [twitterAccounts, setTwitterAccounts] = useState([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      const [analyticsRes, tweetsRes, creditsRes, accountsRes] = await Promise.allSettled([
        analytics.getOverview({ days: 30 }),
        tweets.list({ limit: 5 }),
        credits.getBalance(),
        twitter.getAccounts(),
      ]);

      if (analyticsRes.status === 'fulfilled') {
        setAnalytics(analyticsRes.value.data);
      }

      if (tweetsRes.status === 'fulfilled') {
        setRecentTweets(tweetsRes.value.data.tweets || []);
      }

      if (creditsRes.status === 'fulfilled') {
        setCreditBalance(creditsRes.value.data);
      }

      if (accountsRes.status === 'fulfilled') {
        setTwitterAccounts(accountsRes.value.data.accounts || []);
      }

    } catch (error) {
      console.error('Dashboard data fetch error:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const stats = [
    {
      name: 'Total Tweets',
      value: analytics?.overview?.total_tweets || 0,
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      name: 'Total Impressions',
      value: analytics?.overview?.total_impressions || 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      name: 'Total Likes',
      value: analytics?.overview?.total_likes || 0,
      icon: Heart,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      name: 'Total Retweets',
      value: analytics?.overview?.total_retweets || 0,
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
    <div className="space-y-8">
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

      {/* Twitter Account Status */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Twitter className="h-8 w-8 text-twitter-500" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Twitter Account</h3>
              <p className="text-sm text-gray-600">
                {twitterAccounts.length > 0 
                  ? `Connected as @${twitterAccounts[0].username}`
                  : 'No Twitter account connected'
                }
              </p>
            </div>
          </div>
          {twitterAccounts.length === 0 && (
            <Link
              to="/settings"
              className="btn btn-primary btn-sm"
            >
              Connect Account
            </Link>
          )}
        </div>
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
  );
};

export default Dashboard;
