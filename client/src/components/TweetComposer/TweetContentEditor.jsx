import React from 'react';
import RichTextTextarea from '../RichTextTextarea';

const TweetContentEditor = ({
  content,
  setContent,
  isThread,
  characterCount,
  charLimit = 280,
}) => {
  return (
    <div className="space-y-4">
      {/* Content Editor - Only for single tweets */}
      {!isThread && (
        <div>
          <RichTextTextarea
            value={content}
            onChange={setContent}
            placeholder="What's happening?"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none text-base leading-relaxed"
            rows={8}
            style={{ minHeight: '200px' }}
          />
          <div className="flex justify-between items-center mt-2">
            <span className={`text-sm font-medium ${characterCount > charLimit ? 'text-red-500' : 'text-gray-500'}`}>
              {characterCount}/{charLimit} characters
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TweetContentEditor;
