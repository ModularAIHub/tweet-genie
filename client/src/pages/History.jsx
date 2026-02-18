import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, MessageCircle, Heart, Repeat2, ExternalLink, Calendar, Filter, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import { tweets as tweetsAPI } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import Delete from './Delete';

const History = () => {
  const { selectedAccount, accounts } = useAccount();
  const accountAPI = useAccountAwareAPI();
  const isTeamUser = accounts.length > 0;
  const currentAccountId = selectedAccount?.id;
  
  const [postedTweets, setPostedTweets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, today, week, month
  const [sourceFilter, setSourceFilter] = useState('all'); // all, platform, external
  const [statusFilter, setStatusFilter] = useState('all'); // all, posted, deleted
  const [sortBy, setSortBy] = useState('newest'); // newest, oldest, most_likes, most_retweets
  const [deletingTweets, setDeletingTweets] = useState(new Set()); // Track which tweets are being deleted
  const [expandedThreads, setExpandedThreads] = useState(new Set()); // Track which threads are expanded
  const [deleteModal, setDeleteModal] = useState({ open: false, tweet: null });
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [retentionInfo, setRetentionInfo] = useState({
    days: 15,
    message: 'Deleted tweets stay visible for 15 days before permanent cleanup.',
  });

  // Load saved filters when account changes (per-account persistence)
  useEffect(() => {
    if (!currentAccountId) return;
    const saved = localStorage.getItem(`historyFilters:${currentAccountId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFilter(parsed.filter || 'all');
        setSourceFilter(parsed.sourceFilter || 'all');
        setStatusFilter(parsed.statusFilter || 'all');
        setSortBy(parsed.sortBy || 'newest');
      } catch (err) {
        console.error('Failed to parse saved history filters', err);
      }
    } else {
      // reset to defaults when no saved filters
      setFilter('all');
      setSourceFilter('all');
      setStatusFilter('all');
      setSortBy('newest');
    }
  }, [currentAccountId]);

  // Persist filters per account when they change
  useEffect(() => {
    if (!currentAccountId) return;
    const payload = { filter, sourceFilter, statusFilter, sortBy };
    localStorage.setItem(`historyFilters:${currentAccountId}`, JSON.stringify(payload));
  }, [filter, sourceFilter, statusFilter, sortBy, currentAccountId]);

  useEffect(() => {
    fetchPostedTweets();
  }, [filter, sortBy, sourceFilter, statusFilter, selectedAccount]);

  const fetchPostedTweets = async () => {
    try {
      setLoading(true);
      
      // Build query parameters
      const params = {
        limit: 50,
        sort: sortBy === 'newest' ? 'created_at_desc' : 
              sortBy === 'oldest' ? 'created_at_asc' :
              sortBy === 'most_likes' ? 'likes_desc' : 'retweets_desc'
      };

      // Add date filter
      if (filter !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (filter) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          default:
            startDate = null;
        }
        
        if (startDate) {
          params.start_date = startDate.toISOString();
        }
      }

      // Use account-aware API for team users
      let response;
      if (isTeamUser && selectedAccount) {
        const page = 1;
        const limit = params.limit || 50;
        console.log('[History] Calling getTweetHistory with page:', page, 'limit:', limit);
        const apiResponse = await accountAPI.getTweetHistory(page, limit);
        console.log('[History] API Response status:', apiResponse.status, 'content-type:', apiResponse.headers.get('content-type'));
        
        // Check if response is ok
        if (!apiResponse.ok) {
          const text = await apiResponse.text();
          console.error('[History] API Error Response:', text.substring(0, 500));
          throw new Error(`API returned ${apiResponse.status}: ${text.substring(0, 100)}`);
        }
        
        // Check if response is JSON
        const contentType = apiResponse.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await apiResponse.text();
          console.error('[History] Non-JSON Response:', text.substring(0, 500));
          throw new Error(`Expected JSON but got ${contentType}: ${text.substring(0, 100)}`);
        }
        
        const data = await apiResponse.json();
        console.log('[History] Parsed JSON data:', data);
        setIsDisconnected(Boolean(data?.disconnected || data?.data?.disconnected));
        const retention = data?.retention || data?.data?.retention;
        if (retention?.days) {
          setRetentionInfo({
            days: retention.days,
            message: retention.message || `Deleted tweets stay visible for ${retention.days} days before permanent cleanup.`,
          });
        }
        response = { data: { tweets: data.data?.tweets || data.tweets || [] } };
      } else {
        response = await tweetsAPI.list(params);
        setIsDisconnected(Boolean(response.data?.disconnected));
        const retention = response.data?.retention;
        if (retention?.days) {
          setRetentionInfo({
            days: retention.days,
            message: retention.message || `Deleted tweets stay visible for ${retention.days} days before permanent cleanup.`,
          });
        }
      }
      
      let fetchedTweets = response.data.tweets || [];
      
      // Apply source filter
      if (sourceFilter !== 'all') {
        fetchedTweets = fetchedTweets.filter(tweet => 
          tweet.source === sourceFilter || 
          (sourceFilter === 'platform' && !tweet.source) // Handle older tweets without source
        );
      }
      
      // Apply status filter
      if (statusFilter !== 'all') {
        fetchedTweets = fetchedTweets.filter(tweet => tweet.status === statusFilter);
      }
      
      setPostedTweets(fetchedTweets);
    } catch (error) {
      console.error('Failed to fetch posted tweets:', error);
      const reconnectRequired =
        error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
        error?.response?.data?.reconnect === true;
      if (reconnectRequired) {
        setIsDisconnected(true);
        setPostedTweets([]);
        toast.error('Twitter is disconnected. Please reconnect in Settings.');
      } else {
        toast.error('Failed to load tweet history');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffMs / (1000 * 60));
    const diffInHours = diffMs / (1000 * 60 * 60);
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    if (diffInMinutes < 1) {
      return 'just now';
    } else if (diffInHours < 1) {
      return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return date.toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: userTimezone
      });
    }
  };

  const getEngagementRate = (tweet) => {
    const totalEngagement = (tweet.likes || 0) + (tweet.retweets || 0) + (tweet.replies || 0);
    const impressions = tweet.impressions || 1;
    return ((totalEngagement / impressions) * 100).toFixed(1);
  };

  const getTweetUrl = (tweet) => {
    // Defensive: check for valid username and tweet_id
    if (!tweet.tweet_id || !tweet.username) return null;
    // Remove @ if present in username
    const username = tweet.username.startsWith('@') ? tweet.username.slice(1) : tweet.username;
    const url = `https://twitter.com/${username}/status/${tweet.tweet_id}`;
    // Optionally log for debugging
    // console.log('Redirecting to:', url);
    return url;
  };

  // Parse thread content into individual tweets
  const parseThreadTweets = (content) => {
    if (!content) return [];
    const parts = content.split('---').map(part => part.trim()).filter(part => part.length > 0);
    return parts;
  };

  // Check if tweet is a thread
  const isThread = (tweet) => {
    return tweet.is_thread || (tweet.content && tweet.content.includes('---'));
  };

  // Get thread preview (first tweet + count)
  const getThreadPreview = (tweet) => {
    if (!isThread(tweet)) return tweet.content;

    const threadTweets = parseThreadTweets(tweet.content);
    const firstTweet = threadTweets[0] || tweet.content;
    const secondTweet = threadTweets[1] || null;
    const count = threadTweets.length;

    return {
      preview: firstTweet,
      second: secondTweet,
      count: count
    };
  };

  // Toggle thread expansion
  const toggleThreadExpansion = (tweetId) => {
    setExpandedThreads(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tweetId)) {
        newSet.delete(tweetId);
      } else {
        newSet.add(tweetId);
      }
      return newSet;
    });
  };

  const handleDeleteTweet = async (tweet, skipConfirm = false) => {
    if (!tweet) return;
    if (!skipConfirm) {
      setDeleteModal({ open: true, tweet });
      return;
    }
    
    try {
      setDeletingTweets(prev => new Set([...prev, tweet.id]));
      const response = await tweetsAPI.delete(tweet.id);
      const retentionDays = response?.data?.retention?.days || retentionInfo.days || 15;
      toast.success(response?.data?.message || `Tweet deleted. It will be auto-cleaned after ${retentionDays} days.`);
      await fetchPostedTweets();
    } catch (error) {
      if (error.response?.status === 404 || error.response?.status === 400) {
        toast.error(error.response?.data?.error || 'Tweet could not be deleted on Twitter right now.');
      } else if (error.response?.status === 403) {
        toast.error('Cannot delete tweet: insufficient permissions or tweet is too old');
      } else {
        toast.error('Failed to delete tweet: ' + (error.response?.data?.error || error.response?.data?.message || error.message));
      }
    } finally {
      setDeletingTweets(prev => {
        const newSet = new Set(prev);
        newSet.delete(tweet.id);
        return newSet;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading tweet history...</p>
        </div>
      </div>
    );
  }

  if (isDisconnected) {
    return (
      <div className="card text-center py-12">
        <HistoryIcon className="h-12 w-12 text-orange-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Twitter Connection Required</h3>
        <p className="text-gray-600 mb-6">
          Reconnect your Twitter account to view posting history.
        </p>
        <a href="/settings" className="btn btn-primary btn-md cursor-pointer">
          Go to Settings
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-6 border border-blue-100">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 bg-blue-600 rounded-xl">
            <HistoryIcon className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            Tweet History
          </h1>
        </div>
        <p className="text-gray-600 ml-14">
          View and analyze your posted tweets from both platform and Twitter
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
        <div className="flex items-start space-x-2">
          <span className="text-lg">ℹ️</span>
          <div>
            <span className="font-semibold">Deleted tweet policy:</span>{' '}
            {retentionInfo.message || `Deleted tweets stay visible for ${retentionInfo.days} days before permanent cleanup.`}
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="card bg-white shadow-sm border border-gray-200">
        <div className="space-y-6">
          {/* First Row: Time Filter and Sort */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Time Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-blue-50 rounded-lg">
                  <Filter className="h-4 w-4 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-gray-700">Time Period</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Time', icon: '📅' },
                  { value: 'today', label: 'Today', icon: '📆' },
                  { value: 'week', label: 'This Week', icon: '📊' },
                  { value: 'month', label: 'This Month', icon: '📈' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                      filter === option.value
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md scale-105'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    <span className="mr-1">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort Options */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">Sort by</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white cursor-pointer shadow-sm hover:border-gray-400 transition-colors"
              >
                <option value="newest">⏰ Newest First</option>
                <option value="oldest">🕐 Oldest First</option>
                <option value="most_likes">❤️ Most Likes</option>
                <option value="most_retweets">🔄 Most Retweets</option>
              </select>
            </div>
          </div>

          {/* Second Row: Source and Status Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-4 border-t border-gray-100">
            {/* Source Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-green-50 rounded-lg">
                  <ExternalLink className="h-4 w-4 text-green-600" />
                </div>
                <span className="text-sm font-semibold text-gray-700">Source</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Tweets', icon: '🌐' },
                  { value: 'platform', label: 'Platform', icon: '🚀' },
                  { value: 'external', label: 'Twitter', icon: '🐦' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSourceFilter(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                      sourceFilter === option.value
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md scale-105'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    <span className="mr-1">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-purple-50 rounded-lg">
                  <Calendar className="h-4 w-4 text-purple-600" />
                </div>
                <span className="text-sm font-semibold text-gray-700">Status</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Status', icon: '📋' },
                  { value: 'posted', label: 'Live', icon: '✅' },
                  { value: 'deleted', label: 'Deleted', icon: '🗑️' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setStatusFilter(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                      statusFilter === option.value
                        ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md scale-105'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    <span className="mr-1">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      {postedTweets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-blue-600">
                  {postedTweets.length}
                </div>
                <div className="text-sm text-blue-700 font-medium mt-1">Total Tweets</div>
              </div>
              <div className="text-4xl">📝</div>
            </div>
          </div>
          <div className="card bg-gradient-to-br from-red-50 to-red-100 border-red-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-red-600">
                  {postedTweets.reduce((sum, tweet) => sum + (tweet.likes || 0), 0).toLocaleString()}
                </div>
                <div className="text-sm text-red-700 font-medium mt-1">Total Likes</div>
              </div>
              <div className="text-4xl">❤️</div>
            </div>
          </div>
          <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-green-600">
                  {postedTweets.reduce((sum, tweet) => sum + (tweet.retweets || 0), 0).toLocaleString()}
                </div>
                <div className="text-sm text-green-700 font-medium mt-1">Total Retweets</div>
              </div>
              <div className="text-4xl">🔄</div>
            </div>
          </div>
          <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-purple-600">
                  {postedTweets.reduce((sum, tweet) => sum + (tweet.replies || 0), 0).toLocaleString()}
                </div>
                <div className="text-sm text-purple-700 font-medium mt-1">Total Replies</div>
              </div>
              <div className="text-4xl">💬</div>
            </div>
          </div>
        </div>
      )}

      {/* Tweet History List */}
      <div className="space-y-4">
        {postedTweets.length > 0 ? (
          postedTweets.map((tweet) => {
            const isThreadTweet = isThread(tweet);
            const threadPreview = isThreadTweet ? getThreadPreview(tweet) : null;
            const threadTweets = isThreadTweet ? parseThreadTweets(tweet.content) : [];
            const isExpanded = expandedThreads.has(tweet.id);

            return (
              <div key={tweet.id} className={`card hover:shadow-lg transition-all duration-200 border ${
                isThreadTweet ? 'border-l-4 border-l-purple-500 bg-gradient-to-r from-purple-50/30 to-transparent' : 'border-gray-200'
              } ${tweet.status === 'deleted' ? 'opacity-75 bg-gray-50' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Tweet Header */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-sm">
                          <span className="text-white text-sm font-bold">
                            {tweet.username?.charAt(0).toUpperCase() || 'T'}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900">
                          @{tweet.username}
                        </span>
                      </div>
                      
                      {/* Badges Row */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Source Badge */}
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm ${
                          tweet.source === 'external' 
                            ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white' 
                            : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                        }`}>
                          {tweet.source === 'external' ? '🐦 Twitter' : '🚀 Platform'}
                        </span>
                        
                        {/* Status Badge */}
                        {tweet.status === 'deleted' && (
                          <span className="px-2.5 py-1 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg text-xs font-semibold shadow-sm">
                            🗑️ Deleted
                          </span>
                        )}
                        {tweet.status === 'posted' && (
                          <span className="px-2.5 py-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg text-xs font-semibold shadow-sm">
                            ✅ Live
                          </span>
                        )}
                        
                        {/* Thread Badge */}
                        {isThreadTweet && (
                          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 text-white rounded-lg text-xs font-bold shadow-md">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3.5 w-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h6m-6 4h10" />
                            </svg>
                            Thread ({threadPreview.count})
                          </span>
                        )}
                        
                        {/* AI Generated Badge */}
                        {tweet.ai_generated === true && (
                          <span className="px-2.5 py-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg text-xs font-semibold shadow-sm">
                            ✨ AI
                          </span>
                        )}
                      </div>
                      
                      {/* Time and Link */}
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-gray-500 font-medium">
                          {formatDate(tweet.display_created_at || tweet.posted_at || tweet.created_at)}
                        </span>
                        {getTweetUrl(tweet) && (
                          <a
                            href={getTweetUrl(tweet)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="View on Twitter"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                    
                    {/* Tweet Content - Thread or Single Tweet */}
                    {isThreadTweet ? (
                      <div className="mb-4">
                        {/* Thread Preview or Full Thread */}
                        {!isExpanded ? (
                          <div className="relative">
                            {/* Thread connector line */}
                            <div className="absolute left-6 top-12 bottom-12 w-0.5 bg-gradient-to-b from-purple-300 to-pink-300"></div>
                            
                            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border-2 border-purple-300 shadow-sm">
                              {/* Thread header */}
                              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-purple-200">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                                  <div className="w-2 h-2 rounded-full bg-pink-500"></div>
                                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                                </div>
                                <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">
                                  Thread • {threadPreview.count} tweets
                                </span>
                              </div>
                              
                              {/* First tweet */}
                              <div className="relative pl-8 mb-3">
                                <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                                  1
                                </div>
                                <p className="text-gray-900 whitespace-pre-wrap font-medium leading-relaxed">
                                  {threadPreview.preview}
                                </p>
                              </div>
                              
                              {/* Second tweet preview */}
                              {threadPreview.second && (
                                <div className="relative pl-8 mb-3">
                                  <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                                    2
                                  </div>
                                  <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed bg-white/70 rounded-lg p-2">
                                    {threadPreview.second}
                                  </p>
                                </div>
                              )}
                              
                              {threadPreview.count > 2 && (
                                <div className="pl-8 text-sm text-purple-600 font-medium">
                                  + {threadPreview.count - 2} more tweet{threadPreview.count - 2 > 1 ? 's' : ''}
                                </div>
                              )}
                              
                              <button
                                onClick={() => toggleThreadExpansion(tweet.id)}
                                className="flex items-center text-sm text-purple-600 hover:text-purple-800 font-semibold cursor-pointer bg-white px-3 py-2 rounded-lg hover:bg-purple-100 transition-colors mt-3 w-full justify-center border border-purple-200"
                              >
                                <ChevronDown className="h-4 w-4 mr-1" />
                                Show all {threadPreview.count} tweets in thread
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border-2 border-purple-300 shadow-sm">
                            {/* Thread header */}
                            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-purple-200">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                                <div className="w-2 h-2 rounded-full bg-pink-500"></div>
                                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                              </div>
                              <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">
                                Full Thread • {threadTweets.length} tweets
                              </span>
                            </div>
                            
                            <div className="space-y-3 relative">
                              {/* Connecting line */}
                              <div className="absolute left-3 top-6 bottom-6 w-0.5 bg-gradient-to-b from-purple-300 via-pink-300 to-purple-300"></div>
                              
                              {threadTweets.map((tweetContent, index) => (
                                <div key={index} className="relative pl-10">
                                  <div className="absolute left-0 top-1 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 text-white flex items-center justify-center text-xs font-bold shadow-md z-10">
                                    {index + 1}
                                  </div>
                                  <div className="bg-white rounded-lg py-3 px-4 shadow-sm hover:shadow-md transition-shadow border border-purple-200">
                                    <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                                      {tweetContent}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            
                            <button
                              onClick={() => toggleThreadExpansion(tweet.id)}
                              className="flex items-center text-sm text-purple-600 hover:text-purple-800 font-semibold mt-4 cursor-pointer bg-white px-3 py-2 rounded-lg hover:bg-purple-100 transition-colors w-full justify-center border border-purple-200"
                            >
                              <ChevronUp className="h-4 w-4 mr-1" />
                              Collapse thread
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Single Tweet Content */
                      <p className="text-gray-900 mb-4 whitespace-pre-wrap leading-relaxed">
                        {tweet.content}
                      </p>
                    )}

                    {/* Media Indicators */}
                    {tweet.media_urls && tweet.media_urls.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg border border-blue-200 w-fit">
                          <span className="text-lg">📷</span>
                          <span className="font-medium">{tweet.media_urls.filter(url => url && url !== null).length} media file(s) attached</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Performance Indicators */}
                    {tweet.impressions > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <div className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-2 rounded-lg border border-blue-200">
                          <span className="font-semibold text-gray-700">Engagement Rate:</span>
                          <span className="font-bold text-blue-600">{getEngagementRate(tweet)}%</span>
                        </div>
                        {tweet.impressions > 1000 && (
                          <span className="px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold shadow-sm">
                            🔥 High Reach
                          </span>
                        )}
                      </div>
                    )}

                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col items-end space-y-2">
                    {/* Delete Button - Only for platform tweets */}
                    {tweet.source !== 'external' && tweet.status !== 'deleted' && (
                      <button
                        onClick={() => setDeleteModal({ open: true, tweet })}
                        disabled={deletingTweets.has(tweet.id)}
                        className="flex items-center gap-2 px-3 py-2 text-red-600 hover:text-white hover:bg-red-600 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border border-red-200 hover:border-red-600 font-medium shadow-sm hover:shadow-md"
                        title={`Delete tweet from Twitter (kept as deleted for ${retentionInfo.days} days)`}
                      >
                        {deletingTweets.has(tweet.id) ? (
                          <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        <span className="text-xs font-semibold">Delete</span>
                      </button>
                    )}

                    {/* External Tweet Info */}
                    {tweet.source === 'external' && (
                      <div className="text-xs text-gray-600 bg-gray-100 px-3 py-2 rounded-lg font-medium border border-gray-200">
                        Posted via Twitter
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="card text-center py-12">
            <HistoryIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No posted tweets found
            </h3>
            <p className="text-gray-600 mb-6">
              {filter === 'all' 
                ? "You haven't posted any tweets yet"
                : `No tweets found for the selected time period`
              }
            </p>
            <a
              href="/compose"
              className="btn btn-primary btn-md cursor-pointer"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Create Your First Tweet
            </a>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      <Delete
        isOpen={deleteModal.open}
        tweet={deleteModal.tweet}
        onDelete={async () => {
          await handleDeleteTweet(deleteModal.tweet, true);
          setDeleteModal({ open: false, tweet: null });
        }}
        onCancel={() => setDeleteModal({ open: false, tweet: null })}
      />
    </div>
  );
};

export default History;
