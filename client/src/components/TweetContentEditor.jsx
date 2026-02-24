import React from 'react';
import PropTypes from 'prop-types';

const TweetContentEditor = ({
  content,
  setContent,
  isThread,
  characterCount,
  charLimit = 280,
  onAIButtonClick,
  onImageButtonClick,
  showAIPrompt,
  showImagePrompt,
}) => {
  const isOverLimit = characterCount > charLimit;
  const isNearLimit = !isOverLimit && characterCount > charLimit * 0.9;

  const counterColor = isOverLimit
    ? 'text-red-500 font-semibold'
    : isNearLimit
    ? 'text-amber-500'
    : 'text-gray-500';

  return (
    <div className="space-y-2">
      <textarea
        className={`w-full border rounded-lg p-3 resize-none focus:outline-none focus:ring-2 transition-colors ${
          isOverLimit
            ? 'border-red-400 focus:ring-red-300'
            : 'border-gray-300 focus:ring-blue-300'
        }`}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={isThread ? 'Compose your thread...' : "What's happening?"}
        rows={6}
      />
      <div className="flex items-center justify-between">
        <span className={`text-sm ${counterColor}`}>
          {characterCount}/{charLimit} characters
        </span>
        {isOverLimit && (
          <span className="text-xs text-red-500">
            {characterCount - charLimit} characters over limit
          </span>
        )}
      </div>
    </div>
  );
};

TweetContentEditor.propTypes = {
  content: PropTypes.string,
  setContent: PropTypes.func,
  isThread: PropTypes.bool,
  characterCount: PropTypes.number,
  charLimit: PropTypes.number,
  onAIButtonClick: PropTypes.func,
  onImageButtonClick: PropTypes.func,
  showAIPrompt: PropTypes.bool,
  showImagePrompt: PropTypes.bool,
};

export default TweetContentEditor;
