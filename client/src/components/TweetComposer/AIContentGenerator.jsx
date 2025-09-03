import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';

const AIContentGenerator = ({
  showAIPrompt,
  aiPrompt,
  setAiPrompt,
  aiStyle,
  setAiStyle,
  isGenerating,
  onGenerate,
  onCancel
}) => {
  // Local state for unrestricted input
  const [localPrompt, setLocalPrompt] = useState(aiPrompt || '');

  // Sync with parent state when it changes externally
  useEffect(() => {
    setLocalPrompt(aiPrompt || '');
  }, [aiPrompt]);

  // Handle local input changes without sanitization
  const handlePromptChange = (e) => {
    const value = e.target.value;
    setLocalPrompt(value);
    // Only update parent state when user stops typing or submits
  };

  // Handle blur to sync with parent (this applies sanitization)
  const handlePromptBlur = () => {
    setAiPrompt(localPrompt);
  };

  // Handle generate button click
  const handleGenerate = () => {
    setAiPrompt(localPrompt); // Ensure latest value is synced
    onGenerate();
  };

  if (!showAIPrompt) return null;

  return (
    <div className="border border-blue-200 rounded-lg p-4 mb-4 bg-blue-50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <Sparkles className="h-5 w-5 text-blue-600 mr-2" />
          <h3 className="font-medium text-blue-900">AI Content Generator</h3>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>
      
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            What would you like to tweet about?
          </label>
          <textarea
            value={localPrompt}
            onChange={handlePromptChange}
            onBlur={handlePromptBlur}
            placeholder="e.g., Share tips about productivity, Write about latest tech trends..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
          />
          <div className="mt-1 text-xs text-blue-600">
            💡 For multiple threads, try: "Generate 5 threads about top anime moments" or "Create 3 threads about productivity tips"
          </div>
          <div className="mt-1 text-xs text-gray-500">
            💰 Credit cost: 1.2 credits per thread generated
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Style
          </label>
          <select
            value={aiStyle}
            onChange={(e) => setAiStyle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="casual">Casual</option>
            <option value="professional">Professional</option>
            <option value="humorous">Humorous</option>
            <option value="inspirational">Inspirational</option>
            <option value="informative">Informative</option>
          </select>
        </div>
        
        <button
          onClick={handleGenerate}
          disabled={!localPrompt.trim() || isGenerating}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Generating...
            </>
          ) : (
            <>
              <ArrowRight className="h-4 w-4 mr-2" />
              Generate Content
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default AIContentGenerator;
