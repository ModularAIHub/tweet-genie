
import React, { useState } from 'react';
import { Send, Calendar } from 'lucide-react';
import Modal from './Modal';

const TweetActions = ({
  isThread,
  content,
  threadTweets,
  selectedImages,
  isPosting,
  isScheduling,
  onPost,
  onSchedule
}) => {
  const hasContent = isThread 
    ? threadTweets.some(tweet => tweet.trim().length > 0)
    : content.trim().length > 0;

  const canPost = hasContent || selectedImages.length > 0;

  // Modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [localError, setLocalError] = useState('');
  // Detect user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex space-x-3">
      <button
        onClick={onPost}
        disabled={!canPost || isPosting}
        className="flex-1 flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPosting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Posting...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {isThread ? 'Post Thread' : 'Post Tweet'}
          </>
        )}
      </button>
      
      <button
        onClick={() => setShowScheduleModal(true)}
        disabled={!canPost || isScheduling}
        className="flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isScheduling ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
            Scheduling...
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4 mr-2" />
            Schedule
          </>
        )}
      </button>

      {/* Schedule Modal */}
      <Modal isOpen={showScheduleModal} onClose={() => { setShowScheduleModal(false); setLocalError(''); }}>
        <h2 className="text-lg font-semibold mb-4">Schedule Tweet</h2>
        <label className="block text-sm font-medium text-gray-700 mb-2">Date & Time</label>
        <input
          type="datetime-local"
          value={scheduleDate}
          min={new Date().toISOString().slice(0, 16)}
          onChange={e => setScheduleDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        />
        {localError && <div className="text-red-500 text-sm mb-2">{localError}</div>}
        <div className="flex justify-end space-x-2 mt-4">
          <button
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={() => { setShowScheduleModal(false); setLocalError(''); }}
            disabled={isScheduling}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={async () => {
              if (!scheduleDate) {
                setLocalError('Please select a date and time');
                return;
              }
              setLocalError('');
              // Pass both date and timezone
              await onSchedule(scheduleDate, userTimezone);
              setShowScheduleModal(false);
              setScheduleDate('');
            }}
            disabled={isScheduling}
          >
            {isScheduling ? 'Scheduling...' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default TweetActions;
