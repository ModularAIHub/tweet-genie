import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';

const SchedulingPanel = ({
  scheduledFor,
  setScheduledFor,
  scheduledTweets,
  isLoadingScheduled,
  onRefreshScheduled,
  onCancelScheduled
}) => {
  const formatDateTime = (dateTime) => {
    return new Date(dateTime).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Schedule Tweet
        </h3>
      </div>

      {/* Date/Time Picker */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Schedule for
        </label>
        <input
          type="datetime-local"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          min={new Date().toISOString().slice(0, 16)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Scheduled Tweets List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-gray-900">Scheduled Tweets</h4>
          <button
            onClick={onRefreshScheduled}
            disabled={isLoadingScheduled}
            className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingScheduled ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {!scheduledTweets || !Array.isArray(scheduledTweets) || scheduledTweets.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No scheduled tweets
            </p>
          ) : (
            scheduledTweets.map((tweet) => (
              <div
                key={tweet.id}
                className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <p className="text-sm text-gray-800 mb-2 line-clamp-2">
                  {tweet.content}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    {formatDateTime(tweet.scheduled_for)}
                  </span>
                  <button
                    onClick={() => onCancelScheduled(tweet.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SchedulingPanel;
