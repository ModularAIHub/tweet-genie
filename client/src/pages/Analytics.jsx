import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Heart, 
  Repeat2, 
  MessageCircle,
  RefreshCw,
  Calendar,
  Hash
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { analytics } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const Analytics = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timeframe, setTimeframe] = useState(30);

  useEffect(() => {
    fetchAnalytics();
  }, [timeframe]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await analytics.getOverview({ days: timeframe });
      setAnalyticsData(response.data);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      toast.error('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      await analytics.sync();
      toast.success('Analytics data synced successfully');
      fetchAnalytics();
    } catch (error) {
      console.error('Failed to sync analytics:', error);
      toast.error('Failed to sync analytics data');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const overview = analyticsData?.overview || {};
  const dailyMetrics = analyticsData?.daily_metrics || [];
  const topTweets = analyticsData?.top_tweets || [];

  const stats = [
    {
      name: 'Total Tweets',
      value: overview.total_tweets || 0,
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      name: 'Total Impressions',
      value: overview.total_impressions || 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      name: 'Total Likes',
      value: overview.total_likes || 0,
      icon: Heart,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      name: 'Total Retweets',
      value: overview.total_retweets || 0,
      icon: Repeat2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  // Sample data for charts if no real data
  const sampleDailyData = dailyMetrics.length > 0 ? dailyMetrics : [
    { date: '2024-01-01', tweets_count: 2, impressions: 1200, likes: 45, retweets: 8 },
    { date: '2024-01-02', tweets_count: 1, impressions: 890, likes: 32, retweets: 5 },
    { date: '2024-01-03', tweets_count: 3, impressions: 1567, likes: 78, retweets: 12 },
    { date: '2024-01-04', tweets_count: 2, impressions: 1034, likes: 56, retweets: 9 },
    { date: '2024-01-05', tweets_count: 1, impressions: 743, likes: 28, retweets: 4 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
          <p className="mt-2 text-gray-600">
            Track your social media performance and engagement
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(parseInt(e.target.value))}
            className="input w-auto"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn btn-secondary btn-md"
          >
            {syncing ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync Data
              </>
            )}
          </button>
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Impressions Over Time */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Impressions Over Time
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={sampleDailyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => new Date(value).toLocaleDateString()} 
              />
              <YAxis />
              <Tooltip 
                labelFormatter={(value) => new Date(value).toLocaleDateString()}
                formatter={(value, name) => [value.toLocaleString(), 'Impressions']}
              />
              <Line 
                type="monotone" 
                dataKey="impressions" 
                stroke="#3b82f6" 
                strokeWidth={2}
                dot={{ fill: '#3b82f6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Engagement Over Time */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Engagement Over Time
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sampleDailyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => new Date(value).toLocaleDateString()} 
              />
              <YAxis />
              <Tooltip 
                labelFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <Bar dataKey="likes" fill="#ef4444" name="Likes" />
              <Bar dataKey="retweets" fill="#8b5cf6" name="Retweets" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Performing Tweets */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Top Performing Tweets
          </h3>
          <span className="text-sm text-gray-500">
            Last {timeframe} days
          </span>
        </div>

        {topTweets.length > 0 ? (
          <div className="space-y-4">
            {topTweets.map((tweet, index) => (
              <div key={tweet.id} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        #{index + 1}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(tweet.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-gray-700 mb-3 line-clamp-2">
                      {tweet.content}
                    </p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span className="flex items-center">
                        <TrendingUp className="h-4 w-4 mr-1" />
                        {tweet.impressions?.toLocaleString() || 0}
                      </span>
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
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No tweet performance data available</p>
            <p className="text-sm text-gray-500 mt-2">
              Post some tweets to see analytics here
            </p>
          </div>
        )}
      </div>

      {/* Engagement Rate */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <div className="text-3xl font-bold text-green-600">
            {overview.avg_impressions ? Math.round(overview.avg_impressions) : '--'}
          </div>
          <div className="text-sm text-gray-600 mt-1">Avg. Impressions</div>
        </div>
        
        <div className="card text-center">
          <div className="text-3xl font-bold text-blue-600">
            {overview.avg_likes ? Math.round(overview.avg_likes) : '--'}
          </div>
          <div className="text-sm text-gray-600 mt-1">Avg. Likes</div>
        </div>
        
        <div className="card text-center">
          <div className="text-3xl font-bold text-purple-600">
            {overview.avg_impressions && overview.avg_likes 
              ? `${((overview.avg_likes / overview.avg_impressions) * 100).toFixed(1)}%`
              : '--'
            }
          </div>
          <div className="text-sm text-gray-600 mt-1">Engagement Rate</div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
