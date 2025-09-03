import React from 'react';
import { Sparkles, Wand2 } from 'lucide-react';

const TweetContentEditor = ({
  content,
  setContent,
  isThread,
  characterCount,
  onAIButtonClick,
  onImageButtonClick,
  showAIPrompt,
  showImagePrompt
}) => {
  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      <div className="flex items-center space-x-2">
        <button
          onClick={onAIButtonClick}
          className={`btn btn-sm ${showAIPrompt ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {showAIPrompt ? 'Cancel AI' : 'AI Generate'}
        </button>
        
        <button
          onClick={onImageButtonClick}
          className={`btn btn-sm ${showImagePrompt ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Wand2 className="h-4 w-4 mr-1" />
          {showImagePrompt ? 'Cancel' : 'AI Image'}
        </button>
      </div>

      {/* Content Editor */}
      {!isThread && (
        <div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's happening?"
            className="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            rows={4}
          />
          <div className="flex justify-between items-center mt-2">
            <span className={`text-sm ${characterCount > 280 ? 'text-red-500' : 'text-gray-500'}`}>
              {characterCount}/280 characters
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TweetContentEditor;
