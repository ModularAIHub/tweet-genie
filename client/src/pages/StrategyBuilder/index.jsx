import React, { useState, useEffect } from 'react';
import { MessageSquare, Layout, Library, ArrowLeft, Loader2 } from 'lucide-react';
import ChatInterface from './ChatInterface';
import StrategyOverview from './StrategyOverview';
import PromptLibrary from './PromptLibrary';
import { strategy as strategyApi } from '../../utils/api';

const StrategyBuilder = () => {
  const [currentView, setCurrentView] = useState('chat'); // 'chat', 'overview', 'prompts'
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadStrategy();
  }, []);

  const loadStrategy = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('Loading strategy...');
      
      const response = await strategyApi.getCurrent();
      
      console.log('Strategy loaded:', response.data);
      setStrategy(response.data.strategy);
      
      // If strategy is active (completed), show overview
      if (response.data.strategy.status === 'active') {
        setCurrentView('overview');
      }
    } catch (error) {
      console.error('Error loading strategy:', error);
      setError(error.response?.data?.error || error.message || 'Failed to load strategy');
    } finally {
      setLoading(false);
    }
  };

  const handleChatComplete = (completedStrategy) => {
    setStrategy(completedStrategy);
    setCurrentView('overview');
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
      visible: strategy?.status === 'active'
    },
    {
      id: 'prompts',
      label: 'Prompts',
      icon: Library,
      visible: strategy?.status === 'active'
    }
  ].filter(tab => tab.visible);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading Strategy Builder...</p>
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
                <p className="text-sm text-gray-600">Build your personalized Twitter content strategy</p>
              </div>
            </div>

            {/* Credits Info */}
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg">
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
