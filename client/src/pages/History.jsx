import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, MessageCircle, Heart, Repeat2, ExternalLink, Calendar, Filter, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import { tweets as tweetsAPI } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const History = () => {
    const { selectedAccount, accounts } = useAccount();
    const accountAPI = useAccountAwareAPI();
    const isTeamUser = accounts.length > 0;
  
  const [postedTweets, setPostedTweets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, today, week, month
  const [sourceFilter, setSourceFilter] = useState('all'); // all, platform, external
  const [statusFilter, setStatusFilter] = useState('all'); // all, posted, deleted
  const [sortBy, setSortBy] = useState('newest'); // newest, oldest, most_likes, most_retweets
  const [deletingTweets, setDeletingTweets] = useState(new Set()); // Track which tweets are being deleted
  const [expandedThreads, setExpandedThreads] = useState(new Set()); // Track which threads are expanded

  useEffect(() => {
    fetchPostedTweets();
  }, [filter, sortBy, sourceFilter, statusFilter, selectedAccount]);

  const fetchPostedTweets = async () => {
    try {
      setLoading(true);
      
      // Build query parameters
      const params = {
        // Remove status filter to show all tweets (including external)
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
        const apiResponse = await accountAPI.getTweetHistory(page, limit);
        const data = await apiResponse.json();
        response = { data: { tweets: data.data?.tweets || data.tweets || [] } };
      } else {
        response = await tweetsAPI.list(params);
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
      toast.error('Failed to load tweet history');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    // Always compare UTC times for accurate difference
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
    if (tweet.tweet_id && tweet.username) {
      return `https://twitter.com/${tweet.username}/status/${tweet.tweet_id}`;
    }
    return null;
  };

  // Parse thread content into individual tweets
  const parseThreadTweets = (content) => {
    if (!content) return [];
    
    // Split by --- separator and filter out empty parts
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

  const handleDeleteTweet = async (tweet) => {
    // Confirm deletion
    const confirmed = window.confirm(
      `Are you sure you want to delete this tweet?\n\n"${tweet.content.substring(0, 100)}${tweet.content.length > 100 ? '...' : ''}"\n\nThis will delete the tweet from both your Twitter account and history.`
    );
    
    if (!confirmed) return;

    try {
      // Add tweet ID to deleting set
      setDeletingTweets(prev => new Set([...prev, tweet.id]));
      
      // Attempt to delete from Twitter first
      if (tweet.tweet_id) {
        console.log(`Deleting tweet ${tweet.tweet_id} from Twitter...`);
        await tweets.delete(tweet.id); // This should handle both Twitter deletion and DB removal
      } else {
        // If no tweet_id, just remove from database
        console.log(`Removing tweet ${tweet.id} from history (no Twitter ID)...`);
        await tweets.delete(tweet.id);
      }
      
      // Remove from local state
      setPostedTweets(prev => prev.filter(t => t.id !== tweet.id));
      
      toast.success('Tweet deleted successfully');
    } catch (error) {
      console.error('Failed to delete tweet:', error);
      
      // Handle specific error cases
      if (error.response?.status === 404) {
        // Tweet not found on Twitter, but remove from our database anyway
        try {
          await tweets.delete(tweet.id);
          setPostedTweets(prev => prev.filter(t => t.id !== tweet.id));
          toast.success('Tweet removed from history (was already deleted from Twitter)');
        } catch (dbError) {
          toast.error('Failed to remove tweet from history');
        }
      } else if (error.response?.status === 403) {
        toast.error('Cannot delete tweet: insufficient permissions or tweet is too old');
      } else {
        toast.error('Failed to delete tweet: ' + (error.response?.data?.message || error.message));
      }
    } finally {
      // Remove tweet ID from deleting set
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <HistoryIcon className="h-8 w-8 mr-3 text-blue-600" />
            Tweet History
          </h1>
          <p className="mt-2 text-gray-600">
            View and analyze your posted tweets from both platform and Twitter
          </p>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="card">
        <div className="space-y-6">
          {/* First Row: Time Filter and Sort */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            {/* Time Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Time:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Time' },
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'This Week' },
                  { value: 'month', label: 'This Month' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      filter === option.value
                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort Options */}
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium text-gray-700">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="most_likes">Most Likes</option>
                <option value="most_retweets">Most Retweets</option>
              </select>
            </div>
          </div>

          {/* Second Row: Source and Status Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            {/* Source Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <div className="flex items-center space-x-2">
                <ExternalLink className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Source:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Tweets' },
                  { value: 'platform', label: 'Platform' },
                  { value: 'external', label: 'Twitter' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSourceFilter(option.value)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      sourceFilter === option.value
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Status:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Status' },
                  { value: 'posted', label: 'Live' },
                  { value: 'deleted', label: 'Deleted' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setStatusFilter(option.value)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      statusFilter === option.value
                        ? 'bg-purple-100 text-purple-700 border border-purple-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                    }`}
                  >
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="card text-center">
            <div className="text-2xl font-bold text-blue-600">
              {postedTweets.length}
            </div>
            <div className="text-sm text-gray-600">Total Tweets</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-red-600">
              {postedTweets.reduce((sum, tweet) => sum + (tweet.likes || 0), 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Likes</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-green-600">
              {postedTweets.reduce((sum, tweet) => sum + (tweet.retweets || 0), 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Retweets</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-purple-600">
              {postedTweets.reduce((sum, tweet) => sum + (tweet.replies || 0), 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Replies</div>
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
              <div key={tweet.id} className={`card hover:shadow-md transition-shadow ${isThreadTweet ? 'border-l-4 border-l-blue-500' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    {/* Tweet Header */}
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="h-8 w-8 bg-blue-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-medium">
                            {tweet.username?.charAt(0).toUpperCase() || 'T'}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          @{tweet.username}
                        </span>
                        {/* Source Indicator */}
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          tweet.source === 'external' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {tweet.source === 'external' ? '🐦 Twitter' : '🚀 Platform'}
                        </span>
                        {/* Status Indicator */}
                        {tweet.status === 'deleted' && (
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                            🗑️ Deleted
                          </span>
                        )}
                        {tweet.status === 'posted' && (
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                            ✅ Live
                          </span>
                        )}
                        {isThreadTweet && (
                          <span className="flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 text-white rounded-full text-xs font-semibold shadow-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h6m-6 4h10" />
                            </svg>
                            Thread
                            <span className="ml-1 font-bold">({threadPreview.count} tweets)</span>
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">
                        {formatDate(tweet.display_created_at || tweet.posted_at || tweet.created_at)}
                      </span>
                      {getTweetUrl(tweet) && (
                        <a
                          href={getTweetUrl(tweet)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-700"
                          title="View on Twitter"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    
                    {/* Tweet Content - Thread or Single Tweet */}
                    {isThreadTweet ? (
                      <div className="mb-4">
                        {/* Thread Preview or Full Thread */}
                        {!isExpanded ? (
                          <div>
                            <div className="mb-2">
                              <p className="text-gray-900 whitespace-pre-wrap font-semibold">
                                {threadPreview.preview}
                              </p>
                              {threadPreview.second && (
                                <p className="text-gray-700 whitespace-pre-wrap mt-1 border-l-2 border-purple-200 pl-3 text-sm">
                                  {threadPreview.second}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => toggleThreadExpansion(tweet.id)}
                              className="flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium"
                            >
                              <ChevronDown className="h-4 w-4 mr-1" />
                              Show all {threadPreview.count} tweets in thread
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div className="space-y-3">
                              {threadTweets.map((tweetContent, index) => (
                                <div key={index} className="border-l-2 border-purple-300 pl-4 bg-purple-50/30 rounded-md py-2">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <span className="text-xs text-purple-700 bg-purple-100 px-2 py-1 rounded">
                                      {index + 1}/{threadTweets.length}
                                    </span>
                                  </div>
                                  <p className="text-gray-900 whitespace-pre-wrap">
                                    {tweetContent}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => toggleThreadExpansion(tweet.id)}
                              className="flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium mt-3"
                            >
                              <ChevronUp className="h-4 w-4 mr-1" />
                              Collapse thread
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Single Tweet Content */
                      <p className="text-gray-900 mb-4 whitespace-pre-wrap">
                        {tweet.content}
                      </p>
                    )}

                    {/* Media Indicators */}
                    {tweet.media_urls && tweet.media_urls.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center text-sm text-gray-500">
                          <span>📷 {tweet.media_urls.length} media file(s) attached</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Engagement Metrics */}
                    <div className="flex items-center space-x-6 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Heart className="h-4 w-4" />
                        <span>{(tweet.likes || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Repeat2 className="h-4 w-4" />
                        <span>{(tweet.retweets || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <MessageCircle className="h-4 w-4" />
                        <span>{(tweet.replies || 0).toLocaleString()}</span>
                      </div>
                      {tweet.impressions && (
                        <div className="flex items-center space-x-1">
                          <span className="text-xs">👀 {tweet.impressions.toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {/* Performance Indicators */}
                    {tweet.impressions && (
                      <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                        <span>
                          Engagement Rate: {getEngagementRate(tweet)}%
                        </span>
                        {tweet.impressions > 1000 && (
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full">
                            High Reach
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons and Badges */}
                  <div className="ml-4 flex flex-col items-end space-y-2">
                    {/* Delete Button - Only for platform tweets */}
                    {tweet.source !== 'external' && (
                      <button
                        onClick={() => handleDeleteTweet(tweet)}
                        disabled={deletingTweets.has(tweet.id)}
                        className="flex items-center px-2 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete tweet from Twitter and history"
                      >
                        {deletingTweets.has(tweet.id) ? (
                          <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        <span className="ml-1 text-xs">Delete</span>
                      </button>
                    )}

                    {/* External Tweet Info */}
                    {tweet.source === 'external' && (
                      <div className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
                        From Twitter
                      </div>
                    )}

                    {/* Badges */}
                    <div className="flex flex-col space-y-1">
                      {tweet.scheduled_for && (
                        <span className="badge badge-warning">Scheduled</span>
                      )}
                      {tweet.ai_generated && (
                        <span className="badge badge-info">AI Generated</span>
                      )}
                    </div>
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
              className="btn btn-primary btn-md"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Create Your First Tweet
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default History;
