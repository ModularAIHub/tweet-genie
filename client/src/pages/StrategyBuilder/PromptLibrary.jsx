import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Star,
  Search,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  CheckCircle2,
  Square,
  CheckSquare,
  Send,
  Loader2,
  Plus,
  Trash2,
  X,
  Zap,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

const STRATEGY_GENERATED_PROMPTS_KEY_PREFIX = 'strategyGeneratedPrompts:';
const BULK_GENERATION_SEED_KEY = 'bulkGenerationSeed';

const parseVariables = (variables) => {
  if (!variables) return {};
  if (typeof variables === 'object') return variables;
  if (typeof variables === 'string') {
    try {
      const parsed = JSON.parse(variables);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const cleanPromptText = (value = '') =>
  String(value || '')
    .replace(/`{1,3}/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\(\d+\)(?=\s|$)/g, '')
    .replace(/^prompt\s+[^:]{1,50}\s+prompt:\s*/i, '')
    .replace(/^(educational|engagement|storytelling|tips(?:\s*&\s*|\s+and\s+)tricks|promotional|inspirational)\s*prompt:\s*/i, '')
    .replace(/^prompt\s*:\s*/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const mergePromptWithInstruction = (
  promptText,
  instructionText,
  { singleLine = false } = {}
) => {
  const cleanedPrompt = cleanPromptText(promptText);
  const cleanedInstruction = cleanPromptText(instructionText);
  const instruction =
    cleanedInstruction && cleanedInstruction.toLowerCase() !== cleanedPrompt.toLowerCase()
      ? cleanedInstruction
      : '';

  if (!instruction) return cleanedPrompt;

  if (singleLine) {
    return `${cleanedPrompt} Instruction: ${instruction}`.replace(/\s+/g, ' ').trim();
  }

  return `${cleanedPrompt}\n\nInstruction: ${instruction}`;
};

const normalizeFreeformContext = (value = '') =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, 2000);

const buildStructuredStrategyPrompt = (prompt, strategyId, strategyExtraContext = '') => {
  const variables = parseVariables(prompt?.variables);
  const cleanedIdea = cleanPromptText(prompt?.prompt_text || '');
  const instruction = typeof variables.instruction === 'string' ? cleanPromptText(variables.instruction) : '';
  const recommendedFormat =
    typeof variables.recommended_format === 'string'
      ? variables.recommended_format.trim().toLowerCase()
      : 'single_tweet';
  const goal = typeof variables.goal === 'string' ? cleanPromptText(variables.goal) : '';
  const hashtagsHint =
    typeof variables.hashtags_hint === 'string' ? cleanPromptText(variables.hashtags_hint) : '';
  const mergedPromptText = mergePromptWithInstruction(cleanedIdea, instruction, { singleLine: false });
  const legacySingleLinePrompt = mergePromptWithInstruction(cleanedIdea, instruction, { singleLine: true });

  return {
    mergedPromptText,
    legacySingleLinePrompt,
    isThread: recommendedFormat === 'thread',
    strategyPrompt: {
      strategyId,
      promptId: prompt?.id,
      idea: cleanedIdea,
      instruction,
      category: prompt?.category || 'general',
      recommendedFormat,
      goal,
      hashtagsHint,
      extraContext: normalizeFreeformContext(strategyExtraContext),
    },
  };
};

const PromptLibrary = ({ strategyId, strategyExtraContext = '', fromAnalysis = false, onPromptsLoaded }) => {
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copiedId, setCopiedId] = useState(null);
  const [selectedPromptIds, setSelectedPromptIds] = useState([]);
  const [generatedPromptIds, setGeneratedPromptIds] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [customIdeaText, setCustomIdeaText] = useState('');
  const [isAddingIdea, setIsAddingIdea] = useState(false);
  const [deletingPromptId, setDeletingPromptId] = useState(null);
  const [isRefreshingMetrics, setIsRefreshingMetrics] = useState(false);
  
  // Detect if we're in generating mode
  const [isGenerating, setIsGenerating] = useState(fromAnalysis && prompts.length === 0);
  const pollIntervalRef = useRef(null);

  // Update generating state when fromAnalysis prop changes
  useEffect(() => {
    if (fromAnalysis && prompts.length === 0) {
      setIsGenerating(true);
    }
  }, [fromAnalysis, prompts.length]);

  // Initial load
  useEffect(() => {
    loadPrompts();
  }, [strategyId]);
  
  // Start polling if generating
  useEffect(() => {
    if (!isGenerating) return;
    
    const startPolling = () => {
      pollIntervalRef.current = setInterval(async () => {
        const response = await strategyApi.getPrompts(strategyId).catch(() => null);
        const newPrompts = Array.isArray(response?.data) ? response.data : [];
        if (newPrompts.length > 0) {
          setPrompts(newPrompts);
        }
      }, 3000);
    };

    startPolling();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [strategyId, isGenerating]);

  // Stop generating when prompts arrive
  useEffect(() => {
    if (prompts.length > 0 && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      setIsGenerating(false);
      
      // Notify parent that prompts loaded
      if (onPromptsLoaded) {
        onPromptsLoaded();
      }
    }
  }, [prompts, onPromptsLoaded]);
  
  // Timeout fallback after 60 seconds
  useEffect(() => {
    if (!isGenerating) return;
    
    const timeout = setTimeout(() => {
      setIsGenerating(false);
      if (prompts.length === 0) {
        toast.error('Prompt generation is taking longer than expected. Please refresh the page.');
      }
      // Notify parent even on timeout
      if (onPromptsLoaded) {
        onPromptsLoaded();
      }
    }, 60000);
    
    return () => clearTimeout(timeout);
  }, [isGenerating, prompts.length, onPromptsLoaded]);

  useEffect(() => {
    if (!strategyId) return;
    try {
      const raw = localStorage.getItem(`${STRATEGY_GENERATED_PROMPTS_KEY_PREFIX}${strategyId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      setGeneratedPromptIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setGeneratedPromptIds([]);
    }
  }, [strategyId]);

  useEffect(() => {
    setSelectedPromptIds((prev) => {
      const validIds = new Set(prompts.map((prompt) => prompt.id));
      return prev.filter((id) => validIds.has(id));
    });
  }, [prompts]);

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

  const handleRefreshMetrics = async () => {
    try {
      setIsRefreshingMetrics(true);
      const response = await strategyApi.refreshPromptMetrics(strategyId, { lookbackDays: 30 });
      if (Array.isArray(response?.data?.prompts)) {
        setPrompts(response.data.prompts);
      } else {
        await loadPrompts();
      }
      toast.success('Prompt performance refreshed from synced analytics.');
    } catch (error) {
      toast.error('Failed to refresh prompt performance');
    } finally {
      setIsRefreshingMetrics(false);
    }
  };

  const handleAddCustomIdea = async () => {
    if (!customIdeaText.trim() || customIdeaText.trim().length < 5) {
      toast.error('Please enter at least 5 characters for your idea.');
      return;
    }
    setIsAddingIdea(true);
    try {
      const response = await strategyApi.createPrompt(strategyId, { prompt_text: customIdeaText.trim() });
      if (response?.data) {
        setPrompts((prev) => [response.data, ...prev]);
        toast.success('Your idea has been added to the library!');
        setCustomIdeaText('');
        setShowAddForm(false);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add your idea');
    } finally {
      setIsAddingIdea(false);
    }
  };

  const handleDeletePrompt = async (promptId) => {
    if (!window.confirm('Delete this prompt from your library?')) return;
    setDeletingPromptId(promptId);
    try {
      await strategyApi.deletePrompt(promptId);
      setPrompts((prev) => prev.filter((p) => p.id !== promptId));
      setSelectedPromptIds((prev) => prev.filter((id) => id !== promptId));
      toast.success('Prompt deleted.');
    } catch (error) {
      toast.error('Failed to delete prompt');
    } finally {
      setDeletingPromptId(null);
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

  const categoryCounts = useMemo(
    () =>
      prompts.reduce((acc, prompt) => {
        const key = prompt.category || 'general';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [prompts]
  );

  const promptStats = useMemo(() => {
    const usedCount = prompts.filter((prompt) => Number(prompt.usage_count) > 0).length;
    const favoriteCount = prompts.filter((prompt) => Boolean(prompt.is_favorite)).length;
    const generatedCount = prompts.filter((prompt) => generatedPromptIds.includes(prompt.id)).length;
    const contentCount = prompts.reduce((sum, p) => sum + Number(p.content_generated_count || 0), 0);
    return {
      total: prompts.length,
      used: usedCount,
      favorites: favoriteCount,
      generated: generatedCount,
      contentItems: contentCount,
    };
  }, [prompts, generatedPromptIds]);

  const filteredPrompts = useMemo(
    () =>
      prompts.filter((prompt) => {
        const searchableText = cleanPromptText(prompt.prompt_text);
        const matchesSearch = searchableText
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesCategory =
          selectedCategory === 'all' || prompt.category === selectedCategory;
        return matchesSearch && matchesCategory;
      }),
    [prompts, searchTerm, selectedCategory]
  );

  const starterPromptIds = useMemo(() => {
    const preferredOrder = [
      'educational',
      'engagement',
      'storytelling',
      'tips & tricks',
      'promotional',
      'inspirational',
    ];

    const picked = [];
    const usedIds = new Set();

    for (const category of preferredOrder) {
      const match = prompts.find((prompt) => prompt.category === category);
      if (match && !usedIds.has(match.id)) {
        picked.push(match.id);
        usedIds.add(match.id);
      }
    }

    if (picked.length < 6) {
      for (const prompt of prompts) {
        if (usedIds.has(prompt.id)) {
          continue;
        }
        picked.push(prompt.id);
        usedIds.add(prompt.id);
        if (picked.length >= 6) {
          break;
        }
      }
    }

    return picked;
  }, [prompts]);

  const persistGeneratedIds = (ids) => {
    if (!strategyId) return;
    localStorage.setItem(
      `${STRATEGY_GENERATED_PROMPTS_KEY_PREFIX}${strategyId}`,
      JSON.stringify(ids)
    );
  };

  const markPromptGenerated = (promptId) => {
    setGeneratedPromptIds((prev) => {
      if (prev.includes(promptId)) return prev;
      const next = [...prev, promptId];
      persistGeneratedIds(next);
      return next;
    });
  };

  const togglePromptSelection = (promptId) => {
    setSelectedPromptIds((prev) =>
      prev.includes(promptId) ? prev.filter((id) => id !== promptId) : [...prev, promptId]
    );
  };

  const selectedPromptCount = selectedPromptIds.length;

  const handleSelectVisible = () => {
    setSelectedPromptIds((prev) => {
      const merged = new Set(prev);
      for (const prompt of filteredPrompts) {
        merged.add(prompt.id);
      }
      return Array.from(merged);
    });
  };

  const handleClearSelection = () => {
    setSelectedPromptIds([]);
  };

  const handleSelectStarterSet = () => {
    if (starterPromptIds.length === 0) {
      toast.error('No prompts available to select.');
      return;
    }

    setSelectedPromptIds(starterPromptIds);
    toast.success(`Selected ${starterPromptIds.length} starter prompts.`);
  };

  const handleSendSelectedToBulk = () => {
    const selectedPrompts = prompts.filter((prompt) => selectedPromptIds.includes(prompt.id));
    if (selectedPrompts.length === 0) {
      toast.error('Select at least one prompt first.');
      return;
    }

    const seed = {
      version: 2,
      strategyId,
      source: 'strategy_library',
      generatedAt: new Date().toISOString(),
      items: selectedPrompts.map((prompt) => {
        const structured = buildStructuredStrategyPrompt(prompt, strategyId, strategyExtraContext);

        return {
          id: prompt.id, // legacy key
          promptId: prompt.id,
          prompt: structured.legacySingleLinePrompt, // legacy v1 compatibility
          legacyPromptText: structured.legacySingleLinePrompt,
          idea: structured.strategyPrompt.idea,
          instruction: structured.strategyPrompt.instruction,
          isThread: structured.isThread,
          category: structured.strategyPrompt.category,
          recommendedFormat: structured.strategyPrompt.recommendedFormat,
          goal: structured.strategyPrompt.goal,
          hashtagsHint: structured.strategyPrompt.hashtagsHint,
          extraContext: structured.strategyPrompt.extraContext,
        };
      }),
    };

    localStorage.setItem(BULK_GENERATION_SEED_KEY, JSON.stringify(seed));
    navigate('/bulk-generation', {
      state: {
        bulkGenerationSeed: seed,
      },
    });
  };

  const handleGeneratePrompt = (prompt) => {
    const structured = buildStructuredStrategyPrompt(prompt, strategyId, strategyExtraContext);

    const payload = {
      version: 2,
      id: prompt.id,
      text: structured.mergedPromptText, // legacy display fallback
      category: structured.strategyPrompt.category,
      source: 'strategy_library',
      recommendedFormat: structured.strategyPrompt.recommendedFormat,
      generatedAt: new Date().toISOString(),
      strategyPrompt: {
        ...structured.strategyPrompt,
      },
    };

    // Backward compatible fallback for older compose flows
    localStorage.setItem('composerPrompt', structured.mergedPromptText);
    localStorage.setItem('composerPromptPayload', JSON.stringify(payload));
    markPromptGenerated(prompt.id);

    navigate('/compose', {
      state: {
        composerPromptPayload: payload,
        autoOpenAIPanel: true,
      },
    });
  };

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

  // Show generating state when redirected from analysis flow
  if (isGenerating && prompts.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
          <div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Generating your personalized prompts...
            </h3>
            <p className="text-gray-600">
              This may take up to 60 seconds. Your prompts will appear automatically when ready.
            </p>
          </div>
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
      <div className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-indigo-600" />
              Prompt Library
            </h2>
            <p className="text-gray-600 mt-1">
              Browse, filter, and send ideas to Composer instantly.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Refresh uses analytics already synced in Tweet Genie (no extra X API fetches).
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleRefreshMetrics}
              disabled={isRefreshingMetrics}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-blue-200 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-60"
            >
              {isRefreshingMetrics ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Refresh performance
            </button>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-gray-900">{promptStats.total}</span> total
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-green-700">{promptStats.used}</span> used
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-amber-700">{promptStats.favorites}</span> favorites
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-emerald-700">{promptStats.generated}</span> generated
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-violet-700">{promptStats.contentItems}</span> content items
            </div>
          </div>
        </div>
      </div>

      {/* Add your own ideas banner */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        {!showAddForm ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-emerald-900">
              <span className="font-semibold">Have your own content ideas?</span>{' '}
              Add them to your library and use them alongside AI-generated prompts.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex-shrink-0 ml-3"
            >
              <Plus className="w-4 h-4" />
              Add Idea
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-emerald-900">Add your own content idea</p>
              <button onClick={() => { setShowAddForm(false); setCustomIdeaText(''); }} className="text-emerald-600 hover:text-emerald-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={customIdeaText}
              onChange={(e) => setCustomIdeaText(e.target.value.slice(0, 500))}
              placeholder={`Type your content idea... e.g., "Talk about why most founders ignore churn until it's too late and what to do instead"`}
              rows={3}
              className="w-full px-4 py-3 border border-emerald-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none bg-white"
              autoFocus
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-emerald-600">{customIdeaText.length}/500 — Category will be auto-assigned</p>
              <button
                onClick={handleAddCustomIdea}
                disabled={isAddingIdea || customIdeaText.trim().length < 5}
                className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {isAddingIdea ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {isAddingIdea ? 'Adding...' : 'Save Idea'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        Beginner flow: 1) Select Starter Set 2) Send To Bulk 3) Generate all drafts 4) Schedule in one batch.
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 flex items-start gap-3">
        <Zap className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-violet-900">
          <span className="font-semibold">Content Queue uses these prompts.</span>{' '}
          When you use "Generate Week&apos;s Content", prompts from this library are automatically selected
          (least-used first). The more prompts you have, the more varied your content.
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">{selectedPromptCount}</span> selected for bulk workflow
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSelectStarterSet}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100"
          >
            <Sparkles className="w-4 h-4" />
            Select Starter Set
          </button>
          <button
            type="button"
            onClick={handleSelectVisible}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckSquare className="w-4 h-4" />
            Select Visible
          </button>
          <button
            type="button"
            onClick={handleClearSelection}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Square className="w-4 h-4" />
            Clear
          </button>
          <button
            type="button"
            onClick={handleSendSelectedToBulk}
            disabled={selectedPromptCount === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Send To Bulk
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-wrap items-start">
        <div className="flex-1 min-w-[280px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search prompts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
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
              {category === 'all' ? 'All' : `${CATEGORY_ICON[category] || 'Prompt'} ${category.charAt(0).toUpperCase() + category.slice(1)}`}
              {category !== 'all' && (
                <span className="ml-2 text-xs opacity-80">({categoryCounts[category] || 0})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="text-sm text-gray-600">
        Showing <span className="font-semibold text-gray-900">{filteredPrompts.length}</span> prompt
        {filteredPrompts.length === 1 ? '' : 's'}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPrompts.map((prompt) => {
          const categoryClass = CATEGORY_STYLE[prompt.category] || 'bg-gray-100 text-gray-700';
          const variables = parseVariables(prompt.variables);
          const cleanedPrompt = cleanPromptText(prompt.prompt_text);
          const postedCount = Number(prompt.posted_count || 0);
          const avgEngagementRate = Number(prompt.avg_engagement_rate || 0);
          const instructionRaw =
            typeof variables.instruction === 'string' ? cleanPromptText(variables.instruction) : '';
          const instruction =
            instructionRaw && instructionRaw.toLowerCase() !== cleanedPrompt.toLowerCase()
              ? instructionRaw
              : '';
          const hasGenerated = generatedPromptIds.includes(prompt.id) || Number(prompt.usage_count) > 0;
          const isSelected = selectedPromptIds.includes(prompt.id);

          return (
            <div
              key={prompt.id}
              className={`bg-white rounded-2xl p-5 border hover:border-blue-200 hover:shadow-lg transition-all group relative ${
                isSelected ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'
              }`}
            >
              {hasGenerated && (
                <div className="absolute -top-3 -right-3 bg-green-500 rounded-full p-2 shadow-lg border-4 border-white">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
              )}

              <button
                type="button"
                onClick={() => togglePromptSelection(prompt.id)}
                className="absolute top-4 left-4 text-gray-500 hover:text-blue-600"
                title={isSelected ? 'Unselect prompt' : 'Select prompt'}
              >
                {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
              </button>

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

              <div className="flex items-center gap-2 mb-3 mt-6">
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${categoryClass}`}
                >
                  <span>{CATEGORY_ICON[prompt.category] || 'Prompt'}</span>
                  <span className="capitalize">{prompt.category || 'general'}</span>
                </div>
                {variables.source === 'user_custom' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                    My Idea
                  </span>
                )}
              </div>

              <p className="text-gray-800 leading-relaxed mb-4 min-h-[96px] line-clamp-4">{cleanedPrompt}</p>

              {instruction && (
                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Instruction</p>
                  <p className="text-xs text-blue-900 line-clamp-3">{instruction}</p>
                </div>
              )}

              {(prompt.usage_count > 0 ||
                Number(prompt.content_generated_count) > 0 ||
                postedCount > 0 ||
                avgEngagementRate > 0) && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {prompt.usage_count > 0 && (
                    <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Used {prompt.usage_count} {prompt.usage_count === 1 ? 'time' : 'times'}
                    </div>
                  )}
                  {Number(prompt.content_generated_count) > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-2 py-1 rounded-lg font-medium">
                      <FileText className="w-3.5 h-3.5" />
                      {prompt.content_generated_count} {Number(prompt.content_generated_count) === 1 ? 'tweet' : 'tweets'} generated
                    </div>
                  )}
                  {postedCount > 0 && (
                    <div className="text-xs text-sky-700 font-medium bg-sky-50 px-2 py-1 rounded-lg">
                      {postedCount} posted
                    </div>
                  )}
                  {avgEngagementRate > 0 && (
                    <div className="text-xs text-indigo-700 font-medium bg-indigo-50 px-2 py-1 rounded-lg">
                      {avgEngagementRate.toFixed(2)}% avg engagement
                    </div>
                  )}
                  {prompt.performance_score > 0 && (
                    <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-lg">
                      {prompt.performance_score}% performance
                    </span>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => copyPrompt(cleanedPrompt, prompt.id)}
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
                  onClick={() => handleGeneratePrompt(prompt)}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Generate</span>
                </button>
                <button
                  onClick={() => handleDeletePrompt(prompt.id)}
                  disabled={deletingPromptId === prompt.id}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete prompt"
                >
                  {deletingPromptId === prompt.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
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
