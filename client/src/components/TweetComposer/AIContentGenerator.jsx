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
  <div className="shadow-lg border border-blue-100 rounded-2xl p-6 mb-6 bg-gradient-to-br from-blue-50 via-white to-blue-100">
  <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Sparkles className="h-6 w-6 text-blue-500 mr-2 animate-pulse" />
          <h3 className="font-semibold text-blue-900 text-lg tracking-tight">AI Content Generator</h3>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600 text-2xl font-bold px-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
          title="Close"
        >
          ×
        </button>
      </div>
      
  <div className="space-y-5">
        <div>
          <label className="block text-base font-semibold text-blue-900 mb-2">
            What would you like to tweet about?
          </label>
          <textarea
            value={localPrompt}
            onChange={handlePromptChange}
            onBlur={handlePromptBlur}
            placeholder="e.g., Share tips about productivity, Write about latest tech trends..."
            className="w-full px-4 py-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-base bg-white/80 transition-all resize-none min-h-[60px]"
            rows={Math.max(3, localPrompt.split('\n').length)}
            style={{ minHeight: '60px', height: 'auto', overflow: 'hidden' }}
            onInput={e => {
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
          />
          <div className="mt-2 text-xs text-blue-700">
            💡 For multiple threads, try: <span className="font-medium">"Generate 5 threads about top anime moments"</span> or <span className="font-medium">"Create 3 threads about productivity tips"</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            💰 <span className="font-medium">Credit cost:</span> 1.2 credits per thread generated
          </div>
        </div>
        
        <div>
          <label className="block text-base font-semibold text-blue-900 mb-2">
            Style
          </label>
          <select
            value={aiStyle}
            onChange={(e) => setAiStyle(e.target.value)}
            className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-base bg-white/80"
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
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-xl shadow-lg font-semibold text-base hover:from-blue-600 hover:to-blue-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></span>
              Generating...
            </>
          ) : (
            <>
              <ArrowRight className="h-5 w-5 mr-1" />
              Generate Content
            </>
          )}
        </button>
      {/* Progress bar for loading */}
      {isGenerating && (
        <div className="mt-4 w-full">
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-2 bg-blue-400 animate-pulse rounded-full w-2/3 transition-all"></div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default AIContentGenerator;
