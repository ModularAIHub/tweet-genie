import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Layout,
  Library,
  ArrowLeft,
  Loader2,
  Edit2,
  Trash2,
  Plus,
  AlertCircle,
  Wand2,
} from 'lucide-react';
import ChatInterface from './ChatInterface';
import StrategyOverview from './StrategyOverview';
import PromptLibrary from './PromptLibrary';
import { strategy as strategyApi } from '../../utils/api';

const isReconnectRequiredError = (error) =>
  error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
  error?.response?.data?.reconnect === true;

const STRATEGY_TEMPLATES = [
  {
    name: 'Founder Build in Public',
    description: 'Share product progress, lessons, and customer wins every week.',
  },
  {
    name: 'Niche Expert Growth',
    description: 'Teach one topic deeply and build authority with practical threads.',
  },
  {
    name: 'Creator Audience Engine',
    description: 'Use storytelling plus educational hooks to grow followers.',
  },
];

const StrategyBuilder = () => {
  const [currentView, setCurrentView] = useState('chat');
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);

  useEffect(() => {
    loadStrategy();
  }, []);

  const loadStrategy = async () => {
    try {
      setLoading(true);
      setError(null);
      setIsDisconnected(false);

      const response = await strategyApi.getCurrent();
      const loadedStrategy = response?.data?.strategy;

      if (!loadedStrategy) {
        throw new Error('Strategy payload missing');
      }

      setStrategy(loadedStrategy);

      const basicProfileCompleted = Boolean(loadedStrategy?.metadata?.basic_profile_completed);
      const needsBasicSetup = loadedStrategy.status !== 'active' && !basicProfileCompleted;

      if (needsBasicSetup) {
        setTeamName(loadedStrategy.niche || '');
        setTeamDescription(loadedStrategy.target_audience || '');
        setFormMode('edit');
        setShowCreateForm(true);
        setCurrentView('chat');
        return;
      }

      setShowCreateForm(false);
      setCurrentView(loadedStrategy.status === 'active' ? 'overview' : 'chat');
    } catch (loadError) {
      if (isReconnectRequiredError(loadError)) {
        setIsDisconnected(true);
        setStrategy(null);
        setShowCreateForm(false);
        return;
      }

      if (loadError?.response?.status === 404) {
        setStrategy(null);
        setFormMode('create');
        setShowCreateForm(true);
        return;
      }

      setError('Failed to load Strategy Builder. Please try again.');
      setShowCreateForm(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStrategy = async () => {
    if (!teamName.trim()) {
      setError('Strategy name is required');
      return;
    }

    try {
      setCreatingTeam(true);
      setError(null);
      const basicProfileMetadata = {
        ...(strategy?.metadata || {}),
        basic_profile_completed: true,
        basic_profile_completed_at: new Date().toISOString(),
      };

      let savedStrategy;
      if (formMode === 'edit' && strategy?.id) {
        const response = await strategyApi.update(strategy.id, {
          niche: teamName.trim(),
          target_audience: teamDescription.trim(),
          metadata: basicProfileMetadata,
        });
        savedStrategy = response.data;
      } else {
        const response = await strategyApi.create({
          niche: teamName.trim(),
          target_audience: teamDescription.trim(),
          posting_frequency: '',
          content_goals: [],
          topics: [],
          status: 'draft',
          metadata: basicProfileMetadata,
        });
        savedStrategy = response.data;
      }

      setStrategy(savedStrategy);
      setShowCreateForm(false);
      setTeamName('');
      setTeamDescription('');
      setCurrentView(savedStrategy?.status === 'active' ? 'overview' : 'chat');
    } catch (saveError) {
      if (isReconnectRequiredError(saveError)) {
        setIsDisconnected(true);
        setShowCreateForm(false);
        setError(null);
        return;
      }
      setError(saveError.response?.data?.error || saveError.message || 'Failed to save strategy. Please try again.');
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleChatComplete = (completedStrategy) => {
    setStrategy(completedStrategy);
    setCurrentView('overview');
  };

  const handleEditStrategy = () => {
    setTeamName(strategy?.niche || '');
    setTeamDescription(strategy?.target_audience || '');
    setFormMode('edit');
    setShowCreateForm(true);
  };

  const handleDeleteStrategy = async () => {
    if (!window.confirm('Are you sure you want to delete this strategy? This action cannot be undone.')) {
      return;
    }

    try {
      await strategyApi.delete(strategy.id);
      setStrategy(null);
      setTeamName('');
      setTeamDescription('');
      setFormMode('create');
      setShowCreateForm(true);
      setCurrentView('chat');
    } catch (deleteError) {
      if (isReconnectRequiredError(deleteError)) {
        setIsDisconnected(true);
        setShowCreateForm(false);
        setError(null);
        return;
      }
      setError('Failed to delete strategy');
    }
  };

  const handleCreateNew = () => {
    setTeamName('');
    setTeamDescription('');
    setFormMode('create');
    setShowCreateForm(true);
    setCurrentView('chat');
  };

  const handleGeneratePrompts = () => {
    setCurrentView('prompts');
  };

  const tabs = [
    {
      id: 'chat',
      label: 'Setup',
      icon: MessageSquare,
      visible: strategy?.status !== 'active',
    },
    {
      id: 'overview',
      label: 'Overview',
      icon: Layout,
      visible: strategy !== null,
    },
    {
      id: 'prompts',
      label: 'Prompts',
      icon: Library,
      visible: strategy !== null,
    },
  ].filter((tab) => tab.visible);
  const hasCompletedBasicProfile =
    Boolean(strategy?.metadata?.basic_profile_completed) || strategy?.status === 'active';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading Strategy Builder...</p>
        </div>
      </div>
    );
  }

  if (isDisconnected) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-xl w-full p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Twitter Connection Required</h2>
          <p className="text-gray-600 mb-6">
            Reconnect your Twitter account in Settings to use Strategy Builder.
          </p>
          <a
            href="/settings"
            className="inline-flex items-center justify-center px-5 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  if (showCreateForm) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              {formMode === 'edit' ? 'Edit Strategy' : 'Create Your Strategy'}
            </h1>
            <p className="text-gray-600 text-lg">
              {formMode === 'edit' ? 'Update your strategy details' : 'Set up your Twitter content strategy in under a minute'}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Team / Strategy Name <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Enter your team or strategy name. This is required before setup questions.
              </p>
              <input
                type="text"
                placeholder="e.g., B2B SaaS Growth"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                disabled={creatingTeam}
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">Quick Start Templates (Optional)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {STRATEGY_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => {
                      setTeamName(template.name);
                      setTeamDescription(template.description);
                    }}
                    className="text-left p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1 text-gray-900 font-medium">
                      <Wand2 className="w-4 h-4 text-blue-600" />
                      <span>{template.name}</span>
                    </div>
                    <p className="text-xs text-gray-600">{template.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Description <span className="text-gray-400">(Optional)</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Describe what this strategy is about.
              </p>
              <textarea
                placeholder="e.g., Helping founders grow with clear marketing playbooks"
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={creatingTeam}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                <strong>Next:</strong> You will answer 7 guided questions to define audience, topics, goals, and posting style.
              </p>
            </div>

            <button
              onClick={handleSaveStrategy}
              disabled={!teamName.trim() || creatingTeam}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {creatingTeam ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {formMode === 'edit' ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                <>{formMode === 'edit' ? 'Update Strategy' : 'Continue to Setup Questions'}</>
              )}
            </button>

            {strategy && hasCompletedBasicProfile && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setCurrentView(strategy.status === 'active' ? 'overview' : 'chat');
                }}
                className="w-full py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Failed to Load</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => {
                setError(null);
                loadStrategy();
              }}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                window.location.href = '/dashboard';
              }}
              className="ml-3 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  window.location.href = '/dashboard';
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Strategy Builder</h1>
                <p className="text-sm text-gray-600">
                  {strategy ? strategy.niche : 'Build your personalized Twitter content strategy'}
                </p>
              </div>
            </div>

            {strategy && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleEditStrategy}
                  title="Edit strategy"
                  className="p-2 text-gray-600 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={handleCreateNew}
                  title="Create new strategy"
                  className="p-2 text-gray-600 hover:bg-green-100 hover:text-green-600 rounded-lg transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={handleDeleteStrategy}
                  title="Delete strategy"
                  className="p-2 text-gray-600 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            )}

            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg ml-4">
              <span className="text-sm text-gray-600">Chat: 0.5 credits</span>
              <span className="text-gray-400">|</span>
              <span className="text-sm text-gray-600">Generate Prompts: 10 credits</span>
            </div>
          </div>

          {tabs.length > 1 && (
            <div className="flex gap-1 mt-4 border-b border-gray-200">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = currentView === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setCurrentView(tab.id)}
                    className={`flex items-center gap-2 px-6 py-3 font-medium transition-colors relative ${
                      isActive ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                    {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {!strategy && (
          <div className="flex items-center justify-center h-[calc(100vh-300px)]">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Initializing your strategy...</p>
            </div>
          </div>
        )}

        {currentView === 'chat' && strategy && (
          <div className="max-w-4xl mx-auto h-[calc(100vh-200px)]">
            <ChatInterface strategyId={strategy.id} onComplete={handleChatComplete} />
          </div>
        )}

        {currentView === 'overview' && strategy && (
          <StrategyOverview strategy={strategy} onGeneratePrompts={handleGeneratePrompts} />
        )}

        {currentView === 'prompts' && strategy && <PromptLibrary strategyId={strategy.id} />}
      </div>
    </div>
  );
};

export default StrategyBuilder;
