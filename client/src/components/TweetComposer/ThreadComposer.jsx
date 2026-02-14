import React from 'react';
import { decodeHTMLEntities } from '../../utils/decodeHTMLEntities';
import { Plus, Trash2, Image, X } from 'lucide-react';
import RichTextTextarea from '../RichTextTextarea';

const ThreadComposer = ({
  isThread,
  threadTweets,
  threadImages,
  onThreadToggle,
  onThreadTweetChange,
  onThreadImageUpload,
  onThreadImageRemove,
  onAddTweet,
  onRemoveTweet
}) => {
  return (
    <div className="space-y-4">
      {/* Thread Toggle */}
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={isThread}
          onChange={(e) => onThreadToggle(e.target.checked)}
          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="ml-2 text-sm font-medium text-gray-700">
          Create thread
        </span>
      </label>

      {/* Thread Tweets */}
      {isThread && (
        <div className="space-y-3">
          {/* Show cleanup button if there are separators */}
          {threadTweets.includes('---') && (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  const cleanedTweets = threadTweets.filter(tweet => tweet !== '---');
                  // Update the tweets by calling the parent's change handler for each tweet
                  cleanedTweets.forEach((tweet, index) => {
                    onThreadTweetChange(index, tweet);
                  });
                  // Remove extra tweets if there were separators
                  while (threadTweets.length > cleanedTweets.length) {
                    onRemoveTweet(threadTweets.length - 1);
                  }
                }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Remove all separators
              </button>
            </div>
          )}
          
          {threadTweets.map((tweet, index) => {
            // Check if this is a separator tweet
            const isSeparator = tweet === '---';
            
            // Calculate the tweet number (excluding separators)
            const tweetNumber = threadTweets.slice(0, index + 1).filter(t => t !== '---').length;
            
            return (
              <div key={index} className="flex items-start space-x-2">
                {isSeparator ? (
                  // Separator display
                  <div className="w-full flex items-center">
                    <div className="flex-1 border-t border-gray-300"></div>
                    <span className="px-3 text-xs text-gray-500 bg-gray-50">
                      Next Thread
                    </span>
                    <div className="flex-1 border-t border-gray-300"></div>
                    <button
                      onClick={() => onRemoveTweet(index)}
                      className="ml-2 p-1 text-red-500 hover:text-red-700"
                      title="Remove separator"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium">
                      {tweetNumber}
                    </div>
                    <div className="flex-1">
                      <RichTextTextarea
                        value={decodeHTMLEntities(tweet)}
                        onChange={(nextValue) => onThreadTweetChange(index, nextValue)}
                        placeholder={`Tweet ${tweetNumber}...`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                        rows={3}
                      />
                      
                      {/* Image Upload for this thread tweet */}
                      <div className="mt-2 flex items-center space-x-2">
                        <label className="cursor-pointer flex items-center text-sm text-blue-600 hover:text-blue-800">
                          <Image className="h-4 w-4 mr-1" />
                          Add Image
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => onThreadImageUpload(index, e)}
                          />
                        </label>
                        {threadImages && threadImages[index] && threadImages[index].length > 0 && (
                          <span className="text-xs text-gray-500">
                            {threadImages[index].length} image(s)
                          </span>
                        )}
                      </div>

                      {/* Display uploaded images for this thread tweet */}
                      {threadImages && threadImages[index] && threadImages[index].length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {threadImages[index].map((image, imgIndex) => (
                            <div key={imgIndex} className="relative">
                              <img
                                src={image.preview}
                                alt={`Thread ${tweetNumber} image ${imgIndex + 1}`}
                                className="w-16 h-16 object-cover rounded border"
                              />
                              <button
                                onClick={() => onThreadImageRemove(index, imgIndex)}
                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                                style={{ width: '18px', height: '18px' }}
                              >
                                <X className="h-2 w-2" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="text-xs text-gray-500 mt-1">
                        {280 - tweet.length} characters remaining
                        {tweet.length > 280 && (
                          <span className="text-red-500 ml-2">
                            ({tweet.length - 280} over limit)
                          </span>
                        )}
                      </div>
                    </div>
                    {threadTweets.length > 1 && (
                      <button
                        onClick={() => onRemoveTweet(index)}
                        className="flex-shrink-0 p-1 text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          
          {threadTweets.length < 10 && (
            <button
              onClick={onAddTweet}
              className="flex items-center text-blue-600 hover:text-blue-800"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add tweet to thread
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ThreadComposer;
