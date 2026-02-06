import React from 'react';
import PropTypes from 'prop-types';

const AIContentGenerator = ({ showAIPrompt, aiPrompt, setAiPrompt, aiStyle, setAiStyle, isGenerating, onGenerate, onCancel }) => {
  if (!showAIPrompt) return null;

  return (
    <div className="p-4 bg-blue-50 rounded shadow mb-4">
      <h4 className="font-semibold mb-2">AI Content Generator</h4>
      <input
        className="w-full border rounded p-2 mb-2"
        value={aiPrompt}
        onChange={e => setAiPrompt(e.target.value)}
        placeholder="Enter AI prompt..."
      />
      <input
        className="w-full border rounded p-2 mb-2"
        value={aiStyle}
        onChange={e => setAiStyle(e.target.value)}
        placeholder="Style (optional)"
      />
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={onGenerate} disabled={isGenerating}>
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
        <button className="px-4 py-2 bg-gray-300 text-black rounded" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

AIContentGenerator.propTypes = {
  showAIPrompt: PropTypes.bool,
  aiPrompt: PropTypes.string,
  setAiPrompt: PropTypes.func,
  aiStyle: PropTypes.string,
  setAiStyle: PropTypes.func,
  isGenerating: PropTypes.bool,
  onGenerate: PropTypes.func,
  onCancel: PropTypes.func,
};

export default AIContentGenerator;
