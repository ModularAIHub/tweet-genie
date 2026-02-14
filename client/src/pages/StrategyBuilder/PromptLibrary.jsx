import React, { useEffect, useMemo, useState } from 'react';
import { Star, Search, Sparkles, Copy, Check, ExternalLink, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { strategy as strategyApi } from '../../utils/api';

const CATEGORY_STYLE = {
  educational: 'bg-blue-100 text-blue-700',
  engagement: 'bg-indigo-100 text-indigo-700',
  storytelling: 'bg-pink-100 text-pink-700',
  'tips & tricks': 'bg-green-100 text-green-700',
  promotional: 'bg-amber-100 text-amber-700',
  inspirational: 'bg-violet-100 text-violet-700',
};

const CATEGORY_ICON = {
  educational: 'Book',
  engagement: 'Chat',
  storytelling: 'Story',
  'tips & tricks': 'Tips',
  promotional: 'Promo',
  inspirational: 'Inspire',
};

const PromptLibrary = ({ strategyId }) => {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    loadPrompts();
  }, [strategyId]);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      const response = await strategyApi.getPrompts(strategyId);
      setPrompts(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      toast.error('Failed to load prompts');
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (promptId) => {
    try {
      await strategyApi.toggleFavorite(promptId);
      setPrompts((prev) =>
        prev.map((prompt) =>
          prompt.id === promptId ? { ...prompt, is_favorite: !prompt.is_favorite } : prompt
        )
      );
    } catch (error) {
      toast.error('Failed to update favorite');
    }
  };

  const copyPrompt = async (promptText, promptId) => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedId(promptId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      toast.error('Copy failed. Please copy manually.');
    }
  };

  const categories = useMemo(
    () => ['all', ...new Set(prompts.map((prompt) => prompt.category).filter(Boolean))],
    [prompts]
  );

  const filteredPrompts = useMemo(
    () =>
      prompts.filter((prompt) => {
        const matchesSearch = prompt.prompt_text
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesCategory =
          selectedCategory === 'all' || prompt.category === selectedCategory;
        return matchesSearch && matchesCategory;
      }),
    [prompts, searchTerm, selectedCategory]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600">Loading prompts...</p>
        </div>
      </div>
    );
  }

  if (prompts.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-10 h-10 text-gray-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No prompts yet</h3>
        <p className="text-gray-600 mb-6">
          Generate your prompt library from Strategy Overview to start creating content faster.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-indigo-600" />
            Prompt Library
          </h2>
          <p className="text-gray-600 mt-1">{filteredPrompts.length} prompts available</p>
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[300px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search prompts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                selectedCategory === category
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category === 'all'
                ? 'All'
                : `${CATEGORY_ICON[category] || 'Prompt'} ${
                    category.charAt(0).toUpperCase() + category.slice(1)
                  }`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPrompts.map((prompt) => {
          const categoryClass = CATEGORY_STYLE[prompt.category] || 'bg-gray-100 text-gray-700';

          return (
            <div
              key={prompt.id}
              className="bg-white rounded-xl p-5 border border-gray-200 hover:shadow-lg transition-all group relative"
            >
              {prompt.usage_count > 0 && (
                <div className="absolute -top-3 -right-3 bg-green-500 rounded-full p-2 shadow-lg border-4 border-white">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
              )}

              <button
                onClick={() => toggleFavorite(prompt.id)}
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Star
                  className={`w-5 h-5 ${
                    prompt.is_favorite
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-400 hover:text-yellow-400'
                  }`}
                />
              </button>

              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold mb-3 ${categoryClass}`}
              >
                <span>{CATEGORY_ICON[prompt.category] || 'Prompt'}</span>
                <span className="capitalize">{prompt.category || 'general'}</span>
              </div>

              <p className="text-gray-800 leading-relaxed mb-4 line-clamp-4">{prompt.prompt_text}</p>

              {prompt.usage_count > 0 && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Used {prompt.usage_count} {prompt.usage_count === 1 ? 'time' : 'times'}
                  </div>
                  {prompt.performance_score > 0 && (
                    <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-lg">
                      {prompt.performance_score}% performance
                    </span>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => copyPrompt(prompt.prompt_text, prompt.id)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {copiedId === prompt.id ? (
                    <>
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-green-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('composerPrompt', prompt.prompt_text);
                    window.location.href = '/compose';
                  }}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Generate</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredPrompts.length === 0 && prompts.length > 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No prompts match your search criteria</p>
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('all');
            }}
            className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
};

export default PromptLibrary;
