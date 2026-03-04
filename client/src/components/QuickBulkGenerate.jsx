import React, { useState, useCallback } from 'react';
import { Sparkles, Plus, Trash2, Zap, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { ai } from '../utils/api';
import toast from 'react-hot-toast';
import RichTextTextarea from './RichTextTextarea';

const MAX_QUICK_PROMPTS = 6;

const EMPTY_PROMPT = () => ({ id: Date.now(), text: '', isThread: false });

const QuickBulkGenerate = ({ onOutputsReady, disabled = false }) => {
  const [prompts, setPrompts] = useState([EMPTY_PROMPT()]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  const addPrompt = useCallback(() => {
    if (prompts.length >= MAX_QUICK_PROMPTS) {
      toast.error(`Maximum ${MAX_QUICK_PROMPTS} prompts for optimal quality`);
      return;
    }
    setPrompts(prev => [...prev, EMPTY_PROMPT()]);
  }, [prompts.length]);

  const removePrompt = useCallback((id) => {
    setPrompts(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const updatePrompt = useCallback((id, field, value) => {
    setPrompts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }, []);

  const validPrompts = prompts.filter(p => p.text.trim().length > 0);

  const handleGenerate = async () => {
    if (validPrompts.length === 0) {
      toast.error('Enter at least one prompt');
      return;
    }

    setGenerating(true);
    setProgress({ current: 0, total: validPrompts.length });
    setResults([]);
    setShowResults(true);

    const newResults = [];

    for (let i = 0; i < validPrompts.length; i++) {
      const prompt = validPrompts[i];
      setProgress({ current: i + 1, total: validPrompts.length });

      try {
        const res = await ai.generate({
          prompt: prompt.text,
          isThread: prompt.isThread,
          clientSource: 'quick_bulk',
        });
        const data = res.data;

        if (prompt.isThread) {
          let threadParts = [];
          if (Array.isArray(data.threadParts) && data.threadParts.length > 0) {
            threadParts = data.threadParts.map(p => String(p).trim()).filter(Boolean);
          } else if (data.content?.includes('---')) {
            threadParts = data.content.split('---').map(t => t.trim()).filter(Boolean);
          } else {
            threadParts = [data.content.trim()];
          }

          newResults.push({
            id: prompt.id,
            prompt: prompt.text,
            isThread: true,
            content: threadParts.join('\n---\n'),
            threadParts,
            error: null,
          });
        } else {
          let text = data.content?.split('---')[0]?.trim() || '';
          if (text.length > 280) text = text.slice(0, 280);
          newResults.push({
            id: prompt.id,
            prompt: prompt.text,
            isThread: false,
            content: text,
            threadParts: null,
            error: null,
          });
        }
      } catch (err) {
        newResults.push({
          id: prompt.id,
          prompt: prompt.text,
          isThread: prompt.isThread,
          content: '',
          threadParts: null,
          error: err?.response?.data?.error || 'Generation failed',
        });
      }

      setResults([...newResults]);
    }

    setGenerating(false);
    toast.success(`Generated ${newResults.filter(r => !r.error).length} of ${validPrompts.length} posts`);

    if (onOutputsReady) {
      onOutputsReady(newResults.filter(r => !r.error));
    }
  };

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-2">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Quick Generate</h2>
              <p className="text-blue-100 text-sm">Up to {MAX_QUICK_PROMPTS} posts for optimal quality & timing</p>
            </div>
          </div>
          <span className="bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full">
            {validPrompts.length}/{MAX_QUICK_PROMPTS}
          </span>
        </div>
      </div>

      {/* Prompt inputs */}
      <div className="p-6 space-y-3">
        {prompts.map((prompt, idx) => (
          <div
            key={prompt.id}
            className="group relative bg-gray-50 rounded-xl border border-gray-200 p-4 transition-all duration-200 hover:border-blue-300 hover:shadow-sm focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200"
          >
            <div className="flex items-start gap-3">
              {/* Number badge */}
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold mt-1">
                {idx + 1}
              </div>

              {/* Input */}
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={prompt.text}
                  onChange={(e) => updatePrompt(prompt.id, 'text', e.target.value)}
                  placeholder={idx === 0 ? "What should this post be about?" : "Add another topic..."}
                  disabled={generating || disabled}
                  className="w-full bg-transparent border-0 p-0 text-gray-900 placeholder-gray-400 focus:ring-0 focus:outline-none text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (prompts.length < MAX_QUICK_PROMPTS) addPrompt();
                    }
                  }}
                />
              </div>

              {/* Thread toggle */}
              <button
                type="button"
                onClick={() => updatePrompt(prompt.id, 'isThread', !prompt.isThread)}
                disabled={generating || disabled}
                className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full transition-all duration-200 ${
                  prompt.isThread
                    ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {prompt.isThread ? '🧵 Thread' : 'Tweet'}
              </button>

              {/* Remove */}
              {prompts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePrompt(prompt.id)}
                  disabled={generating}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Add prompt button */}
        {prompts.length < MAX_QUICK_PROMPTS && (
          <button
            type="button"
            onClick={addPrompt}
            disabled={generating || disabled}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-all duration-200 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add prompt ({prompts.length}/{MAX_QUICK_PROMPTS})
          </button>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || disabled || validPrompts.length === 0}
          className="w-full mt-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3 px-6 rounded-xl font-semibold text-sm shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating {progress.current}/{progress.total}...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate {validPrompts.length} Post{validPrompts.length !== 1 ? 's' : ''}
            </>
          )}
        </button>

        {/* Progress bar */}
        {generating && (
          <div className="space-y-1">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center">
              Generating post {progress.current} of {progress.total}...
            </p>
          </div>
        )}
      </div>

      {/* Results */}
      {showResults && results.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 text-sm">
              Generated Content ({results.filter(r => !r.error).length} posts)
            </h3>
            <button
              onClick={() => setShowResults(!showResults)}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showResults ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          <div className="p-6 space-y-4">
            {results.map((result, idx) => (
              <div
                key={result.id}
                className={`rounded-xl border p-4 transition-all duration-300 ${
                  result.error
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-white hover:shadow-sm'
                }`}
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {result.error ? (
                  <div className="flex items-start gap-2">
                    <span className="text-red-500 text-sm">⚠️</span>
                    <div>
                      <p className="text-sm text-gray-700 font-medium">{result.prompt}</p>
                      <p className="text-xs text-red-600 mt-1">{result.error}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        result.isThread
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {result.isThread ? `🧵 Thread (${result.threadParts?.length || 1} parts)` : 'Tweet'}
                      </span>
                      <span className="text-xs text-gray-400 truncate flex-1">{result.prompt}</span>
                    </div>
                    {result.isThread && result.threadParts ? (
                      <div className="space-y-2">
                        {result.threadParts.map((part, pIdx) => (
                          <div key={pIdx} className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 border border-gray-100">
                            <span className="text-xs text-gray-400 font-medium mr-2">{pIdx + 1}/{result.threadParts.length}</span>
                            {part}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-800 leading-relaxed">{result.content}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {result.isThread ? `${result.threadParts?.length || 1} tweets` : `${result.content.length}/280 chars`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickBulkGenerate;
