import React from 'react';
import PropTypes from 'prop-types';

const TweetContentEditor = ({ content, setContent, isThread, characterCount, onAIButtonClick, onImageButtonClick, showAIPrompt, showImagePrompt }) => {
  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="text-lg font-semibold mb-2">Compose Tweet</h3>
      <textarea
        className="w-full border rounded p-2 mb-2"
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={isThread ? 'Compose thread...' : 'Compose tweet...'}
        rows={4}
      />
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">Characters: {characterCount}</span>
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-blue-500 text-white rounded" onClick={onAIButtonClick}>AI</button>
          <button className="px-3 py-1 bg-green-500 text-white rounded" onClick={onImageButtonClick}>Image</button>
        </div>
      </div>
      {/* Optionally show AI/Image prompts */}
      {showAIPrompt && <div className="text-xs text-blue-700">AI prompt active</div>}
      {showImagePrompt && <div className="text-xs text-green-700">Image prompt active</div>}
    </div>
  );
};

TweetContentEditor.propTypes = {
  content: PropTypes.string,
  setContent: PropTypes.func,
  isThread: PropTypes.bool,
  characterCount: PropTypes.number,
  onAIButtonClick: PropTypes.func,
  onImageButtonClick: PropTypes.func,
  showAIPrompt: PropTypes.bool,
  showImagePrompt: PropTypes.bool,
};

export default TweetContentEditor;
