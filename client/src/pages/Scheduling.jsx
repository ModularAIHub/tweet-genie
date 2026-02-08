import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Edit3, Trash2, Play, Pause } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import { scheduling as schedulingAPI } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const Scheduling = () => {
    const { selectedAccount, accounts } = useAccount();
    const accountAPI = useAccountAwareAPI();
    const isTeamUser = accounts.length > 0;
  const currentAccountId = selectedAccount?.id;
  
  const [scheduledTweets, setScheduledTweets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  // Load saved filter per account when account changes
  useEffect(() => {
    if (!currentAccountId) return;
    const saved = localStorage.getItem(`schedulingFilter:${currentAccountId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFilter(parsed.filter || 'pending');
      } catch (err) {
        console.error('Failed to parse saved scheduling filter', err);
        setFilter('pending');
      }
    } else {
      setFilter('pending');
    }
  }, [currentAccountId]);

  // Persist filter per account
  useEffect(() => {
    if (!currentAccountId) return;
    localStorage.setItem(`schedulingFilter:${currentAccountId}`, JSON.stringify({ filter }));
  }, [filter, currentAccountId]);

  useEffect(() => {
    fetchScheduledTweets();
  }, [filter, selectedAccount]);

  const fetchScheduledTweets = async () => {
    try {
      setLoading(true);
      
      // Use account-aware API for team users
      if (isTeamUser && selectedAccount) {
        // Always include teamId in fetch for team users
        const teamId = selectedAccount.team_id || sessionStorage.getItem('currentTeamId') || null;
        const apiResponse = await accountAPI.fetchForCurrentAccount('/api/scheduling/scheduled', {
          headers: teamId ? { 'x-team-id': teamId } : {}
        });
        const data = await apiResponse.json();
        let tweets = data.data?.scheduled_tweets || data.scheduled_tweets || [];
        // Apply filter
        if (filter !== 'all') {
          tweets = tweets.filter(tweet => tweet.status === filter);
        }
        setScheduledTweets(tweets);
      } else {
        const response = await schedulingAPI.list({ status: filter });
        setScheduledTweets(response.data.scheduled_tweets || []);
      }
    } catch (error) {
      console.error('Failed to fetch scheduled tweets:', error);
      toast.error('Failed to load scheduled tweets');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (scheduleId) => {
    try {
      await schedulingAPI.cancel(scheduleId);
      toast.success('Scheduled tweet cancelled');
      fetchScheduledTweets();
    } catch (error) {
      console.error('Failed to cancel scheduled tweet:', error);
      toast.error('Failed to cancel scheduled tweet');
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: 'badge-info',
      completed: 'badge-success',
      failed: 'badge-error',
      cancelled: 'badge-warning',
    };
    return badges[status] || 'badge-info';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading scheduled tweets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scheduled Tweets</h1>
          <p className="mt-2 text-gray-600">
            Manage your scheduled content and posting timeline
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-medium text-gray-700">Filter by status:</span>
          {['pending', 'completed', 'failed', 'cancelled'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                filter === status
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled Tweets List */}
      <div className="space-y-4">
        {scheduledTweets.length > 0 ? (
          scheduledTweets.map((scheduledTweet) => (
            <div key={scheduledTweet.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3 mb-3">
                    <span className={`badge ${getStatusBadge(scheduledTweet.status)}`}>
                      {scheduledTweet.status}
                    </span>
                    <span className="text-sm text-gray-500">
                      @{scheduledTweet.username}
                    </span>
                  </div>
                  
                  <p className="text-gray-900 mb-3 line-clamp-3">
                    {scheduledTweet.content}
                  </p>
                  
                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <div className="flex items-center">
                      <Calendar className="h-4 w-4 mr-1" />
                      {formatDate(scheduledTweet.scheduled_for)}
                    </div>
                    {scheduledTweet.timezone && (
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {scheduledTweet.timezone}
                      </div>
                    )}
                  </div>

                  {scheduledTweet.media_urls && scheduledTweet.media_urls.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center text-sm text-gray-500">
                        <span>📷 {scheduledTweet.media_urls.filter(url => url && url !== null).length} media file(s) attached</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2 ml-4">
                  {scheduledTweet.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleCancel(scheduledTweet.id)}
                        className="btn btn-secondary btn-sm"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  
                  {scheduledTweet.status === 'completed' && scheduledTweet.posted_at && (
                    <div className="text-xs text-gray-500">
                      Posted: {formatDate(scheduledTweet.posted_at)}
                    </div>
                  )}
                  
                  {scheduledTweet.status === 'failed' && scheduledTweet.error_message && (
                    <div className="text-xs text-red-600 max-w-48 truncate" title={scheduledTweet.error_message}>
                      Error: {scheduledTweet.error_message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="card text-center py-12">
            <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No {filter} scheduled tweets
            </h3>
            <p className="text-gray-600 mb-6">
              {filter === 'pending' 
                ? "You don't have any upcoming scheduled tweets"
                : `No ${filter} scheduled tweets found`
              }
            </p>
            {filter === 'pending' && (
              <button className="btn btn-primary btn-md">
                <Edit3 className="h-4 w-4 mr-2" />
                Schedule a Tweet
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card text-center">
          <div className="text-2xl font-bold text-blue-600">--</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-green-600">--</div>
          <div className="text-sm text-gray-600">Completed</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-red-600">--</div>
          <div className="text-sm text-gray-600">Failed</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-yellow-600">--</div>
          <div className="text-sm text-gray-600">Cancelled</div>
        </div>
      </div>
    </div>
  );
};

export default Scheduling;
