import React, { useEffect, useState } from 'react';
import {
  Target,
  TrendingUp,
  Users,
  Calendar,
  MessageSquare,
  Star,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { strategy as strategyApi } from '../../utils/api';

const CARD_STYLE = {
  blue: { iconBg: 'bg-blue-100', iconText: 'text-blue-600' },
  indigo: { iconBg: 'bg-indigo-100', iconText: 'text-indigo-600' },
  emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
  amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600' },
};

const InfoCard = ({ icon: Icon, label, value, tone = 'blue' }) => {
  const style = CARD_STYLE[tone] || CARD_STYLE.blue;

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-10 h-10 rounded-lg ${style.iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${style.iconText}`} />
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-1">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
};

const ArrayDisplay = ({ items, icon: Icon, emptyText }) => (
  <div className="flex flex-wrap gap-2">
    {items && items.length > 0 ? (
      items.map((item, idx) => (
        <span
          key={idx}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-lg text-sm font-medium border border-blue-200"
        >
          {Icon && <Icon className="w-3.5 h-3.5" />}
          {item}
        </span>
      ))
    ) : (
      <span className="text-gray-400 text-sm italic">{emptyText}</span>
    )}
  </div>
);

const StrategyOverview = ({ strategy, onGeneratePrompts }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptCount, setPromptCount] = useState(0);

  useEffect(() => {
    loadPromptCount();
  }, [strategy?.id]);

  const loadPromptCount = async () => {
    if (!strategy?.id) return;

    try {
      const response = await strategyApi.getPrompts(strategy.id);
      setPromptCount(Array.isArray(response?.data) ? response.data.length : 0);
    } catch (error) {
      setPromptCount(0);
    }
  };

  const handleGeneratePrompts = async () => {
    setIsGenerating(true);
    try {
      const response = await strategyApi.generatePrompts(strategy.id);
      setPromptCount(response?.data?.count || 0);
      toast.success('Prompt library generated successfully.');
      if (onGeneratePrompts) {
        onGeneratePrompts(response.data);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to generate prompts');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-6 h-6" />
              <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium">Active Strategy</span>
            </div>
            <h2 className="text-3xl font-bold mb-2">{strategy.niche || 'Your Twitter Strategy'}</h2>
            <p className="text-blue-100 text-lg">
              Tailored content strategy for {strategy.target_audience || 'your audience'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            {promptCount === 0 ? (
              <button
                onClick={handleGeneratePrompts}
                disabled={isGenerating}
                className="px-6 py-3 bg-white text-blue-600 rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Prompts
                  </>
                )}
              </button>
            ) : (
              <div className="text-center">
                <div className="text-4xl font-bold">{promptCount}</div>
                <div className="text-sm text-blue-100">Prompts Ready</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard icon={Target} label="Niche" value={strategy.niche || 'Not set'} tone="blue" />
        <InfoCard
          icon={Users}
          label="Target Audience"
          value={strategy.target_audience || 'Not set'}
          tone="indigo"
        />
        <InfoCard
          icon={Calendar}
          label="Posting Frequency"
          value={strategy.posting_frequency || 'Not set'}
          tone="emerald"
        />
        <InfoCard
          icon={MessageSquare}
          label="Tone and Style"
          value={strategy.tone_style || 'Not set'}
          tone="amber"
        />
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Content Goals
        </h3>
        <ArrayDisplay items={strategy.content_goals} icon={Star} emptyText="No goals defined yet" />
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-600" />
          Content Topics
        </h3>
        <ArrayDisplay items={strategy.topics} emptyText="No topics defined yet" />
      </div>

      {promptCount > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-green-600" />
                Ready to Create Content
              </h3>
              <p className="text-gray-600">
                Your prompt library is ready. Start generating tweets from these prompts.
              </p>
            </div>
            <button
              onClick={onGeneratePrompts}
              className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              View Prompts
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyOverview;
