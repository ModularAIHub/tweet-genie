import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Loader2,
  CheckCircle2,
  Edit2,
  Target,
  TrendingUp,
  MessageCircle,
  Users,
  Calendar,
  Sparkles,
  ArrowRight,
  X,
  Zap,
  BookOpen,
} from 'lucide-react';
import { profileAnalysis as analysisApi, strategy as strategyApi } from '../../utils/api';

const GOALS_OPTIONS = [
  { id: 'authority', label: 'Build authority', icon: Target, emoji: '🎯' },
  { id: 'followers', label: 'Grow followers', icon: TrendingUp, emoji: '📈' },
  { id: 'engagement', label: 'Drive engagement', icon: MessageCircle, emoji: '💬' },
  { id: 'leads', label: 'Generate leads', icon: Zap, emoji: '💰' },
  { id: 'educate', label: 'Educate audience', icon: BookOpen, emoji: '🎓' },
  { id: 'community', label: 'Build community', icon: Users, emoji: '🤝' },
];

// Pre-built suggestions based on common niches — keyed by keyword match
const NICHE_SUGGESTIONS = [
  'SaaS / Software', 'Indie Hacker / Builder', 'AI / Machine Learning', 'Web Development',
  'DevOps / Cloud', 'Mobile Development', 'Cybersecurity', 'Data Science',
  'Creator Economy', 'Design / UI/UX', 'Marketing / Growth', 'E-commerce',
  'Fintech', 'EdTech', 'Health & Fitness Tech', 'Gaming / Game Dev',
  'Crypto / Web3', 'Open Source', 'Startup Founder', 'Freelance Developer',
];

const AUDIENCE_SUGGESTIONS = [
  'Indie hackers & solopreneurs', 'Software developers', 'Startup founders', 
  'Product managers', 'Tech Twitter community', 'SaaS users & buyers',
  'Junior developers', 'Senior engineers', 'Non-technical founders',
  'Digital marketers', 'Content creators', 'Freelancers & consultants',
  'DevOps engineers', 'Data engineers', 'Students & learners',
  'Small business owners', 'Growth hackers', 'Designer developers',
];

const TONE_SUGGESTIONS = [
  { label: 'Casual & conversational', emoji: '💬' },
  { label: 'Professional & informative', emoji: '📋' },
  { label: 'Witty & humorous', emoji: '😄' },
  { label: 'Direct & no-nonsense', emoji: '🎯' },
  { label: 'Inspirational & motivating', emoji: '🔥' },
  { label: 'Educational & helpful', emoji: '📚' },
  { label: 'Build-in-public storytelling', emoji: '🏗️' },
  { label: 'Technical & detailed', emoji: '🔧' },
];

const ANALYSIS_STEPS = [
  { key: 'connected', label: 'Connected to your Twitter account' },
  { key: 'tweets', label: 'Reading your tweet history' },
  { key: 'analysing', label: 'Analysing your niche and audience' },
  { key: 'trending', label: "Finding what's trending in your space" },
];

const AnalysisFlow = ({ strategyId, onComplete, onCancel }) => {
  const [phase, setPhase] = useState('welcome'); // welcome | loading | confirm | reference | generating | done
  const [analysisId, setAnalysisId] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [trendingTopics, setTrendingTopics] = useState([]);
  const [tweetsAnalysed, setTweetsAnalysed] = useState(0);
  const [confidence, setConfidence] = useState('low');
  const [confidenceReason, setConfidenceReason] = useState('');
  const [loadingSteps, setLoadingSteps] = useState({});
  const [confirmStep, setConfirmStep] = useState(0);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [selectedGoals, setSelectedGoals] = useState([]);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [referenceHandles, setReferenceHandles] = useState(['', '']);
  const [referenceResults, setReferenceResults] = useState([]);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [userContext, setUserContext] = useState('');
  const [deeperUrl, setDeeperUrl] = useState('');
  const [deeperContext, setDeeperContext] = useState('');
  const [discoveries, setDiscoveries] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [confirmStep, phase]);

  // ─── Welcome Screen ─────────────────────────────────────────────────
  if (phase === 'welcome') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Welcome to Strategy Builder</h2>
          <p className="text-gray-600 mb-8">
            I'll analyse your Twitter account and build your personalised content strategy.
          </p>
          
          <div className="space-y-3 mt-6 mb-6 text-left">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Your website or portfolio link
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://yoursite.com"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Helps us understand your product before building your strategy</p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700">
                Anything else you want us to know?
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                placeholder="Your target customer, what makes you different, anything relevant..."
                value={userContext}
                onChange={(e) => setUserContext(e.target.value.slice(0, 300))}
                rows={2}
                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">{userContext.length}/300</p>
            </div>
          </div>
          
          <div className="flex justify-center">
            <button
              onClick={() => startAnalysis()}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              <Search className="w-5 h-5" />
              Analyse my account
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">Uses 5 credits for analysis + 10 for prompt generation</p>
        </div>
      </div>
    );
  }

  // ─── Loading Screen ──────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Analysing your account...</h2>
          
          {/* Show what's being analyzed */}
          {(portfolioUrl || userContext) && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-900 mb-2">Analyzing:</p>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>✓ Your Twitter history</li>
                {portfolioUrl && <li>✓ Your portfolio/website</li>}
                {userContext && <li>✓ Your provided context</li>}
              </ul>
            </div>
          )}

          {/* Show discoveries as they happen */}
          {discoveries.length > 0 && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg animate-fade-in">
              <p className="text-sm font-medium text-green-900 mb-3">🔍 Discovering your vibe...</p>
              <div className="space-y-2">
                {discoveries.map((discovery, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-start gap-3 text-sm text-green-800 animate-slide-in"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <span className="text-xl flex-shrink-0">{discovery.emoji}</span>
                    <span className="leading-relaxed">{discovery.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Show analysis summary after discoveries complete */}
          {loadingSteps.analysing === 'done' && analysisData && (
            <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg animate-fade-in">
              <p className="text-sm font-medium text-purple-900 mb-3">✨ Analysis complete!</p>
              <div className="space-y-2 text-sm text-purple-800">
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Niche:</span>
                  <span className="flex-1">{analysisData.niche}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Audience:</span>
                  <span className="flex-1">{analysisData.audience}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Topics:</span>
                  <span className="flex-1">{(analysisData.top_topics || []).slice(0, 3).join(', ')}{(analysisData.top_topics || []).length > 3 ? ` +${(analysisData.top_topics || []).length - 3} more` : ''}</span>
                </div>
              </div>
            </div>
          )}
          
          <div className="space-y-4">
            {ANALYSIS_STEPS.map((step) => {
              const status = loadingSteps[step.key];
              return (
                <div key={step.key} className="flex items-center gap-3">
                  {status === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  ) : status === 'loading' ? (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0" />
                  )}
                  <span className={`text-sm ${status === 'done' ? 'text-gray-900 font-medium' : status === 'loading' ? 'text-blue-700' : 'text-gray-400'}`}>
                    {step.label}
                    {step.key === 'tweets' && tweetsAnalysed > 0 ? ` (${tweetsAnalysed} tweets found)` : ''}
                  </span>
                </div>
              );
            })}
          </div>
          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
              <button onClick={() => startAnalysis()} className="block mt-2 text-red-600 underline font-medium">
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Generating Prompts Screen ───────────────────────────────────────
  if (phase === 'generating') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Generating your prompt library...</h2>
          <p className="text-gray-600 text-sm mb-4">Creating 30+ personalised tweet prompts from your analysis</p>
          
          {generatedCount > 0 && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-900">
                Generated {generatedCount} prompts so far...
              </p>
              <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((generatedCount / 36) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Done Screen ─────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Strategy ready!</h2>
          <p className="text-gray-600 mb-2">{generatedCount} prompts generated and saved.</p>
          <p className="text-sm text-gray-500 mb-6">Your Overview tab shows the full summary. Prompts tab is ready to use.</p>
          <button
            onClick={() => onComplete?.()}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            View my strategy
          </button>
        </div>
      </div>
    );
  }

  // ─── Confirmation Flow ───────────────────────────────────────────────
  const confirmSteps = [
    {
      key: 'niche',
      title: 'Your niche',
      description: portfolioUrl || userContext 
        ? 'Based on your Twitter activity, portfolio, and context:'
        : 'Based on your Twitter activity, your niche looks like:',
      value: analysisData?.niche || '',
      badge: `Based on ${tweetsAnalysed} tweets analysed${portfolioUrl ? ' + portfolio' : ''}${userContext ? ' + your context' : ''}`,
    },
    {
      key: 'audience',
      title: 'Your audience',
      description: 'Your content seems targeted at:',
      value: analysisData?.audience || '',
    },
    {
      key: 'tone',
      title: 'Your writing style',
      description: 'Your writing style comes across as:',
      value: analysisData?.tone || '',
    },
    {
      key: 'goals',
      title: 'Your goals',
      description: "What do you want to achieve on Twitter?",
      type: 'goals',
    },
    {
      key: 'topics',
      title: 'Your topics',
      description: 'Based on your tweets, you post most about:',
      type: 'topics',
    },
    {
      key: 'posting_frequency',
      title: 'Posting schedule',
      description: tweetsAnalysed > 5
        ? 'Based on your tweet history:'
        : 'We don\'t have enough tweet history yet — pick a schedule that works for you:',
      type: 'posting_schedule',
      value: `${analysisData?.posting_frequency || '3-5 times per week'}\nBest on ${(analysisData?.best_days || ['Tuesday', 'Thursday']).join(' and ')} (${analysisData?.best_hours || '9am-11am'})`,
    },
  ];

  const currentConfirmStep = confirmSteps[confirmStep] || null;

  // ─── Reference Accounts Phase ────────────────────────────────────────
  if (phase === 'reference') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-2">Want to go deeper?</h3>
          <p className="text-gray-600 text-sm mb-6">
            Add up to 2 Twitter accounts you want to learn from — competitors or creators in your niche you respect.
          </p>
          <div className="space-y-3 mb-6">
            {referenceHandles.map((handle, idx) => (
              <input
                key={idx}
                type="text"
                placeholder={`@handle (optional)`}
                value={handle}
                onChange={(e) => {
                  const next = [...referenceHandles];
                  let val = e.target.value.trim();
                  // Extract username from URLs like https://x.com/user or https://twitter.com/user
                  const urlMatch = val.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:@)?([a-zA-Z0-9_]+)/i);
                  if (urlMatch) {
                    val = urlMatch[1];
                  } else {
                    val = val.replace(/[^a-zA-Z0-9_@]/g, '');
                  }
                  next[idx] = val;
                  setReferenceHandles(next);
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            ))}
          </div>

          <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Additional context (optional)</p>
            <input
              type="url"
              placeholder="Any other website to include in analysis..."
              value={deeperUrl}
              onChange={(e) => setDeeperUrl(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="Anything else to consider when deepening your strategy..."
              value={deeperContext}
              onChange={(e) => setDeeperContext(e.target.value.slice(0, 300))}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-xs text-gray-400">{deeperContext.length}/300</p>
          </div>

          {referenceResults.length > 0 && (
            <div className="space-y-4 mb-6">
              {referenceResults.map((ref, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-gray-900">{ref.handle}</span>
                    {ref.followers && <span className="text-xs text-gray-500">{ref.followers.toLocaleString()} followers</span>}
                  </div>
                  {ref.error ? (
                    <p className="text-sm text-red-600">{ref.error}</p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-700 mb-2">{ref.key_takeaway}</p>
                      {ref.content_angles?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 mb-1">Content angles</p>
                          <div className="flex flex-wrap gap-1">
                            {ref.content_angles.map((angle, i) => (
                              <span key={i} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full">{angle}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {ref.what_works?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 mb-1">What works for them</p>
                          <div className="flex flex-wrap gap-1">
                            {ref.what_works.map((w, i) => (
                              <span key={i} className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">{w}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {ref.gaps_you_can_fill?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Gaps you can fill</p>
                          <div className="flex flex-wrap gap-1">
                            {ref.gaps_you_can_fill.map((g, i) => (
                              <span key={i} className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded-full">{g}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            {referenceHandles.some((h) => h.trim()) && referenceResults.length === 0 && (
              <button
                onClick={handleAnalyseReferences}
                disabled={isAnalysing}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isAnalysing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Analysing...</>
                ) : (
                  <><Search className="w-4 h-4" /> Analyse these accounts</>
                )}
              </button>
            )}
            <button
              onClick={handleGeneratePrompts}
              disabled={isGenerating}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold transition-colors ${
                referenceResults.length > 0 || !referenceHandles.some((h) => h.trim())
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Starting generation...</>
              ) : (
                <>
                  {referenceResults.length > 0 || !referenceHandles.some((h) => h.trim())
                    ? 'Generate my content'
                    : 'Skip — generate my content'}
                </>
              )}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    );
  }

  // ─── Confirmation Steps ──────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center gap-2">
        {confirmSteps.map((_, idx) => (
          <div
            key={idx}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              idx < confirmStep ? 'bg-green-500' : idx === confirmStep ? 'bg-blue-500' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Completed steps summary */}
      {confirmStep > 0 && (
        <div className="space-y-2">
          {confirmSteps.slice(0, confirmStep).map((step, idx) => (
            <div key={step.key} className="flex items-center gap-3 bg-green-50 rounded-lg px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-800 font-medium">{step.title}:</span>
              <span className="text-sm text-green-700 truncate">
                {step.type === 'goals'
                  ? selectedGoals.map((g) => GOALS_OPTIONS.find((o) => o.id === g)?.label).filter(Boolean).join(', ')
                  : step.type === 'topics'
                  ? (analysisData?.top_topics || []).join(', ')
                  : step.value?.split('\n')[0]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Current step */}
      {currentConfirmStep && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <p className="text-sm text-gray-500 mb-1">Step {confirmStep + 1} of {confirmSteps.length}</p>
          <h3 className="text-lg font-bold text-gray-900 mb-1">{currentConfirmStep.title}</h3>
          <p className="text-gray-600 text-sm mb-4">{currentConfirmStep.description}</p>

          {/* Goals step — multi select */}
          {currentConfirmStep.type === 'goals' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {GOALS_OPTIONS.map((goal) => (
                <button
                  key={goal.id}
                  onClick={() => {
                    setSelectedGoals((prev) =>
                      prev.includes(goal.id) ? prev.filter((g) => g !== goal.id) : [...prev, goal.id]
                    );
                  }}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    selectedGoals.includes(goal.id)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <span className="text-lg">{goal.emoji}</span>
                  <p className="text-sm font-medium text-gray-900 mt-1">{goal.label}</p>
                </button>
              ))}
            </div>
          )}

          {/* Topics step — with trending */}
          {currentConfirmStep.type === 'topics' && (
            <div className="space-y-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Your top topics:</p>
                <div className="flex flex-wrap gap-2">
                  {(analysisData?.top_topics || []).map((topic, idx) => (
                    <span
                      key={idx}
                      onClick={() => {
                        setSelectedTopics((prev) =>
                          prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
                        );
                      }}
                      className={`px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors ${
                        !selectedTopics.includes(topic)
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : 'bg-gray-100 text-gray-400 line-through border border-gray-200'
                      }`}
                    >
                      👉 {topic}
                    </span>
                  ))}
                </div>
              </div>

              {trendingTopics.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">🔥 Trending in your niche — click to add:</p>
                  <div className="space-y-2">
                    {trendingTopics.map((trend, idx) => {
                      const isAdded = (analysisData?.top_topics || []).includes(trend.topic);
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            if (!isAdded) {
                              setAnalysisData((prev) => ({
                                ...prev,
                                top_topics: [...(prev?.top_topics || []), trend.topic],
                              }));
                            }
                          }}
                          disabled={isAdded}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            isAdded
                              ? 'bg-green-50 border-green-200 opacity-70'
                              : 'bg-orange-50 border-orange-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-800">
                              {isAdded ? '✓' : '+'} {trend.topic}
                            </span>
                            {trend.relevance && (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                trend.relevance === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                              }`}>{trend.relevance}</span>
                            )}
                          </div>
                          {trend.context && <p className="text-xs text-gray-500 mt-1">{trend.context}</p>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a custom topic..."
                  value={customTopicInput}
                  onChange={(e) => setCustomTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customTopicInput.trim()) {
                      const newTopic = customTopicInput.trim();
                      if (!analysisData?.top_topics?.includes(newTopic)) {
                        setAnalysisData((prev) => ({
                          ...prev,
                          top_topics: [...(prev?.top_topics || []), newTopic],
                        }));
                      }
                      setCustomTopicInput('');
                    }
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    if (customTopicInput.trim()) {
                      const newTopic = customTopicInput.trim();
                      if (!analysisData?.top_topics?.includes(newTopic)) {
                        setAnalysisData((prev) => ({
                          ...prev,
                          top_topics: [...(prev?.top_topics || []), newTopic],
                        }));
                      }
                      setCustomTopicInput('');
                    }
                  }}
                  className="px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Posting schedule step — presets + custom edit */}
          {currentConfirmStep.type === 'posting_schedule' && (
            <div className="space-y-4 mb-4">
              {/* Current value display */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-blue-900 font-medium whitespace-pre-line">
                  👉 {currentConfirmStep.value}
                </p>
                {tweetsAnalysed > 5 && (
                  <p className="text-xs text-blue-600 mt-2">Based on your {tweetsAnalysed} tweets</p>
                )}
              </div>

              {/* Preset options */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Quick presets:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: '1-2 times per week', days: 'Tuesday and Thursday', hours: '10am-12pm', desc: 'Low effort, consistent' },
                    { label: '3-5 times per week', days: 'Tuesday and Thursday', hours: '9am-11am', desc: 'Balanced growth' },
                    { label: 'Daily', days: 'Every day', hours: '9am-10am', desc: 'Maximum reach' },
                    { label: '2x daily', days: 'Every day', hours: '9am & 6pm', desc: 'Aggressive growth' },
                  ].map((preset) => {
                    const presetValue = `${preset.label}\nBest on ${preset.days} (${preset.hours})`;
                    const isSelected = currentConfirmStep.value === presetValue;
                    return (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setAnalysisData((prev) => ({
                            ...prev,
                            posting_frequency: preset.label,
                            best_days: preset.days.split(' and ').map(d => d.replace('Every day', 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday').split(',')).flat().map(d => d.trim()),
                            best_hours: preset.hours,
                          }));
                        }}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                            : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900">{preset.label}</p>
                        <p className="text-xs text-gray-500">{preset.desc} — {preset.days} ({preset.hours})</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom edit */}
              {editing === 'posting_frequency' ? (
                <div className="space-y-3">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={3}
                    placeholder="e.g. 3-5 times per week&#10;Best on Tuesday and Thursday (9am-11am)"
                    className="w-full px-4 py-3 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmEdit('posting_frequency', editValue)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditing('posting_frequency');
                    setEditValue(currentConfirmStep.value || '');
                  }}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Write your own schedule
                </button>
              )}
            </div>
          )}

          {/* Text-based steps (niche, audience, tone) */}
          {!currentConfirmStep.type && (
            <div className="mb-4">
              {editing === currentConfirmStep.key ? (
                <div className="space-y-3">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoFocus
                  />

                  {/* Niche suggestions */}
                  {currentConfirmStep.key === 'niche' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Or pick one:</p>
                      <div className="flex flex-wrap gap-2">
                        {NICHE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.niche || '').toLowerCase())
                          .slice(0, 12)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => setEditValue(s)}
                              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                                editValue === s
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Audience suggestions */}
                  {currentConfirmStep.key === 'audience' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Or pick one:</p>
                      <div className="flex flex-wrap gap-2">
                        {AUDIENCE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.audience || '').toLowerCase())
                          .slice(0, 12)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => setEditValue(s)}
                              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                                editValue === s
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Tone suggestions */}
                  {currentConfirmStep.key === 'tone' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Or pick a style:</p>
                      <div className="flex flex-wrap gap-2">
                        {TONE_SUGGESTIONS.map((s) => (
                          <button
                            key={s.label}
                            onClick={() => setEditValue(s.label)}
                            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                              editValue === s.label
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                          >
                            {s.emoji} {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmEdit(currentConfirmStep.key, editValue)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-blue-900 font-medium whitespace-pre-line">
                      👉 {currentConfirmStep.value}
                    </p>
                    {currentConfirmStep.badge && (
                      <p className="text-xs text-blue-600 mt-2">{currentConfirmStep.badge}</p>
                    )}
                  </div>

                  {/* Quick alternatives for niche */}
                  {currentConfirmStep.key === 'niche' && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-2">Not quite right? Pick a closer match:</p>
                      <div className="flex flex-wrap gap-2">
                        {NICHE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.niche || '').toLowerCase())
                          .slice(0, 8)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setAnalysisData((prev) => ({ ...prev, niche: s }));
                                handleQuickConfirm('niche', s);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Quick alternatives for audience */}
                  {currentConfirmStep.key === 'audience' && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-2">Not quite right? Pick a closer match:</p>
                      <div className="flex flex-wrap gap-2">
                        {AUDIENCE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.audience || '').toLowerCase())
                          .slice(0, 8)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setAnalysisData((prev) => ({ ...prev, audience: s }));
                                handleQuickConfirm('audience', s);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Quick alternatives for tone */}
                  {currentConfirmStep.key === 'tone' && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-2">Or switch to:</p>
                      <div className="flex flex-wrap gap-2">
                        {TONE_SUGGESTIONS
                          .filter((s) => s.label.toLowerCase() !== (analysisData?.tone || '').toLowerCase())
                          .map((s) => (
                            <button
                              key={s.label}
                              onClick={() => {
                                setAnalysisData((prev) => ({ ...prev, tone: s.label }));
                                handleQuickConfirm('tone', s.label);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                            >
                              {s.emoji} {s.label}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {editing !== currentConfirmStep?.key && editing !== 'posting_frequency' && (
            <div className="flex gap-3">
              {currentConfirmStep.type === 'goals' ? (
                <button
                  onClick={() => handleConfirmGoals()}
                  disabled={selectedGoals.length === 0}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm ({selectedGoals.length} selected)
                </button>
              ) : currentConfirmStep.type === 'topics' ? (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleConfirmTopics('all')}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Use all of these
                  </button>
                  <button
                    onClick={() => handleConfirmTopics('custom')}
                    className="px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              ) : currentConfirmStep.type === 'posting_schedule' ? (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleConfirmStep()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Yes that's right
                  </button>
                </div>
              ) : (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleConfirmStep()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Yes that's right
                  </button>
                  <button
                    onClick={() => {
                      setEditing(currentConfirmStep.key);
                      setEditValue(currentConfirmStep.value || '');
                    }}
                    className="px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      )}

      <div ref={scrollRef} />
    </div>
  );

  // ─── Handler Functions ───────────────────────────────────────────────
  async function startAnalysis() {
    setPhase('loading');
    setError(null);
    setLoadingSteps({ connected: 'done', tweets: 'loading' });
    setDiscoveries([]);

    // Prepare discoveries based on user context with humor
    const prepareDiscoveries = () => {
      const foundDiscoveries = [];
      
      if (userContext) {
        const lowerContext = userContext.toLowerCase();
        
        // Sports detection with humor - be more specific
        if (lowerContext.includes('basketball')) {
          foundDiscoveries.push({ emoji: '🏀', text: 'Basketball fan spotted! Hope your tweets are as smooth as your crossovers' });
        }
        if (lowerContext.includes('cricket')) {
          foundDiscoveries.push({ emoji: '🏏', text: 'Cricket enthusiast detected! Your content strategy is about to hit a six' });
        }
        if (lowerContext.includes('football') || lowerContext.includes('soccer')) {
          foundDiscoveries.push({ emoji: '⚽', text: 'Football lover? Your Twitter game is about to be world-class' });
        }
        if ((lowerContext.includes('sport') || lowerContext.includes('athlete')) && foundDiscoveries.length === 0) {
          foundDiscoveries.push({ emoji: '🏃', text: 'Sports enthusiast! Your content is about to be championship-level' });
        }
        
        // Anime detection
        if (lowerContext.includes('anime') || lowerContext.includes('manga')) {
          foundDiscoveries.push({ emoji: '🎌', text: 'Anime fan? Nice. Your Twitter arc is about to get interesting' });
        }
        
        // Builder/developer detection
        if (lowerContext.includes('suitegenie')) {
          foundDiscoveries.push({ emoji: '🧞', text: 'Building SuiteGenie? Bold. We respect the hustle' });
        } else if (lowerContext.includes('build') || lowerContext.includes('building')) {
          foundDiscoveries.push({ emoji: '🛠️', text: 'Building in public? Brave move. We like your style' });
        }
        
        if (lowerContext.includes('developer') || lowerContext.includes('engineer') || lowerContext.includes('code') || lowerContext.includes('programming')) {
          foundDiscoveries.push({ emoji: '💻', text: 'Developer spotted! Your tweets will compile better than your code (probably)' });
        } else if (lowerContext.includes('saas') || lowerContext.includes('startup')) {
          foundDiscoveries.push({ emoji: '🚀', text: 'SaaS founder? Impressive. Now let\'s make your Twitter as scalable as your product' });
        }
        
        // History & politics
        if (lowerContext.includes('history') || lowerContext.includes('historical')) {
          foundDiscoveries.push({ emoji: '📚', text: 'History buff detected. Your tweets are about to make history too' });
        }
        if (lowerContext.includes('politics') || lowerContext.includes('political')) {
          foundDiscoveries.push({ emoji: '🗳️', text: 'Politics? Brave. We\'ll keep your content strategy less controversial than your takes' });
        }
        
        // Tech detection
        if (lowerContext.includes('ai') || lowerContext.includes('ml') || lowerContext.includes('machine learning')) {
          foundDiscoveries.push({ emoji: '🤖', text: 'AI enthusiast using AI to grow on Twitter. Meta. We love it' });
        } else if (lowerContext.includes('tech') || lowerContext.includes('technology')) {
          foundDiscoveries.push({ emoji: '💡', text: 'Tech enthusiast confirmed. Your feed is about to be fire' });
        }
        
        // Gaming
        if (lowerContext.includes('game') || lowerContext.includes('gaming') || lowerContext.includes('gamer')) {
          foundDiscoveries.push({ emoji: '🎮', text: 'Gamer detected! Time to level up your Twitter game' });
        }
        
        // CTF / Security
        if (lowerContext.includes('ctf') || lowerContext.includes('security') || lowerContext.includes('hacking')) {
          foundDiscoveries.push({ emoji: '🔐', text: 'Security enthusiast? Your content strategy is locked and loaded' });
        }
        
        // Music
        if (lowerContext.includes('music') || lowerContext.includes('musician')) {
          foundDiscoveries.push({ emoji: '🎵', text: 'Music lover? Your content strategy is about to hit all the right notes' });
        }
        
        // Food
        if (lowerContext.includes('food') || lowerContext.includes('cooking') || lowerContext.includes('chef')) {
          foundDiscoveries.push({ emoji: '👨‍🍳', text: 'Foodie alert! We\'re cooking up something special for your feed' });
        }
        
        // Fitness
        if (lowerContext.includes('fitness') || lowerContext.includes('gym') || lowerContext.includes('workout')) {
          foundDiscoveries.push({ emoji: '💪', text: 'Fitness enthusiast? Your Twitter gains are about to be massive' });
        }
        
        // Travel
        if (lowerContext.includes('travel') || lowerContext.includes('traveler')) {
          foundDiscoveries.push({ emoji: '✈️', text: 'Wanderlust detected! Your content is about to take your audience places' });
        }
        
        // Photography
        if (lowerContext.includes('photo') || lowerContext.includes('camera')) {
          foundDiscoveries.push({ emoji: '📸', text: 'Photographer spotted! Your tweets will be picture-perfect' });
        }
        
        // Design
        if (lowerContext.includes('design') || lowerContext.includes('ui') || lowerContext.includes('ux')) {
          foundDiscoveries.push({ emoji: '🎨', text: 'Designer? Your content strategy is about to look gorgeous' });
        }
        
        // Indian context
        if (lowerContext.includes('india') || lowerContext.includes('indian')) {
          foundDiscoveries.push({ emoji: '🇮🇳', text: 'Indian creator! Your unique perspective is your superpower' });
        }
      }

      // Portfolio detection
      if (portfolioUrl) {
        foundDiscoveries.push({ emoji: '🌐', text: 'Portfolio found! We\'re diving deep into your work' });
      }

      // If no discoveries, add a generic fun one
      if (foundDiscoveries.length === 0) {
        foundDiscoveries.push({ emoji: '🔍', text: 'Analyzing your vibe... Interesting. Very interesting' });
      }

      // Limit to 5 discoveries max to keep it clean
      return foundDiscoveries.slice(0, 5);
    };

    // Prepare discoveries immediately
    const discoveriesToShow = prepareDiscoveries();

    try {
      // Start the API call
      const apiPromise = analysisApi.analyse(strategyId, { portfolioUrl, userContext });

      // Animate completion steps while API is running
      setLoadingSteps({ connected: 'done', tweets: 'loading' });
      await delay(500);
      
      setLoadingSteps({ connected: 'done', tweets: 'done', analysing: 'loading' });
      await delay(300);
      
      // Start showing discoveries one by one
      for (let i = 0; i < discoveriesToShow.length; i++) {
        setDiscoveries(prev => [...prev, discoveriesToShow[i]]);
        await delay(800);
      }
      
      // Wait for API to complete
      const response = await apiPromise;
      const data = response.data;

      setTweetsAnalysed(data.tweetsAnalysed || 0);
      setAnalysisData(data.analysis); // Set this immediately so summary shows
      setTrendingTopics(data.trending || []);
      setConfidence(data.confidence || 'low');
      setConfidenceReason(data.confidenceReason || '');
      
      setLoadingSteps({ connected: 'done', tweets: 'done', analysing: 'done', trending: 'loading' });
      
      // Give user time to see the analysis summary
      await delay(2000);
      
      setLoadingSteps({ connected: 'done', tweets: 'done', analysing: 'done', trending: 'done' });

      setAnalysisId(data.analysisId);

      // Pre-select all topics
      setSelectedTopics([]);

      await delay(500);
      setPhase('confirm');
      setConfirmStep(0);
    } catch (err) {
      console.error('[AnalysisFlow] Analysis failed:', err);
      setError(err.response?.data?.error || err.message || 'Analysis failed. Please try again.');
      setLoadingSteps((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[key] === 'loading') next[key] = undefined;
        }
        return next;
      });
    }
  }

  async function handleConfirmStep() {
    const step = confirmSteps[confirmStep];
    if (!step || !analysisId) return;

    try {
      setError(null);
      await analysisApi.confirmStep(analysisId, step.key, step.value);
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save. Please try again.');
    }
  }

  async function handleQuickConfirm(key, value) {
    if (!analysisId) return;
    try {
      setError(null);
      await analysisApi.confirmStep(analysisId, key, value);
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    }
  }

  async function handleConfirmEdit(key, value) {
    if (!analysisId) return;
    try {
      setError(null);
      const result = await analysisApi.confirmStep(analysisId, key, value);
      setAnalysisData(result.data?.analysisData || analysisData);
      setEditing(null);
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    }
  }

  async function handleConfirmGoals() {
    if (!analysisId || selectedGoals.length === 0) return;
    try {
      setError(null);
      const goalLabels = selectedGoals.map((id) => GOALS_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean);
      await analysisApi.confirmStep(analysisId, 'goals', goalLabels);
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save goals.');
    }
  }

  async function handleConfirmTopics(mode) {
    if (!analysisId) return;
    try {
      setError(null);
      const topics = mode === 'all'
        ? [...(analysisData?.top_topics || []), ...trendingTopics.map((t) => t.topic)]
        : (analysisData?.top_topics || []).filter((t) => !selectedTopics.includes(t));
      await analysisApi.confirmStep(analysisId, 'topics', topics);
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save topics.');
    }
  }

  function advanceConfirmStep() {
    const nextStep = confirmStep + 1;
    if (nextStep >= confirmSteps.length) {
      setPhase('reference');
    } else {
      setConfirmStep(nextStep);
    }
  }

  async function handleAnalyseReferences() {
    const handles = referenceHandles.filter((h) => h.trim());
    if (handles.length === 0) return;

    setIsAnalysing(true);
    setError(null);

    try {
      const response = await analysisApi.analyseReferenceAccounts(analysisId, handles);
      setReferenceResults(response.data?.referenceAccounts || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to analyse reference accounts.');
    } finally {
      setIsAnalysing(false);
    }
  }

  async function handleGeneratePrompts() {
    setError(null);

    try {
      // Send additional context if provided
      if (deeperUrl || deeperContext) {
        await analysisApi.confirmStep(analysisId, 'extra_context', {
          deeper_url: deeperUrl,
          deeper_context: deeperContext
        });
      }

      // Start prompt generation in background (don't await)
      analysisApi.generatePrompts(analysisId, strategyId).catch(err => {
        console.error('[AnalysisFlow] Prompt generation failed:', err);
      });

      // Immediately redirect to strategy page to show prompts appearing
      onComplete?.();
    } catch (err) {
      console.error('[AnalysisFlow] Failed to start prompt generation:', err);
      setError(err.response?.data?.error || 'Failed to start prompt generation.');
    }
  }
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default AnalysisFlow;
