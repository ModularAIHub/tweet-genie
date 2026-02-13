import React, { useState, useEffect } from 'react';
import { MessageSquare, Layout, Library, ArrowLeft, Loader2, Edit2, Trash2, Plus } from 'lucide-react';
import ChatInterface from './ChatInterface';
import StrategyOverview from './StrategyOverview';
import PromptLibrary from './PromptLibrary';
import { strategy as strategyApi } from '../../utils/api';

const StrategyBuilder = () => {
  const [currentView, setCurrentView] = useState('chat'); // 'chat', 'overview', 'prompts', 'manage'
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // If still loading after 2 seconds, just hide spinner
      setLoading(false);
      console.log('Load timeout - stopping spinner');
    }, 2000);

    loadStrategy();

    return () => clearTimeout(timeoutId);
  }, []);

  const loadStrategy = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('Loading strategy...');
      
      const response = await strategyApi.getCurrent();
      
      console.log('Strategy loaded:', response.data);
      setStrategy(response.data.strategy);
      setShowCreateForm(false);
      
      // If strategy is active (completed), show overview
      if (response.data.strategy.status === 'active') {
        setCurrentView('overview');
      }
    } catch (error) {
      console.error('Error loading strategy:', error);
      // No strategy found, show team name modal
      console.log('No strategy found, showing creation form');
      setStrategy(null);
      setShowCreateForm(true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      setError('Strategy name is required');
      return;
    }

    try {
      setCreatingTeam(true);
      setError(null);
      
      // Check if editing or creating
      if (strategy && showCreateForm) {
        // Editing existing strategy
        console.log('Updating team strategy:', teamName);
        const response = await strategyApi.update(strategy.id, {
          niche: teamName.trim(),
          target_audience: teamDescription.trim(),
        });
        
        console.log('✅ Team strategy updated:', response.data);
        setStrategy(response.data);
      } else {
        // Creating new strategy
        console.log('Creating team strategy:', teamName);
        const response = await strategyApi.create({
          niche: teamName.trim(),
          target_audience: teamDescription.trim(),
          posting_frequency: '',
          content_goals: [],
          topics: [],
          status: 'draft'
        });

        console.log('✅ Team strategy created:', response.data);
        setStrategy(response.data);
      }

      setShowCreateForm(false);
      setTeamName('');
      setTeamDescription('');
      setCurrentView('chat');
    } catch (err) {
      console.error('❌ Error saving strategy:', err);
      setError(err.response?.data?.error || err.message || 'Failed to save strategy. Please try again.');
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleChatComplete = (completedStrategy) => {
    console.log('🎉 handleChatComplete called with strategy:', completedStrategy);
    setStrategy(completedStrategy);
    setCurrentView('overview');
    console.log('📊 View switched to overview');
  };

  const handleEditStrategy = () => {
    setTeamName(strategy.niche || '');
    setTeamDescription(strategy.target_audience || '');
    setShowCreateForm(true);
  };

  const handleDeleteStrategy = async () => {
    if (!window.confirm('Are you sure you want to delete this strategy? This action cannot be undone.')) {
      return;
    }

    try {
      await strategyApi.delete(strategy.id);
      setStrategy(null);
      setShowCreateForm(true);
      setTeamName('');
      setTeamDescription('');
    } catch (err) {
      setError('Failed to delete strategy');
      console.error('Delete error:', err);
    }
  };

  const handleCreateNew = () => {
    setTeamName('');
    setTeamDescription('');
    setShowCreateForm(true);
  };

  const handleGeneratePrompts = () => {
    setCurrentView('prompts');
  };

  const tabs = [
    {
      id: 'chat',
      label: 'Setup',
      icon: MessageSquare,
      visible: strategy?.status !== 'active'
    },
    {
      id: 'overview',
      label: 'Overview',
      icon: Layout,
      visible: strategy !== null
    },
    {
      id: 'prompts',
      label: 'Prompts',
      icon: Library,
      visible: strategy !== null
    }
  ].filter(tab => tab.visible);

  console.log('📊 Tabs available:', tabs.map(t => t.label));

  // Show team name modal if creating
  if (showCreateForm) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              {strategy ? '✏️ Edit Strategy' : '📊 Create Your Strategy'}
            </h1>
            <p className="text-gray-600 text-lg">
              {strategy ? 'Update your strategy details' : "Let's set up your Twitter content strategy"}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* Team Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Strategy Name <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Give your strategy a meaningful name. This represents your main content focus.
              </p>
              <input
                type="text"
                placeholder="e.g., B2B SaaS Growth, AI Tools & Tips, Fitness Coaching"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                disabled={creatingTeam}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Description <span className="text-gray-400">(Optional)</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Brief description of what your strategy is about.
              </p>
              <textarea
                placeholder="e.g., Helping early-stage startups scale their business through practical SaaS insights"
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={creatingTeam}
              />
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                ℹ️ <strong>What happens next:</strong> You'll be guided through 7 quick questions to define your audience, posting schedule, and content goals.
              </p>
            </div>

            {/* Button */}
            <button
              onClick={handleCreateTeam}
              disabled={!teamName.trim() || creatingTeam}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {creatingTeam ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {strategy ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                <>
                  {strategy ? '💾 Update Strategy' : '✨ Next: Answer Questions'}
                </>
              )}
            </button>
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
              <span className="text-3xl">⚠️</span>
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
              onClick={() => window.location.href = '/dashboard'}
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
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Strategy Builder</h1>
                <p className="text-sm text-gray-600">
                  {strategy ? `📌 ${strategy.niche}` : 'Build your personalized Twitter content strategy'}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
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

            {/* Credits Info */}
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg ml-4">
              <span className="text-sm text-gray-600">Chat: 0.5 credits</span>
              <span className="text-gray-400">•</span>
              <span className="text-sm text-gray-600">Generate Prompts: 10 credits</span>
            </div>
          </div>

          {/* Tabs */}
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
                      isActive
                        ? 'text-blue-600'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                    {isActive && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {!strategy && currentView !== 'manage' && (
          <div className="flex items-center justify-center h-[calc(100vh-300px)]">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Initializing your strategy...</p>
            </div>
          </div>
        )}

        {currentView === 'chat' && strategy && (
          <div className="max-w-4xl mx-auto h-[calc(100vh-200px)]">
            <ChatInterface
              strategyId={strategy.id}
              onComplete={handleChatComplete}
            />
          </div>
        )}

        {currentView === 'overview' && strategy && (
          <StrategyOverview
            strategy={strategy}
            onGeneratePrompts={handleGeneratePrompts}
          />
        )}

        {currentView === 'prompts' && strategy && (
          <PromptLibrary strategyId={strategy.id} />
        )}
      </div>
    </div>
  );
};

export default StrategyBuilder;
