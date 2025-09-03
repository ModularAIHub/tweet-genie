import React from 'react';
import { Send, Calendar } from 'lucide-react';

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
        onClick={onSchedule}
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
    </div>
  );
};

export default TweetActions;
