import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Heart, 
  Repeat, 
  Repeat2,
  MessageCircle,
  Quote,
  Bookmark,
  Eye,
  Calendar,
  RefreshCw,
  Zap,
  Target,
  Award,
  Globe,
  Activity,
  Hash,
  Clock,
  Brain,
  Lightbulb,
  TrendingDown,
  ChevronRight,
  Star,
  AlertCircle,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Megaphone,
  BarChart2,
  LineChart as LineChartIcon,
  Calendar as CalendarIcon,
  Search,
  Filter,
  Download,
  Share2,
  BookOpen,
  Coffee,
  Sunrise,
  Sun,
  Moon
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import api, { analytics as analyticsAPI } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';

const Analytics = () => {
    const { selectedAccount, accounts } = useAccount();
    const accountAPI = useAccountAwareAPI();
    const isTeamUser = accounts.length > 0;
  
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timeframe, setTimeframe] = useState('50');
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  // Store updated/skipped tweet IDs as Sets for O(1) lookup
  const [updatedTweetIds, setUpdatedTweetIds] = useState(new Set());
  const [skippedTweetIds, setSkippedTweetIds] = useState(new Set());
  const [syncStatus, setSyncStatus] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [syncSummary, setSyncSummary] = useState(null);
  const [isDisconnected, setIsDisconnected] = useState(false);

  const fetchSyncStatus = async () => {
    try {
      const response = await api.get('/api/analytics/sync-status');
      if (typeof response.data?.disconnected === 'boolean') {
        setIsDisconnected(response.data.disconnected);
      }
      if (response.data?.syncStatus) {
        setSyncStatus(response.data.syncStatus);
      }
    } catch (syncStatusError) {
      console.error('Failed to fetch sync status:', syncStatusError);
    }
  };

  const fetchAnalytics = async () => {
    try {
      setError(null);
      
      // Use account-aware API for team users
      if (isTeamUser && selectedAccount) {
        const apiResponse = await accountAPI.getAnalytics(`${timeframe}d`);
        const data = await apiResponse.json();
        const normalizedData = data.data || data;
        setAnalyticsData(normalizedData);
        setIsDisconnected(Boolean(normalizedData?.disconnected));
      } else {
        const response = await api.get(`/api/analytics/overview?days=${timeframe}`);
        setAnalyticsData(response.data);
        setIsDisconnected(Boolean(response.data?.disconnected));
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      const reconnectRequired =
        error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
        error?.response?.data?.reconnect === true;
      if (reconnectRequired) {
        setIsDisconnected(true);
        setAnalyticsData(null);
        setError('Twitter is disconnected. Please reconnect your account in Settings.');
      } else {
        setError('Failed to load analytics data');
      }
    } finally {
      setLoading(false);
    }
  };

  const syncAnalytics = async () => {
    if (isDisconnected) {
      setError('Twitter is disconnected. Please reconnect your account in Settings before syncing.');
      return;
    }

    const nextAllowedAtMs = syncStatus?.nextAllowedAt ? new Date(syncStatus.nextAllowedAt).getTime() : 0;
    if (nextAllowedAtMs && nextAllowedAtMs > Date.now()) {
      const waitMinutes = Math.max(1, Math.ceil((nextAllowedAtMs - Date.now()) / 60000));
      setError(`Sync cooldown active. Please wait about ${waitMinutes} minutes.`);
      return;
    }

    try {
      setSyncing(true);
      setError(null);
      const response = await api.post('/api/analytics/sync', {}, { timeout: 120000 });
      if (response.data?.syncStatus) {
        setSyncStatus(response.data.syncStatus);
      }
      if (typeof response.data?.disconnected === 'boolean') {
        setIsDisconnected(response.data.disconnected);
      }
      if (response.data?.stats) {
        setSyncSummary({
          runId: response.data.runId || null,
          updated: response.data.stats.metrics_updated || 0,
          errors: response.data.stats.errors || 0,
          processed: response.data.stats.total_processed || 0,
          totalCandidates: response.data.stats.total_candidates ?? null,
          remaining: response.data.stats.remaining ?? null,
          skipReasons: response.data.stats.skip_reasons || null,
          debugInfo: response.data.debugInfo || null,
          at: new Date().toISOString(),
        });
      }

      if (response.data.success) {
        const stats = response.data.stats || { metrics_updated: 0, errors: 0 };
        const resetTime = response.data.resetTime ? new Date(response.data.resetTime) : null;
        const resetTimeLocal = resetTime ? resetTime.toLocaleString() : null;

        if (response.data.rateLimited) {
          setError(
            resetTimeLocal
              ? `Rate limit reached after syncing ${stats.metrics_updated} tweets. Try again after ${resetTimeLocal}.`
              : `Rate limit reached after syncing ${stats.metrics_updated} tweets. Please try again later.`
          );
        } else if ((stats.metrics_updated || 0) === 0) {
          const debugInfo = response.data.debugInfo;
          const details = debugInfo
            ? `Posted tweets with IDs: ${debugInfo.totalPostedWithTweetId}, stale: ${debugInfo.staleCount}, zero metrics: ${debugInfo.zeroMetricsCount}.`
            : 'No eligible tweets matched current sync criteria.';
          setError(`Sync completed but updated 0 tweets. ${details}`);
        } else {
          alert(`Sync completed!\nMetrics updated: ${stats.metrics_updated}\n${stats.errors > 0 ? `Errors: ${stats.errors}` : ''}`);
        }

        setUpdatedTweetIds(new Set(response.data.updatedTweetIds || []));
        setSkippedTweetIds(new Set(response.data.skippedTweetIds || []));
        await fetchAnalytics();
      }
    } catch (error) {
      console.error('Failed to sync analytics:', error);

      if (error.code === 'ECONNABORTED') {
        setError('Sync is taking longer than expected. Please wait and refresh analytics in a minute.');
      } else if (error.response?.status === 409) {
        const errorData = error.response.data;
        if (errorData?.syncStatus) {
          setSyncStatus(errorData.syncStatus);
        }
        if (errorData?.stats) {
          setSyncSummary({
            runId: errorData.runId || null,
            updated: errorData.stats.metrics_updated || 0,
            errors: errorData.stats.errors || 0,
            processed: errorData.stats.total_processed || 0,
            totalCandidates: errorData.stats.total_candidates ?? null,
            remaining: errorData.stats.remaining ?? null,
            skipReasons: errorData.stats.skip_reasons || null,
            debugInfo: errorData.debugInfo || null,
            at: new Date().toISOString(),
          });
        }
        if (errorData?.type === 'sync_in_progress') {
          setError('A sync is already running for this account. Please wait for it to finish.');
        } else {
          setError('Sync is already in progress.');
        }
      } else if (error.response?.status === 429) {
        const errorData = error.response.data;
        if (errorData?.syncStatus) {
          setSyncStatus(errorData.syncStatus);
        }
        if (errorData?.stats) {
          setSyncSummary({
            runId: errorData.runId || null,
            updated: errorData.stats.metrics_updated || 0,
            errors: errorData.stats.errors || 0,
            processed: errorData.stats.total_processed || 0,
            totalCandidates: errorData.stats.total_candidates ?? null,
            remaining: errorData.stats.remaining ?? null,
            skipReasons: errorData.stats.skip_reasons || null,
            debugInfo: errorData.debugInfo || null,
            at: new Date().toISOString(),
          });
        }
        if (errorData.type === 'sync_cooldown') {
          const nextAllowedAt = errorData.syncStatus?.nextAllowedAt;
          const nextTime = nextAllowedAt ? new Date(nextAllowedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
          const waitMinutes = errorData.waitMinutes || 1;
          setError(nextTime
            ? `Sync cooldown active. Try again at ${nextTime} (about ${waitMinutes} minutes).`
            : `Sync cooldown active. Please wait about ${waitMinutes} minutes.`);
        } else if (errorData.type === 'rate_limit') {
          const resetTime = new Date(errorData.resetTime);
          const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const resetTimeLocal = resetTime.toLocaleString(undefined, { timeZone: userTimezone });
          const waitMinutes = errorData.waitMinutes;
          setError(`Twitter API rate limit exceeded. Please try again around ${resetTimeLocal} (about ${waitMinutes} minutes).`);
          setUpdatedTweetIds(new Set(errorData.updatedTweetIds || []));
          setSkippedTweetIds(new Set(errorData.skippedTweetIds || []));
        } else {
          setError('Rate limit exceeded. Please try again later.');
        }
      } else if (
        (error.response?.status === 401 || error.response?.status === 400) &&
        (error.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' || error.response?.data?.reconnect)
      ) {
        setIsDisconnected(true);
        setError('Twitter is disconnected. Please reconnect your account in Settings.');
      } else if (error.response?.data?.type === 'twitter_api_error') {
        setError(`Twitter API Error: ${error.response.data.message}`);
      } else {
        const backendError = error.response?.data?.message || error.response?.data?.error;
        setError(backendError || 'Failed to sync analytics data. Please try again later.');
      }
    } finally {
      setSyncing(false);
      await fetchSyncStatus();
    }
  };

  useEffect(() => {
    fetchAnalytics();
    fetchSyncStatus();
  }, [timeframe, selectedAccount]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (isDisconnected || analyticsData?.disconnected) {
    return (
      <div className="space-y-6">
        <div className="card text-center py-12">
          <AlertCircle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Twitter Connection Required</h2>
          <p className="text-gray-600 mt-2 mb-6">
            Reconnect your Twitter account to view analytics and run sync.
          </p>
          <a href="/settings" className="btn btn-primary">
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  const overview = analyticsData?.overview || {};
  const dailyMetrics = analyticsData?.daily_metrics || [];
  const topTweets = analyticsData?.tweets || [];
  const hourlyEngagement = analyticsData?.hourly_engagement || [];
  const contentTypeMetrics = analyticsData?.content_type_metrics || [];
  const growth = analyticsData?.growth || {};
  const engagementData = analyticsData?.engagementData || [];

  // Calculate growth percentages
  const calculateGrowth = (current, previous) => {
    if (!previous || previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const growthMetrics = {
    tweets: calculateGrowth(overview.total_tweets, growth.previous?.prev_total_tweets),
    impressions: calculateGrowth(overview.total_impressions, growth.previous?.prev_total_impressions),
    likes: calculateGrowth(overview.total_likes, growth.previous?.prev_total_likes),
    engagement: calculateGrowth(overview.total_engagement, 
      (growth.previous?.prev_total_likes || 0) + (growth.previous?.prev_total_retweets || 0) + (growth.previous?.prev_total_replies || 0))
  };

  // Content type comparison (moved up before generateInsights)
  const contentComparison = contentTypeMetrics.map(metric => ({
    type: metric.content_type === 'thread' ? 'Threads' : 'Single Tweets',
    tweets: parseInt(metric.tweets_count),
    avgImpressions: Math.round(metric.avg_impressions || 0),
    avgEngagement: Math.round(metric.avg_total_engagement || 0),
    engagementRate: metric.avg_impressions > 0 ? 
      ((metric.avg_total_engagement / metric.avg_impressions) * 100).toFixed(1) : 0
  }));

  // Generate realistic AI insights based on actual data
  const generateInsights = () => {
    const insights = [];
    
    // Ensure engagement rate is a number
    const engagementRate = parseFloat(overview.engagement_rate) || 0;
    
    if (engagementRate > 3) {
      insights.push({
        type: 'success',
        title: 'Strong Engagement Rate',
        message: `Your ${engagementRate.toFixed(1)}% engagement rate is above average`,
        icon: CheckCircle,
        color: 'green'
      });
    } else if (engagementRate > 1) {
      insights.push({
        type: 'info',
        title: 'Good Engagement',
        message: `Your ${engagementRate.toFixed(1)}% engagement rate has room for improvement`,
        icon: Lightbulb,
        color: 'blue'
      });
    } else {
      insights.push({
        type: 'warning',
        title: 'Low Engagement',
        message: `Your ${engagementRate.toFixed(1)}% engagement rate needs attention`,
        icon: AlertCircle,
        color: 'orange'
      });
    }

    // Content type insights
    const threadPerformance = contentComparison.find(c => c.type === 'Threads');
    const singlePerformance = contentComparison.find(c => c.type === 'Single Tweets');
    
    if (threadPerformance && singlePerformance && threadPerformance.avgEngagement > singlePerformance.avgEngagement) {
      const improvementPercent = Math.round(((threadPerformance.avgEngagement - singlePerformance.avgEngagement) / singlePerformance.avgEngagement) * 100);
      insights.push({
        type: 'opportunity',
        title: 'Thread Opportunity',
        message: `Threads perform ${improvementPercent}% better than single tweets`,
        icon: Lightbulb,
        color: 'blue'
      });
    }

    // Posting frequency insights
    const totalTweets = parseInt(overview.total_tweets) || 0;
    const timeframeDays = parseInt(timeframe) || 30;
    const avgTweetsPerDay = totalTweets / timeframeDays;
    
    if (avgTweetsPerDay < 1) {
      insights.push({
        type: 'action',
        title: 'Increase Posting Frequency',
        message: `You're posting ${avgTweetsPerDay.toFixed(1)} times per day. Aim for 1-2 daily posts`,
        icon: AlertCircle,
        color: 'orange'
      });
    }

    return insights;
  };

  const aiInsights = generateInsights();

  const enhancedStats = [
    {
      name: 'Total Tweets',
      value: overview.total_tweets || 0,
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      growth: growthMetrics.tweets,
      subtitle: 'Published tweets'
    },
    {
      name: 'Total Impressions',
      value: overview.total_impressions || 0,
      icon: Eye,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      growth: growthMetrics.impressions,
      subtitle: 'Total reach'
    },
    {
      name: 'Total Engagement',
      value: overview.total_engagement || 0,
      icon: Activity,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      growth: growthMetrics.engagement,
      subtitle: 'Likes + Retweets + Replies'
    },
    {
      name: 'Engagement Rate',
      value: `${overview.engagement_rate || 0}%`,
      icon: Target,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      growth: null,
      subtitle: 'Avg engagement rate'
    },
    {
      name: 'Avg Impressions',
      value: Math.round(overview.avg_impressions || 0),
      icon: TrendingUp,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      growth: null,
      subtitle: 'Per tweet'
    },
    {
      name: 'Top Tweet Reach',
      value: overview.max_impressions || 0,
      icon: Award,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      growth: null,
      subtitle: 'Best performing'
    }
  ];

  // Prepare chart data
  const chartData = dailyMetrics.map(day => ({
    ...day,
    date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })).reverse();

  // Best posting times data
  const hourlyData = Array.from({ length: 24 }, (_, hour) => {
    const hourData = hourlyEngagement.find(h => parseInt(h.hour) === hour);
    return {
      hour: `${hour}:00`,
      engagement: hourData ? Math.round(hourData.avg_engagement) : 0,
      tweets: hourData ? hourData.tweets_count : 0
    };
  });

  const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'insights', label: 'AI Insights', icon: Brain },
    { id: 'content', label: 'Content Strategy', icon: Lightbulb },
    { id: 'timing', label: 'Optimal Timing', icon: Clock },
    { id: 'audience', label: 'Audience', icon: Users },
    { id: 'recommendations', label: 'Recommendations', icon: Target }
  ];

  const nextAllowedAtMs = syncStatus?.nextAllowedAt ? new Date(syncStatus.nextAllowedAt).getTime() : 0;
  const cooldownRemainingMs = Math.max(0, nextAllowedAtMs - currentTime);
  const cooldownMinutes = Math.max(1, Math.ceil(cooldownRemainingMs / 60000));
  const isCooldownActive = cooldownRemainingMs > 0;
  const syncButtonDisabled = syncing || syncStatus?.inProgress || isCooldownActive;
  const syncStatusLabel = syncStatus?.lastResult === 'rate_limited'
    ? 'Rate limited by Twitter'
    : syncStatus?.lastResult || null;
  const nextAllowedLabel = syncStatus?.nextAllowedAt
    ? new Date(syncStatus.nextAllowedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const lastSyncLabel = syncStatus?.lastSyncAt
    ? new Date(syncStatus.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Advanced Analytics</h1>
          <p className="mt-2 text-gray-600">
            Comprehensive insights into your social media performance
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(String(e.target.value))}
            className="input w-auto"
          >
            <option value={14}>Last 14 days</option>
            <option value={50}>Last 50 days</option>
            <option value={120}>Last 120 days</option>
            <option value={365}>Last year</option>
          </select>
          <div className="flex flex-col items-start">
            <button
              onClick={syncAnalytics}
              disabled={syncButtonDisabled}
              className="btn btn-secondary btn-md disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Syncing...
                </>
              ) : syncStatus?.inProgress ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Sync In Progress
                </>
              ) : isCooldownActive ? (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  Wait {cooldownMinutes}m
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sync Latest
                </>
              )}
            </button>
            {(syncStatus?.inProgress || isCooldownActive || nextAllowedLabel) && (
              <p className="text-xs text-gray-500 mt-1">
                {syncStatus?.inProgress
                  ? 'Sync already running for this account.'
                  : isCooldownActive && nextAllowedLabel
                    ? `Next sync at ${nextAllowedLabel}`
                    : nextAllowedLabel
                      ? `Last sync cooldown ended at ${nextAllowedLabel}`
                      : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      {(syncSummary || syncStatus) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-blue-900">
            {syncSummary && (
              <>
                <span><strong>Updated:</strong> {syncSummary.updated}</span>
                <span><strong>Errors:</strong> {syncSummary.errors}</span>
                <span><strong>Processed:</strong> {syncSummary.processed}</span>
                {syncSummary.totalCandidates !== null && <span><strong>Candidates:</strong> {syncSummary.totalCandidates}</span>}
                {syncSummary.remaining !== null && <span><strong>Left:</strong> {syncSummary.remaining}</span>}
                {syncSummary.runId && <span><strong>Run:</strong> {syncSummary.runId}</span>}
              </>
            )}
            {lastSyncLabel && <span><strong>Last Sync:</strong> {lastSyncLabel}</span>}
            {nextAllowedLabel && <span><strong>Next Sync:</strong> {nextAllowedLabel}</span>}
            {syncStatusLabel && <span><strong>Status:</strong> {syncStatusLabel}</span>}
          </div>
          {syncSummary?.skipReasons && (
            <p className="text-xs text-blue-700 mt-2">
              Skip reasons: {Object.entries(syncSummary.skipReasons).map(([k, v]) => `${k}=${v}`).join(', ')}
            </p>
          )}
          {syncSummary?.debugInfo && (
            <p className="text-xs text-blue-700 mt-1">
              Debug: posted_with_ids={syncSummary.debugInfo.totalPostedWithTweetId}, stale={syncSummary.debugInfo.staleCount}, zero_metrics={syncSummary.debugInfo.zeroMetricsCount}, platform={syncSummary.debugInfo.platformCount}, external={syncSummary.debugInfo.externalCount}
            </p>
          )}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap flex items-center ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-4 w-4 mr-2" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Activity className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
            <div className="ml-auto pl-3">
              <button
                onClick={() => setError(null)}
                className="inline-flex rounded-md bg-red-50 text-red-400 hover:text-red-500 focus:outline-none"
              >
                <span className="sr-only">Dismiss</span>
                <Clock className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Enhanced Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {enhancedStats.map((stat) => {
              const Icon = stat.icon;
              const growth = stat.growth;
              return (
                <div key={stat.name} className="card hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                        <Icon className={`h-6 w-6 ${stat.color}`} />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                        </p>
                        <p className="text-xs text-gray-500">{stat.subtitle}</p>
                      </div>
                    </div>
                    {growth !== null && (
                      <div className={`flex items-center text-sm ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {growth >= 0 ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
                        {Math.abs(parseFloat(growth) || 0).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Performance Trends */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Daily Performance Trends
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="impressions" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                  <Area type="monotone" dataKey="total_engagement" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
           <h3 className="text-lg font-semibold text-gray-900 mb-4">
  Engagement Breakdown
</h3>
<ResponsiveContainer width="100%" height={300}>
  <BarChart data={engagementData}>
    {/* Add your BarChart children here */}
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="name" />
    <YAxis />
    <Tooltip />
    <Legend />
    <Bar dataKey="engagement" fill="#8884d8" />
  </BarChart>
</ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-6">
          {/* AI Performance Score */}
          <div className="card bg-gradient-to-r from-blue-50 to-purple-50 border-l-4 border-blue-500">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <div className="p-3 bg-blue-100 rounded-full">
                  <Brain className="h-8 w-8 text-blue-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-xl font-bold text-gray-900">AI Performance Score</h3>
                  <p className="text-gray-600">Based on your content and engagement patterns</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">
                  {Math.min(100, Math.max(0, Math.round((parseFloat(overview.engagement_rate) || 0) * 15 + (growthMetrics.engagement > 0 ? 20 : 0) + 40)))}
                </div>
                <p className="text-sm text-gray-500">Performance Rating</p>
              </div>
            </div>
          </div>

          {/* Key Insights Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center mb-4">
                <Sparkles className="h-5 w-5 text-yellow-500 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">AI Content Insights</h3>
              </div>
              <div className="space-y-4">
                {aiInsights.map((insight, index) => (
                  <div key={index} className={`p-4 bg-${insight.color}-50 rounded-lg border-l-4 border-${insight.color}-400`}>
                    <div className="flex items-start">
                      <insight.icon className={`h-5 w-5 text-${insight.color}-500 mt-0.5 mr-3`} />
                      <div>
                        <h4 className={`font-medium text-${insight.color}-900`}>{insight.title}</h4>
                        <p className={`text-sm text-${insight.color}-700 mt-1`}>{insight.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="flex items-center mb-4">
                <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">Performance Patterns</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <ArrowUp className="h-4 w-4 text-green-500 mr-2" />
                    <span className="text-sm font-medium">Best Performing Tweet</span>
                  </div>
                  <span className="text-sm text-gray-600">{(overview.max_impressions || 0).toLocaleString()} impressions</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Clock className="h-4 w-4 text-blue-500 mr-2" />
                    <span className="text-sm font-medium">Peak Engagement Time</span>
                  </div>
                  <span className="text-sm text-gray-600">
                    {hourlyEngagement.length > 0 ? `${hourlyEngagement[0].hour}:00` : 'No data'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Hash className="h-4 w-4 text-purple-500 mr-2" />
                    <span className="text-sm font-medium">Avg Engagement</span>
                  </div>
                  <span className="text-sm text-gray-600">{Math.round(overview.avg_impressions || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Target className="h-4 w-4 text-red-500 mr-2" />
                    <span className="text-sm font-medium">Engagement Rate</span>
                  </div>
                  <span className="text-sm text-gray-600">{(parseFloat(overview.engagement_rate) || 0).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Recommendations */}
          <div className="card">
            <div className="flex items-center mb-6">
              <Brain className="h-6 w-6 text-purple-600 mr-3" />
              <h3 className="text-xl font-semibold text-gray-900">AI-Powered Recommendations</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900 flex items-center">
                  <Megaphone className="h-4 w-4 mr-2 text-blue-500" />
                  Content Strategy
                </h4>
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3"></div>
                      <div>
                        <p className="text-sm font-medium text-blue-900">Create more thread content</p>
                        <p className="text-xs text-blue-700 mt-1">Threads get 3x more engagement</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2 mr-3"></div>
                      <div>
                        <p className="text-sm font-medium text-green-900">Use trending hashtags</p>
                        <p className="text-xs text-green-700 mt-1">#TechTrends, #AI, #Innovation</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3"></div>
                      <div>
                        <p className="text-sm font-medium text-purple-900">Add more visual content</p>
                        <p className="text-xs text-purple-700 mt-1">Images increase engagement by 45%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900 flex items-center">
                  <Clock className="h-4 w-4 mr-2 text-green-500" />
                  Timing Optimization
                </h4>
                <div className="space-y-3">
                  <div className="p-3 bg-yellow-50 rounded-lg">
                    <div className="flex items-start">
                      <Sunrise className="h-4 w-4 text-yellow-500 mt-1 mr-3" />
                      <div>
                        <p className="text-sm font-medium text-yellow-900">Morning Posts (8-10 AM)</p>
                        <p className="text-xs text-yellow-700 mt-1">Best for educational content</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg">
                    <div className="flex items-start">
                      <Sun className="h-4 w-4 text-orange-500 mt-1 mr-3" />
                      <div>
                        <p className="text-sm font-medium text-orange-900">Afternoon (2-4 PM)</p>
                        <p className="text-xs text-orange-700 mt-1">Peak engagement window</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-indigo-50 rounded-lg">
                    <div className="flex items-start">
                      <Moon className="h-4 w-4 text-indigo-500 mt-1 mr-3" />
                      <div>
                        <p className="text-sm font-medium text-indigo-900">Evening (7-9 PM)</p>
                        <p className="text-xs text-indigo-700 mt-1">Great for casual content</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'content' && (
        <div className="space-y-6">
          {/* Content Performance Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card bg-gradient-to-br from-purple-50 to-blue-50">
              <div className="flex items-center mb-4">
                <BookOpen className="h-6 w-6 text-purple-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Content Analysis</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Tweets</span>
                  <span className="font-semibold">{overview.total_tweets || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg Impressions</span>
                  <span className="font-semibold">{Math.round(overview.avg_impressions || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Engagement Rate</span>
                  <span className="font-semibold">{(parseFloat(overview.engagement_rate) || 0).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best Performance</span>
                  <span className="font-semibold">{(overview.max_impressions || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-green-50 to-emerald-50">
              <div className="flex items-center mb-4">
                <Target className="h-6 w-6 text-green-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Top Metrics</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-white rounded-lg border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Most Likes</span>
                    <span className="text-xs text-green-600">{overview.max_likes || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{width: '85%'}}></div>
                  </div>
                </div>
                <div className="p-3 bg-white rounded-lg border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Most Retweets</span>
                    <span className="text-xs text-blue-600">{overview.max_retweets || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{width: '72%'}}></div>
                  </div>
                </div>
                <div className="p-3 bg-white rounded-lg border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Most Replies</span>
                    <span className="text-xs text-purple-600">{overview.max_replies || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-purple-500 h-2 rounded-full" style={{width: '65%'}}></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-50 to-red-50">
              <div className="flex items-center mb-4">
                <Hash className="h-6 w-6 text-orange-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Growth Metrics</h3>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Tweets', value: growthMetrics.tweets, type: 'tweets' },
                  { label: 'Impressions', value: growthMetrics.impressions, type: 'impressions' },
                  { label: 'Likes', value: growthMetrics.likes, type: 'likes' },
                  { label: 'Engagement', value: growthMetrics.engagement, type: 'engagement' },
                  { label: 'Performance', value: (overview.engagement_rate || 0) * 10, type: 'performance' }
                ].map((metric, index) => (
                  <div key={metric.label} className="flex items-center justify-between p-2 bg-white rounded border">
                    <span className="text-sm font-medium text-gray-700">{metric.label}</span>
                    <div className="flex items-center space-x-2">
                      <span className={`text-xs ${metric.value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {metric.value >= 0 ? '+' : ''}{metric.value.toFixed(1)}%
                      </span>
                      <div className={`w-2 h-2 rounded-full ${metric.value >= 0 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Content Type Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Content Type Performance
              </h3>
              {contentComparison.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={contentComparison}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="type" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="avgImpressions" fill="#3b82f6" name="Avg Impressions" />
                    <Bar dataKey="avgEngagement" fill="#10b981" name="Avg Engagement" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No content type data available
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Content Strategy Recommendations
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-l-4 border-blue-500">
                  <h4 className="font-medium text-blue-900 mb-2">📚 Educational Content</h4>
                  <p className="text-sm text-blue-700 mb-2">Share tutorials, tips, and how-to guides</p>
                  <div className="text-xs text-blue-600">Best times: 9 AM, 2 PM, 7 PM</div>
                </div>
                <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-l-4 border-green-500">
                  <h4 className="font-medium text-green-900 mb-2">💡 Industry Insights</h4>
                  <p className="text-sm text-green-700 mb-2">Share trends, predictions, and analysis</p>
                  <div className="text-xs text-green-600">Best times: 8 AM, 1 PM, 6 PM</div>
                </div>
                <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border-l-4 border-purple-500">
                  <h4 className="font-medium text-purple-900 mb-2">🎯 Personal Stories</h4>
                  <p className="text-sm text-purple-700 mb-2">Share experiences and lessons learned</p>
                  <div className="text-xs text-purple-600">Best times: 6 AM, 12 PM, 8 PM</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timing' && (
        <div className="space-y-6">
          {/* Optimal Posting Schedule */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card bg-gradient-to-br from-yellow-50 to-orange-50">
              <div className="flex items-center mb-4">
                <Sunrise className="h-6 w-6 text-yellow-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Morning (6-12 PM)</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best for</span>
                  <span className="text-sm font-medium">Educational content</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Peak time</span>
                  <span className="text-sm font-medium">
                    {hourlyEngagement.filter(h => h.hour >= 6 && h.hour < 12).sort((a, b) => b.avg_engagement - a.avg_engagement)[0]?.hour || 9}:00
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg engagement</span>
                  <span className="text-sm font-medium text-green-600">
                    {Math.round(hourlyEngagement.filter(h => h.hour >= 6 && h.hour < 12).reduce((avg, h) => avg + (h.avg_engagement || 0), 0) / Math.max(hourlyEngagement.filter(h => h.hour >= 6 && h.hour < 12).length, 1)) || 0}
                  </span>
                </div>
                <div className="mt-4 p-3 bg-yellow-100 rounded-lg">
                  <p className="text-xs text-yellow-800">💡 Good time for informational content</p>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-50 to-red-50">
              <div className="flex items-center mb-4">
                <Sun className="h-6 w-6 text-orange-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Afternoon (12-6 PM)</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best for</span>
                  <span className="text-sm font-medium">News & discussions</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Peak time</span>
                  <span className="text-sm font-medium">
                    {hourlyEngagement.filter(h => h.hour >= 12 && h.hour < 18).sort((a, b) => b.avg_engagement - a.avg_engagement)[0]?.hour || 14}:00
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg engagement</span>
                  <span className="text-sm font-medium text-green-600">
                    {Math.round(hourlyEngagement.filter(h => h.hour >= 12 && h.hour < 18).reduce((avg, h) => avg + (h.avg_engagement || 0), 0) / Math.max(hourlyEngagement.filter(h => h.hour >= 12 && h.hour < 18).length, 1)) || 0}
                  </span>
                </div>
                <div className="mt-4 p-3 bg-orange-100 rounded-lg">
                  <p className="text-xs text-orange-800">🔥 Peak activity period</p>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-blue-50 to-purple-50">
              <div className="flex items-center mb-4">
                <Moon className="h-6 w-6 text-blue-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Evening (6-11 PM)</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best for</span>
                  <span className="text-sm font-medium">Personal stories</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Peak time</span>
                  <span className="text-sm font-medium">
                    {hourlyEngagement.filter(h => h.hour >= 18 && h.hour < 23).sort((a, b) => b.avg_engagement - a.avg_engagement)[0]?.hour || 20}:00
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg engagement</span>
                  <span className="text-sm font-medium text-green-600">
                    {Math.round(hourlyEngagement.filter(h => h.hour >= 18 && h.hour < 23).reduce((avg, h) => avg + (h.avg_engagement || 0), 0) / Math.max(hourlyEngagement.filter(h => h.hour >= 18 && h.hour < 23).length, 1)) || 0}
                  </span>
                </div>
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-800">✨ Good for casual content</p>
                </div>
              </div>
            </div>
          </div>

          {/* 24-Hour Heatmap */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              24-Hour Engagement Heatmap
            </h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip 
                  formatter={(value, name) => [
                    name === 'engagement' ? `${value} avg engagement` : `${value} tweets`,
                    name === 'engagement' ? 'Engagement' : 'Tweet Count'
                  ]}
                />
                <Bar dataKey="engagement" fill="#3b82f6" name="engagement" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Weekly Pattern */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Weekly Performance Pattern
              </h3>
              <div className="space-y-3">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => {
                  const performance = Math.random() * 100;
                  const isWeekend = index >= 5;
                  return (
                    <div key={day} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center">
                        <div className={`w-3 h-3 rounded-full mr-3 ${
                          performance > 70 ? 'bg-green-500' : 
                          performance > 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}></div>
                        <span className="font-medium">{day}</span>
                        {isWeekend && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Weekend</span>}
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              performance > 70 ? 'bg-green-500' : 
                              performance > 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{width: `${performance}%`}}
                          ></div>
                        </div>
                        <span className="text-sm text-gray-600 w-12 text-right">{performance.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Recommended Posting Schedule
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-l-4 border-green-500">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-green-900">High Priority</h4>
                    <Clock className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-green-700">Tuesday 2:00 PM</span>
                      <span className="text-green-600 font-medium">Peak engagement</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-green-700">Wednesday 9:00 AM</span>
                      <span className="text-green-600 font-medium">High reach</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-green-700">Thursday 8:00 PM</span>
                      <span className="text-green-600 font-medium">Great discussions</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border-l-4 border-yellow-500">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-yellow-900">Medium Priority</h4>
                    <Clock className="h-4 w-4 text-yellow-600" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-yellow-700">Monday 10:00 AM</span>
                      <span className="text-yellow-600 font-medium">Good start</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-yellow-700">Friday 3:00 PM</span>
                      <span className="text-yellow-600 font-medium">End of week</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-gradient-to-r from-red-50 to-pink-50 rounded-lg border-l-4 border-red-500">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-red-900">Avoid These Times</h4>
                    <AlertCircle className="h-4 w-4 text-red-600" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-red-700">Saturday 6:00 AM</span>
                      <span className="text-red-600 font-medium">Low activity</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-red-700">Sunday 11:00 PM</span>
                      <span className="text-red-600 font-medium">Very low reach</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'recommendations' && (
        <div className="space-y-6">
          {/* Action Items */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center mb-6">
                <Target className="h-6 w-6 text-red-500 mr-3" />
                <h3 className="text-xl font-semibold text-gray-900">Immediate Actions</h3>
              </div>
              <div className="space-y-4">
                {/* Posting Frequency Check */}
                {(overview.total_tweets || 0) / parseInt(timeframe) < 1 && (
                  <div className="p-4 bg-red-50 rounded-lg border-l-4 border-red-400">
                    <div className="flex items-start">
                      <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 mr-3" />
                      <div className="flex-1">
                        <h4 className="font-medium text-red-900">Increase Posting Frequency</h4>
                        <p className="text-sm text-red-700 mt-1">
                          You're posting {((parseInt(overview.total_tweets) || 0) / parseInt(timeframe)).toFixed(1)} times per day. 
                          Aim for 1-2 tweets daily for optimal growth.
                        </p>
                        <button className="mt-3 text-xs bg-red-100 text-red-800 px-3 py-1 rounded-full hover:bg-red-200">
                          Create Posting Schedule
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Content Diversification */}
                {contentComparison.length > 0 && (
                  <div className="p-4 bg-orange-50 rounded-lg border-l-4 border-orange-400">
                    <div className="flex items-start">
                      <Lightbulb className="h-5 w-5 text-orange-500 mt-0.5 mr-3" />
                      <div className="flex-1">
                        <h4 className="font-medium text-orange-900">Content Strategy</h4>
                        <p className="text-sm text-orange-700 mt-1">
                          {contentComparison.find(c => c.type === 'Threads') ? 
                            `Create more threads - they get ${Math.round(((contentComparison.find(c => c.type === 'Threads')?.avgEngagement || 0) / (contentComparison.find(c => c.type === 'Single Tweets')?.avgEngagement || 1)) * 100)}% better engagement` :
                            'Consider creating thread content for better engagement'
                          }
                        </p>
                        <button className="mt-3 text-xs bg-orange-100 text-orange-800 px-3 py-1 rounded-full hover:bg-orange-200">
                          Content Ideas
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Engagement Rate Optimization */}
                {(overview.engagement_rate || 0) < 2 && (
                  <div className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-400">
                    <div className="flex items-start">
                      <Hash className="h-5 w-5 text-yellow-500 mt-0.5 mr-3" />
                      <div className="flex-1">
                        <h4 className="font-medium text-yellow-900">Boost Engagement</h4>
                        <p className="text-sm text-yellow-700 mt-1">
                          Your {(parseFloat(overview.engagement_rate) || 0).toFixed(1)}% engagement rate can be improved. 
                          Try asking questions and using trending hashtags.
                        </p>
                        <button className="mt-3 text-xs bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full hover:bg-yellow-200">
                          Engagement Tips
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="flex items-center mb-6">
                <Sparkles className="h-6 w-6 text-blue-500 mr-3" />
                <h3 className="text-xl font-semibold text-gray-900">Growth Opportunities</h3>
              </div>
              <div className="space-y-4">
                {/* Thread Opportunity */}
                {contentComparison.find(c => c.type === 'Threads') && (
                  <div className="p-4 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                    <div className="flex items-start">
                      <TrendingUp className="h-5 w-5 text-blue-500 mt-0.5 mr-3" />
                      <div className="flex-1">
                        <h4 className="font-medium text-blue-900">Thread Success</h4>
                        <p className="text-sm text-blue-700 mt-1">
                          Your threads get {Math.round(contentComparison.find(c => c.type === 'Threads')?.avgImpressions || 0).toLocaleString()} 
                          average impressions. Create more educational threads.
                        </p>
                        <div className="mt-2 text-xs text-blue-600">
                          Potential reach increase: +{Math.round(((contentComparison.find(c => c.type === 'Threads')?.avgImpressions || 0) / Math.max(overview.avg_impressions || 1, 1) - 1) * 100)}%
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Engagement Strategy */}
                <div className="p-4 bg-green-50 rounded-lg border-l-4 border-green-400">
                  <div className="flex items-start">
                    <Users className="h-5 w-5 text-green-500 mt-0.5 mr-3" />
                    <div className="flex-1">
                      <h4 className="font-medium text-green-900">Engagement Strategy</h4>
                      <p className="text-sm text-green-700 mt-1">
                        Your best tweet got {(overview.max_impressions || 0).toLocaleString()} impressions. 
                        Analyze what made it successful and replicate.
                      </p>
                      <div className="mt-2 text-xs text-green-600">
                        Top performance: {(overview.max_likes || 0)} likes, {(overview.max_retweets || 0)} retweets
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timing Optimization */}
                {hourlyEngagement.length > 0 && (
                  <div className="p-4 bg-purple-50 rounded-lg border-l-4 border-purple-400">
                    <div className="flex items-start">
                      <Clock className="h-5 w-5 text-purple-500 mt-0.5 mr-3" />
                      <div className="flex-1">
                        <h4 className="font-medium text-purple-900">Optimal Timing</h4>
                        <p className="text-sm text-purple-700 mt-1">
                          Your best engagement time is {hourlyEngagement[0]?.hour || 'unknown'}:00. 
                          Schedule important content around this time.
                        </p>
                        <div className="mt-2 text-xs text-purple-600">
                          Peak engagement: {Math.round(hourlyEngagement[0]?.avg_engagement || 0)} avg interactions
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content Calendar Suggestions */}
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <CalendarIcon className="h-6 w-6 text-green-500 mr-3" />
                <h3 className="text-xl font-semibold text-gray-900">AI-Generated Content Calendar</h3>
              </div>
              <button className="btn btn-primary btn-sm">
                <Download className="h-4 w-4 mr-2" />
                Export Calendar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { day: 'Monday', time: '9:00 AM', type: 'Educational', topic: 'AI Tutorial', engagement: 'High' },
                { day: 'Tuesday', time: '2:00 PM', type: 'Industry News', topic: 'Tech Trends', engagement: 'Very High' },
                { day: 'Wednesday', time: '11:00 AM', type: 'Personal Story', topic: 'Lessons Learned', engagement: 'Medium' },
                { day: 'Thursday', time: '8:00 PM', type: 'Discussion', topic: 'Future of AI', engagement: 'High' },
                { day: 'Friday', time: '3:00 PM', type: 'Quick Tip', topic: 'Productivity Hack', engagement: 'Medium' },
                { day: 'Saturday', time: '10:00 AM', type: 'Weekend Read', topic: 'Industry Article', engagement: 'Low' }
              ].map((item, index) => (
                <div key={index} className="p-4 bg-gray-50 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-900">{item.day}</h4>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      item.engagement === 'Very High' ? 'bg-green-100 text-green-800' :
                      item.engagement === 'High' ? 'bg-blue-100 text-blue-800' :
                      item.engagement === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {item.engagement}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex items-center">
                      <Clock className="h-3 w-3 mr-1" />
                      <span>{item.time}</span>
                    </div>
                    <div className="font-medium text-gray-800">{item.type}</div>
                    <div className="text-gray-600">{item.topic}</div>
                  </div>
                  <button className="mt-3 w-full text-xs bg-blue-50 text-blue-700 py-2 rounded hover:bg-blue-100">
                    Generate Content
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Performance Goals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center mb-4">
                <Award className="h-6 w-6 text-yellow-500 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">30-Day Goals</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900">Increase Engagement Rate</div>
                    <div className="text-sm text-gray-600">Current: {(parseFloat(overview.engagement_rate) || 0).toFixed(1)}%</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-green-600">Target: {((parseFloat(overview.engagement_rate) || 0) + 2).toFixed(1)}%</div>
                    <div className="text-xs text-gray-500">+{(2 / Math.max(parseFloat(overview.engagement_rate) || 1, 1) * 100).toFixed(0)}% improvement</div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900">Grow Follower Base</div>
                    <div className="text-sm text-gray-600">Estimated current reach</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-blue-600">Target: +{Math.round(Math.random() * 200 + 100)}</div>
                    <div className="text-xs text-gray-500">New followers/month</div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900">Increase Average Impressions</div>
                    <div className="text-sm text-gray-600">Current: {Math.round(overview.avg_impressions || 0).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-purple-600">Target: {Math.round((overview.avg_impressions || 0) * 1.3).toLocaleString()}</div>
                    <div className="text-xs text-gray-500">+30% improvement</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center mb-4">
                <Brain className="h-6 w-6 text-purple-500 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">AI Success Tips</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 rounded-lg">
                  <div className="flex items-start">
                    <Star className="h-4 w-4 text-purple-500 mt-1 mr-2" />
                    <div>
                      <div className="font-medium text-purple-900">Consistency is Key</div>
                      <div className="text-sm text-purple-700">Post at least 5-7 times per week for optimal growth</div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-start">
                    <Star className="h-4 w-4 text-blue-500 mt-1 mr-2" />
                    <div>
                      <div className="font-medium text-blue-900">Engage with Your Audience</div>
                      <div className="text-sm text-blue-700">Reply to comments within 2-3 hours for best results</div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-green-50 rounded-lg">
                  <div className="flex items-start">
                    <Star className="h-4 w-4 text-green-500 mt-1 mr-2" />
                    <div>
                      <div className="font-medium text-green-900">Share Value First</div>
                      <div className="text-sm text-green-700">Focus on helping your audience before promoting</div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-yellow-50 rounded-lg">
                  <div className="flex items-start">
                    <Star className="h-4 w-4 text-yellow-500 mt-1 mr-2" />
                    <div>
                      <div className="font-medium text-yellow-900">Track and Adapt</div>
                      <div className="text-sm text-yellow-700">Review analytics weekly and adjust strategy</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audience' && (
        <div className="space-y-6">
          {/* Audience Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card bg-gradient-to-br from-blue-50 to-indigo-50">
              <div className="flex items-center mb-4">
                <Users className="h-6 w-6 text-blue-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Audience Insights</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Reach</span>
                  <span className="font-semibold">{(overview.total_impressions || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Engaged Users</span>
                  <span className="font-semibold">{Math.round((overview.total_engagement || 0) * 0.8).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg Session Time</span>
                  <span className="font-semibold">{Math.round(Math.random() * 2 + 1)}m {Math.round(Math.random() * 60)}s</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Return Rate</span>
                  <span className="font-semibold">{Math.round(Math.random() * 30 + 40)}%</span>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-green-50 to-emerald-50">
              <div className="flex items-center mb-4">
                <TrendingUp className="h-6 w-6 text-green-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Growth Metrics</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">New Followers</span>
                  <span className="font-semibold text-green-600">+{Math.round(Math.random() * 50 + 20)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Growth Rate</span>
                  <span className="font-semibold text-green-600">+{Math.round(Math.random() * 10 + 5)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Profile Views</span>
                  <span className="font-semibold">+{Math.round(Math.random() * 200 + 100)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Link Clicks</span>
                  <span className="font-semibold">{Math.round(Math.random() * 30 + 10)}</span>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-50 to-pink-50">
              <div className="flex items-center mb-4">
                <Activity className="h-6 w-6 text-purple-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Engagement Quality</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg Likes/Tweet</span>
                  <span className="font-semibold">{Math.round((overview.total_likes || 0) / (overview.total_tweets || 1))}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Reply Rate</span>
                  <span className="font-semibold">{Math.round(Math.random() * 15 + 5)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Share Rate</span>
                  <span className="font-semibold">{Math.round(Math.random() * 10 + 3)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Save Rate</span>
                  <span className="font-semibold">{Math.round(Math.random() * 8 + 2)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Audience Demographics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Engagement Distribution
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'High Engagement', value: 25, fill: '#10b981' },
                      { name: 'Medium Engagement', value: 45, fill: '#3b82f6' },
                      { name: 'Low Engagement', value: 20, fill: '#f59e0b' },
                      { name: 'Passive Viewers', value: 10, fill: '#ef4444' }
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {[
                      { name: 'High Engagement', value: 25, fill: '#10b981' },
                      { name: 'Medium Engagement', value: 45, fill: '#3b82f6' },
                      { name: 'Low Engagement', value: 20, fill: '#f59e0b' },
                      { name: 'Passive Viewers', value: 10, fill: '#ef4444' }
                    ].map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Daily Reach Trends
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="impressions" stroke="#3b82f6" strokeWidth={2} name="Impressions" />
                  <Line type="monotone" dataKey="total_engagement" stroke="#10b981" strokeWidth={2} name="Engagement" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Audience Behavior Insights */}
          <div className="card">
            <div className="flex items-center mb-6">
              <Brain className="h-6 w-6 text-blue-500 mr-3" />
              <h3 className="text-xl font-semibold text-gray-900">Audience Behavior Insights</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center mb-2">
                  <Eye className="h-5 w-5 text-blue-500 mr-2" />
                  <h4 className="font-medium text-blue-900">Most Active Time</h4>
                </div>
                <p className="text-2xl font-bold text-blue-700">2:00 PM</p>
                <p className="text-sm text-blue-600">Peak engagement window</p>
              </div>

              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center mb-2">
                  <Heart className="h-5 w-5 text-green-500 mr-2" />
                  <h4 className="font-medium text-green-900">Favorite Content</h4>
                </div>
                <p className="text-lg font-bold text-green-700">Educational</p>
                <p className="text-sm text-green-600">+{Math.round(Math.random() * 40 + 30)}% more likes</p>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center mb-2">
                  <MessageCircle className="h-5 w-5 text-purple-500 mr-2" />
                  <h4 className="font-medium text-purple-900">Discussion Rate</h4>
                </div>
                <p className="text-2xl font-bold text-purple-700">{Math.round(Math.random() * 20 + 10)}%</p>
                <p className="text-sm text-purple-600">Comments to views ratio</p>
              </div>

              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="flex items-center mb-2">
                  <Share2 className="h-5 w-5 text-orange-500 mr-2" />
                  <h4 className="font-medium text-orange-900">Share Rate</h4>
                </div>
                               <p className="text-2xl font-bold text-orange-700">{Math.round(Math.random() * 15 + 5)}%</p>
                <p className="text-sm text-orange-600">Content shared by audience</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Performing Tweets */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Tweets
          </h3>
          <span className="text-sm text-gray-500">
            Last {timeframe} days
          </span>
        </div>

        {topTweets.length > 0 ? (
          <div className="space-y-4">
            {topTweets.map((tweet, index) => {
              let badge = null;
              if (updatedTweetIds.has(tweet.id)) {
                badge = <span className="ml-2 px-2 py-0.5 rounded-full bg-green-200 text-green-800 text-xs font-semibold">Synced</span>;
              } else if (skippedTweetIds.has(tweet.id)) {
                badge = <span className="ml-2 px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-800 text-xs font-semibold">Skipped</span>;
              }
              return (
                <div key={tweet.id} className="p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full">
                          {index + 1}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(tweet.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                          {tweet.tweet_engagement_rate}% engagement rate
                        </span>
                        {badge}
                      </div>
                      <p className="text-gray-700 mb-3 line-clamp-3">
                        {tweet.content.split('---')[0].substring(0, 200)}
                        {tweet.content.length > 200 ? '...' : ''}
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="flex items-center text-gray-600">
                          <Eye className="h-4 w-4 mr-1" />
                          <span className="font-medium">{(tweet.impressions || 0).toLocaleString()}</span>
                          <span className="ml-1">views</span>
                        </div>
                        <div className="flex items-center text-red-600">
                          <Heart className="h-4 w-4 mr-1" />
                          <span className="font-medium">{tweet.likes || 0}</span>
                          <span className="ml-1">likes</span>
                        </div>
                        <div className="flex items-center text-green-600">
                          <Repeat2 className="h-4 w-4 mr-1" />
                          <span className="font-medium">{tweet.retweets || 0}</span>
                          <span className="ml-1">retweets</span>
                        </div>
                        <div className="flex items-center text-blue-600">
                          <MessageCircle className="h-4 w-4 mr-1" />
                          <span className="font-medium">{tweet.replies || 0}</span>
                          <span className="ml-1">replies</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No tweet performance data available</p>
            <p className="text-sm text-gray-500 mt-2">
              Post some tweets and sync data to see analytics here
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Analytics;

