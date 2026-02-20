import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Award,
  BarChart3,
  Brain,
  Clock,
  Eye,
  Heart,
  Lightbulb,
  Lock,
  MessageCircle,
  RefreshCw,
  Repeat2,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import api, { analytics as analyticsAPI } from '../utils/api';
import { hasProPlanAccess } from '../utils/planAccess';
import { getSuiteGenieProUpgradeUrl } from '../utils/upgradeUrl';
import toast from 'react-hot-toast';
import {
  buildAiInsights,
  buildAudienceSummary,
  buildCalendarEntries,
  buildChartData,
  buildContentComparison,
  buildContentSignals,
  buildDayPerformance,
  buildDistributionChartData,
  buildGoalTargets,
  buildGrowthMetrics,
  buildHourlyData,
  buildRecommendations,
  buildRecommendedSlots,
  toNumber,
} from '../features/analytics/model';
const OverviewTab = lazy(() => import('./analytics/OverviewTab'));
const InsightsTab = lazy(() => import('./analytics/InsightsTab'));
const ContentTab = lazy(() => import('./analytics/ContentTab'));
const TimingTab = lazy(() => import('./analytics/TimingTab'));
const AudienceTab = lazy(() => import('./analytics/AudienceTab'));
const RecommendationsTab = lazy(() => import('./analytics/RecommendationsTab'));

const DEFAULT_DAYS = 30;
const FREE_DAYS = 7;
const PRO_TIMEFRAME_OPTIONS = ['7', '30', '90', '365'];
const CLIENT_AUTO_SYNC_ENABLED = String(
  import.meta.env.VITE_ANALYTICS_CLIENT_AUTO_SYNC_ENABLED || 'false'
).toLowerCase() === 'true';
const AUTO_SYNC_INTERVAL_MS = Number(import.meta.env.VITE_ANALYTICS_AUTO_SYNC_MS || 4 * 60 * 1000);
const AUTO_SYNC_INITIAL_DELAY_MS = Number(import.meta.env.VITE_ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS || 15000);
const AUTO_REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_ANALYTICS_AUTO_REFRESH_MS || 60000);
const SYNC_STATUS_REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_ANALYTICS_SYNC_STATUS_REFRESH_MS || 20000);
const COOLDOWN_TICK_MS = Number(import.meta.env.VITE_ANALYTICS_COOLDOWN_TICK_MS || 15000);

const initialAnalyticsState = {
  disconnected: false,
  plan: null,
  overview: {},
  daily_metrics: [],
  tweets: [],
  hourly_engagement: [],
  content_type_metrics: [],
  growth: { current: {}, previous: {} },
  engagement_patterns: [],
  optimal_times: [],
  content_insights: [],
  reach_metrics: [],
  engagement_distribution: [],
};

const parseDays = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DAYS;
  }
  return PRO_TIMEFRAME_OPTIONS.includes(String(parsed)) ? parsed : DEFAULT_DAYS;
};

const TIMEFRAME_OPTIONS = [
  { value: '7', label: 'Last 7 days', proOnly: false },
  { value: '30', label: 'Last 30 days', proOnly: true },
  { value: '90', label: 'Last 90 days', proOnly: true },
  { value: '365', label: 'Last 365 days', proOnly: true },
];

const normalizePayload = (payload) => payload?.data || payload || {};

const normalizeTeamResponse = async (responsePromise) => {
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed with status ${response.status}`);
    error.response = { status: response.status, data: payload };
    throw error;
  }

  return normalizePayload(payload);
};

const isReconnectRequiredError = (error) =>
  error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
  error?.response?.data?.reconnect === true;

const Tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3, proOnly: false },
  { id: 'insights', label: 'AI Insights', icon: Brain, proOnly: true },
  { id: 'content', label: 'Content Strategy', icon: Lightbulb, proOnly: true },
  { id: 'timing', label: 'Optimal Timing', icon: Clock, proOnly: true },
  { id: 'audience', label: 'Audience', icon: Users, proOnly: true },
  { id: 'recommendations', label: 'Recommendations', icon: Target, proOnly: true },
];

const Analytics = () => {
  const { user } = useAuth();
  const { selectedAccount, accounts, loading: accountLoading } = useAccount();
  const accountAPI = useAccountAwareAPI();
  const isTeamUser = accounts.length > 0;
  const upgradeUrl = getSuiteGenieProUpgradeUrl();
  const hasUserProPlan = hasProPlanAccess(user);

  const [analyticsData, setAnalyticsData] = useState(initialAnalyticsState);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timeframe, setTimeframe] = useState(String(hasUserProPlan ? DEFAULT_DAYS : FREE_DAYS));
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [updatedTweetIds, setUpdatedTweetIds] = useState(new Set());
  const [skippedTweetIds, setSkippedTweetIds] = useState(new Set());
  const [syncStatus, setSyncStatus] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [syncSummary, setSyncSummary] = useState(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [refreshingTweetIds, setRefreshingTweetIds] = useState(new Set());
  const syncInFlightRef = useRef(false);
  const hasServerProPlan = analyticsData?.plan?.pro === true;
  const isServerPlanResolved = analyticsData?.plan?.pro === true || analyticsData?.plan?.pro === false;
  const isProPlan = hasUserProPlan || hasServerProPlan;

  useEffect(() => {
    if (isServerPlanResolved && !isProPlan && timeframe !== String(FREE_DAYS)) {
      setTimeframe(String(FREE_DAYS));
    }
  }, [isServerPlanResolved, isProPlan, timeframe]);

  const fetchSyncStatus = async () => {
    try {
      const response = await api.get('/api/analytics/sync-status');
      if (typeof response.data?.disconnected === 'boolean') {
        setIsDisconnected(response.data.disconnected);
      }
      if (response.data?.plan) {
        setAnalyticsData((prev) => ({ ...prev, plan: response.data.plan }));
      }
      if (response.data?.syncStatus) {
        setSyncStatus(response.data.syncStatus);
      }
    } catch (syncStatusError) {
      console.error('Failed to fetch sync status:', syncStatusError);
    }
  };

  const fetchAnalytics = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const requestedDays = parseDays(timeframe);
      const useTeamScope = isTeamUser && !!selectedAccount;
      const overviewPayload = useTeamScope
        ? await normalizeTeamResponse(accountAPI.getAnalytics(`${requestedDays}d`))
        : await analyticsAPI.getOverviewCached({ days: requestedDays }).then((res) => normalizePayload(res.data));
      const backendPlan = overviewPayload?.plan || null;
      const backendIsPro = backendPlan?.pro === true;
      const effectiveIsPro = isProPlan || backendIsPro;
      const disconnected = Boolean(overviewPayload?.disconnected);
      const backendWarnings = Array.isArray(overviewPayload?.warnings) ? overviewPayload.warnings : [];

      if (backendWarnings.length > 0) {
        const warningSummary = Array.from(new Set(backendWarnings)).join(', ');
        setError(`Analytics is using partial data for: ${warningSummary}.`);
      }

      if (!effectiveIsPro) {
        setAnalyticsData({
          disconnected,
          plan:
            backendPlan || {
              planType: 'free',
              pro: false,
              days: FREE_DAYS,
            },
          overview: overviewPayload?.overview || {},
          daily_metrics: [],
          tweets: overviewPayload?.tweets || [],
          hourly_engagement: [],
          content_type_metrics: [],
          growth: { current: {}, previous: {} },
          engagement_patterns: [],
          optimal_times: [],
          content_insights: [],
          reach_metrics: [],
          engagement_distribution: [],
        });
        setIsDisconnected(disconnected);
        return;
      }

      const days = requestedDays;
      const requests = useTeamScope
        ? [
            normalizeTeamResponse(accountAPI.getEngagementAnalytics(`${days}d`)),
            normalizeTeamResponse(accountAPI.getAudienceAnalytics(`${days}d`)),
          ]
        : [
            analyticsAPI.getEngagementCached({ days }).then((res) => normalizePayload(res.data)),
            analyticsAPI.getAudienceCached({ days }).then((res) => normalizePayload(res.data)),
          ];

      const [engagementResult, audienceResult] = await Promise.allSettled(requests);
      const failures = [engagementResult, audienceResult].filter((entry) => entry.status === 'rejected');

      if (failures.length > 0) {
        setError('Some analytics sections are temporarily unavailable. Showing available data.');
      }

      const engagementPayload =
        engagementResult.status === 'fulfilled'
          ? engagementResult.value
          : { engagement_patterns: [], optimal_times: [], content_insights: [] };
      const audiencePayload =
        audienceResult.status === 'fulfilled'
          ? audienceResult.value
          : { reach_metrics: [], engagement_distribution: [] };

      const mergedDisconnected = Boolean(
        overviewPayload?.disconnected || engagementPayload?.disconnected || audiencePayload?.disconnected
      );
      const mergedWarnings = [
        ...(Array.isArray(overviewPayload?.warnings) ? overviewPayload.warnings : []),
        ...(Array.isArray(engagementPayload?.warnings) ? engagementPayload.warnings : []),
        ...(Array.isArray(audiencePayload?.warnings) ? audiencePayload.warnings : []),
      ];

      if (mergedWarnings.length > 0) {
        const warningSummary = Array.from(new Set(mergedWarnings)).join(', ');
        setError(`Analytics is using partial data for: ${warningSummary}.`);
      }

      setAnalyticsData({
        disconnected: mergedDisconnected,
        plan:
          backendPlan || {
            planType: hasUserProPlan ? 'pro' : 'free',
            pro: true,
            days,
          },
        overview: overviewPayload?.overview || {},
        daily_metrics: overviewPayload?.daily_metrics || [],
        tweets: overviewPayload?.tweets || [],
        hourly_engagement: overviewPayload?.hourly_engagement || [],
        content_type_metrics: overviewPayload?.content_type_metrics || [],
        growth: overviewPayload?.growth || { current: {}, previous: {} },
        engagement_patterns: engagementPayload?.engagement_patterns || [],
        optimal_times: engagementPayload?.optimal_times || [],
        content_insights: engagementPayload?.content_insights || [],
        reach_metrics: audiencePayload?.reach_metrics || [],
        engagement_distribution: audiencePayload?.engagement_distribution || [],
      });
      setIsDisconnected(mergedDisconnected);
    } catch (fetchError) {
      console.error('Failed to fetch analytics:', fetchError);

      if (isReconnectRequiredError(fetchError)) {
        setIsDisconnected(true);
        setAnalyticsData(initialAnalyticsState);
        if (!silent) {
          setError('Twitter is disconnected. Please reconnect your account in Settings.');
        }
      } else {
        if (!silent) {
          setError('Failed to load analytics data.');
        }
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const syncAnalytics = async ({ silent = false, auto = false } = {}) => {
    if (syncInFlightRef.current) {
      return;
    }

    if (!isProPlan) {
      if (!silent) {
        setError('Sync Latest is available on Pro. Upgrade to enable real-time sync.');
        toast.error('Sync Latest is available on Pro. Upgrade to continue.');
      }
      return;
    }

    if (isDisconnected) {
      if (!silent) {
        setError('Twitter is disconnected. Please reconnect your account in Settings before syncing.');
      }
      return;
    }

    const nextAllowedAtMs = syncStatus?.nextAllowedAt ? new Date(syncStatus.nextAllowedAt).getTime() : 0;
    if (nextAllowedAtMs && nextAllowedAtMs > Date.now()) {
      const waitMinutes = Math.max(1, Math.ceil((nextAllowedAtMs - Date.now()) / 60000));
      if (!silent) {
        setError(`Sync cooldown active. Please wait about ${waitMinutes} minutes.`);
      }
      return;
    }

    syncInFlightRef.current = true;
    try {
      setSyncing(true);
      if (!silent) {
        setError(null);
      }
      const days = parseDays(timeframe);
      const response = await api.post('/api/analytics/sync', { days }, { timeout: 120000 });

      if (response.data?.syncStatus) {
        setSyncStatus(response.data.syncStatus);
      }
      if (typeof response.data?.disconnected === 'boolean') {
        setIsDisconnected(response.data.disconnected);
      }
      if (response.data?.stats) {
        setSyncSummary({
          runId: response.data.runId || null,
          updated: response.data.stats.metrics_updated || 0,
          errors: response.data.stats.errors || 0,
          processed: response.data.stats.total_processed || 0,
          totalCandidates: response.data.stats.total_candidates ?? null,
          remaining: response.data.stats.remaining ?? null,
          skipReasons: response.data.stats.skip_reasons || null,
          debugInfo: response.data.debugInfo || null,
          at: new Date().toISOString(),
        });
      }

      if (response.data?.type === 'sync_cooldown' || response.data?.cooldown) {
        const waitMinutes = response.data?.waitMinutes || 1;
        if (!silent) {
          setError(`Sync cooldown active. Please wait about ${waitMinutes} minutes.`);
        }
        return;
      }

      if (response.data?.success) {
        const stats = response.data.stats || { metrics_updated: 0, errors: 0 };
        const resetTime = response.data.resetTime ? new Date(response.data.resetTime) : null;
        const resetTimeLocal = resetTime ? resetTime.toLocaleString() : null;

        if (response.data.rateLimited) {
          setError(
            resetTimeLocal
              ? `Rate limit reached after syncing ${stats.metrics_updated} tweets. Try again after ${resetTimeLocal}.`
              : `Rate limit reached after syncing ${stats.metrics_updated} tweets. Please try again later.`
          );
        } else if ((stats.metrics_updated || 0) === 0) {
          const debugInfo = response.data.debugInfo;
          const noChangeCount = Number(response.data?.stats?.skip_reasons?.no_change || 0);
          const details = debugInfo
            ? `Posted tweets with IDs: ${debugInfo.totalPostedWithTweetId}, stale: ${debugInfo.staleCount}, zero metrics: ${debugInfo.zeroMetricsCount}.`
            : 'No eligible tweets matched current sync criteria.';
          const noChangeHint =
            noChangeCount > 0
              ? ` Twitter returned unchanged metrics for ${noChangeCount} tweet${noChangeCount === 1 ? '' : 's'}.`
              : '';
          if (!silent) {
            setError(`Sync completed but updated 0 tweets. ${details}${noChangeHint}`);
          }
        }

        setUpdatedTweetIds(new Set(response.data.updatedTweetIds || []));
        setSkippedTweetIds(new Set(response.data.skippedTweetIds || []));
        analyticsAPI.invalidateCache();
        await fetchAnalytics({ silent: true });
      }
    } catch (syncError) {
      const syncStatusCode = syncError?.response?.status;
      if (syncStatusCode === 409 || syncStatusCode === 429 || isReconnectRequiredError(syncError)) {
        if (!auto) {
          console.warn('Sync request returned expected non-success state:', {
            status: syncStatusCode,
            type: syncError?.response?.data?.type,
          });
        }
      } else {
        console.error('Failed to sync analytics:', syncError);
      }

      if (syncError.code === 'ECONNABORTED') {
        if (!silent) {
          setError('Sync is taking longer than expected. Please wait and refresh analytics in a minute.');
        }
      } else if (syncError.response?.status === 409) {
        const syncErrorData = syncError.response.data || {};
        if (syncErrorData.syncStatus) setSyncStatus(syncErrorData.syncStatus);
        if (!silent) {
          setError(syncErrorData?.type === 'sync_in_progress'
            ? 'A sync is already running for this account. Please wait for it to finish.'
            : 'Sync is already in progress.');
        }
      } else if (syncError.response?.status === 429) {
        const syncErrorData = syncError.response.data || {};
        if (syncErrorData.syncStatus) setSyncStatus(syncErrorData.syncStatus);

        if (syncErrorData.type === 'sync_cooldown') {
          const waitMinutes = syncErrorData.waitMinutes || 1;
          if (!silent) {
            setError(`Sync cooldown active. Please wait about ${waitMinutes} minutes.`);
          }
        } else if (syncErrorData.type === 'rate_limit') {
          const resetTime = syncErrorData.resetTime ? new Date(syncErrorData.resetTime) : null;
          const resetTimeLabel = resetTime ? resetTime.toLocaleString() : 'later';
          if (!silent) {
            setError(`Twitter API rate limit exceeded. Please retry around ${resetTimeLabel}.`);
          }
        } else {
          if (!silent) {
            setError('Rate limit exceeded. Please try again later.');
          }
        }

        setUpdatedTweetIds(new Set(syncErrorData.updatedTweetIds || []));
        setSkippedTweetIds(new Set(syncErrorData.skippedTweetIds || []));
        analyticsAPI.invalidateCache();
      } else if (
        (syncError.response?.status === 401 || syncError.response?.status === 400) &&
        isReconnectRequiredError(syncError)
      ) {
        setIsDisconnected(true);
        if (!silent) {
          setError('Twitter is disconnected. Please reconnect your account in Settings.');
        }
      } else {
        const backendError = syncError.response?.data?.message || syncError.response?.data?.error;
        if (!silent) {
          setError(backendError || 'Failed to sync analytics data. Please try again later.');
        }
      }
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
      await fetchSyncStatus();
    }
  };

  const forceRefreshTweetMetrics = async (tweetDbId) => {
    if (!tweetDbId) return;
    if (refreshingTweetIds.has(tweetDbId)) return;
    if (!isProPlan) {
      toast.error('Tweet metric refresh is available on Pro and above.');
      return;
    }

    if (isDisconnected) {
      setError('Twitter is disconnected. Please reconnect your account in Settings.');
      return;
    }

    setRefreshingTweetIds((prev) => new Set([...prev, tweetDbId]));
    try {
      const response = await analyticsAPI.refreshTweetMetrics(tweetDbId);
      const result = response.data || {};

      if (result.changed) {
        toast.success('Metrics updated from Twitter for this tweet.');
      } else {
        toast.success('Checked Twitter: metrics unchanged for this tweet.');
      }

      analyticsAPI.invalidateCache();
      await fetchAnalytics({ silent: true });
    } catch (refreshError) {
      if (refreshError?.response?.status === 429) {
        const waitMinutes = refreshError?.response?.data?.waitMinutes || 1;
        toast.error(`Rate limit hit. Try again in about ${waitMinutes} min.`);
      } else if (isReconnectRequiredError(refreshError)) {
        setIsDisconnected(true);
        toast.error('Twitter is disconnected. Please reconnect in Settings.');
      } else {
        toast.error('Failed to refresh this tweet metrics.');
      }
    } finally {
      setRefreshingTweetIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetDbId);
        return next;
      });
    }
  };

  useEffect(() => {
    if (accountLoading) {
      return;
    }

    fetchAnalytics();
    fetchSyncStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, selectedAccount?.id, isTeamUser, accountLoading, isProPlan, hasUserProPlan]);

  useEffect(() => {
    setUpdatedTweetIds(new Set());
    setSkippedTweetIds(new Set());
    setSyncSummary(null);
  }, [timeframe, selectedAccount?.id, isTeamUser, isProPlan]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), COOLDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (accountLoading) {
      return;
    }

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchSyncStatus();
    }, SYNC_STATUS_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLoading, selectedAccount?.id, isTeamUser]);

  useEffect(() => {
    if (accountLoading || isDisconnected) {
      return;
    }

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchAnalytics({ silent: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLoading, isDisconnected, timeframe, selectedAccount?.id, isTeamUser, isProPlan]);

  useEffect(() => {
    if (!CLIENT_AUTO_SYNC_ENABLED || accountLoading || isDisconnected || !isProPlan) {
      return;
    }

    const initialTimer = setTimeout(() => {
      syncAnalytics({ silent: true, auto: true });
    }, AUTO_SYNC_INITIAL_DELAY_MS);

    const interval = setInterval(() => {
      syncAnalytics({ silent: true, auto: true });
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLoading, isDisconnected, timeframe, selectedAccount?.id, isTeamUser, isProPlan]);

  const overview = analyticsData.overview || {};
  const growth = analyticsData.growth || {};
  const topTweets = analyticsData.tweets || [];
  const dailyMetrics = analyticsData.daily_metrics || [];
  const hourlyEngagement = analyticsData.hourly_engagement || [];
  const contentTypeMetrics = analyticsData.content_type_metrics || [];
  const engagementPatterns = analyticsData.engagement_patterns || [];
  const optimalTimes = analyticsData.optimal_times || [];
  const reachMetrics = analyticsData.reach_metrics || [];
  const engagementDistribution = analyticsData.engagement_distribution || [];
  const timeframeDays = isProPlan ? parseDays(timeframe) : FREE_DAYS;

  const growthMetrics = useMemo(() => buildGrowthMetrics(overview, growth), [overview, growth]);
  const contentComparison = useMemo(() => buildContentComparison(contentTypeMetrics), [contentTypeMetrics]);
  const chartData = useMemo(() => buildChartData(dailyMetrics), [dailyMetrics]);
  const hourlyData = useMemo(() => buildHourlyData(hourlyEngagement), [hourlyEngagement]);
  const contentSignals = useMemo(
    () => buildContentSignals(engagementPatterns, contentTypeMetrics),
    [engagementPatterns, contentTypeMetrics]
  );
  const dayPerformance = useMemo(() => buildDayPerformance(optimalTimes), [optimalTimes]);
  const recommendedSlots = useMemo(() => buildRecommendedSlots(optimalTimes, 8), [optimalTimes]);
  const distributionChartData = useMemo(
    () => buildDistributionChartData(engagementDistribution),
    [engagementDistribution]
  );
  const audienceSummary = useMemo(
    () =>
      buildAudienceSummary({
        overview,
        reachMetrics,
        engagementDistribution,
        optimalTimes,
        contentSignals,
      }),
    [overview, reachMetrics, engagementDistribution, optimalTimes, contentSignals]
  );
  const aiInsights = useMemo(
    () =>
      buildAiInsights({
        overview,
        timeframeDays,
        growthMetrics,
        contentSignals,
        recommendedSlots,
        audienceSummary,
      }),
    [overview, timeframeDays, growthMetrics, contentSignals, recommendedSlots, audienceSummary]
  );
  const recommendations = useMemo(
    () =>
      buildRecommendations({
        overview,
        timeframeDays,
        growthMetrics,
        contentSignals,
        audienceSummary,
        recommendedSlots,
      }),
    [overview, timeframeDays, growthMetrics, contentSignals, audienceSummary, recommendedSlots]
  );
  const calendarEntries = useMemo(
    () =>
      buildCalendarEntries({
        recommendedSlots,
        bestContentType: contentSignals?.bestContentType?.key || 'single',
      }),
    [recommendedSlots, contentSignals]
  );
  const goals = useMemo(() => buildGoalTargets({ overview, timeframeDays }), [overview, timeframeDays]);

  const reachChartData = useMemo(
    () =>
      reachMetrics
        .map((row) => ({
          date: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          impressions: toNumber(row.total_impressions),
          engagement: toNumber(row.total_engagement),
        }))
        .reverse(),
    [reachMetrics]
  );

  const performanceScore = useMemo(() => {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const engagementRate = toNumber(overview.engagement_rate);
    const totalTweets = toNumber(overview.total_tweets);
    const impressionsGrowth = toNumber(growthMetrics.impressions);
    const engagementGrowth = toNumber(growthMetrics.engagement);
    const noReachShare = toNumber(audienceSummary.noReachShare);

    // 0-40 points: normalized engagement rate (caps at ~6%+).
    const engagementScore = clamp((engagementRate / 6) * 40, 0, 40);

    // 0-25 points: blended growth trend, bounded to avoid extreme spikes.
    const blendedGrowth = impressionsGrowth * 0.6 + engagementGrowth * 0.4;
    const growthScore = clamp(((blendedGrowth + 40) / 80) * 25, 0, 25);

    // 0-20 points: sample confidence based on posting volume in selected window.
    const expectedTweetsFloor = Math.max(10, Math.round(timeframeDays * 0.4));
    const consistencyScore = clamp((totalTweets / expectedTweetsFloor) * 20, 0, 20);

    // 0-15 points: reward reliable distribution (lower zero-impression share).
    const reliabilityScore = clamp(((100 - noReachShare) / 100) * 15, 0, 15);

    const rawScore = engagementScore + growthScore + consistencyScore + reliabilityScore;

    // Small datasets can spike growth percentages and produce misleading near-100 scores.
    const maxScoreBySample =
      totalTweets >= 20 ? 100 : totalTweets >= 12 ? 92 : totalTweets >= 6 ? 82 : totalTweets >= 3 ? 72 : 60;
    const boundedScore = Math.min(rawScore, maxScoreBySample);

    return Math.round(boundedScore);
  }, [overview, growthMetrics, audienceSummary.noReachShare, timeframeDays]);

  const enhancedStats = useMemo(
    () => {
      if (!isProPlan) {
        return [
          {
            name: 'Total Posts',
            value: toNumber(overview.total_tweets),
            icon: MessageCircle,
            color: 'text-blue-600',
            bgColor: 'bg-blue-50',
            growth: null,
            subtitle: 'Last 7 days',
          },
          {
            name: 'Total Likes',
            value: toNumber(overview.total_likes),
            icon: Heart,
            color: 'text-red-600',
            bgColor: 'bg-red-50',
            growth: null,
            subtitle: 'Last 7 days',
          },
          {
            name: 'Total Comments',
            value: toNumber(overview.total_replies),
            icon: Activity,
            color: 'text-purple-600',
            bgColor: 'bg-purple-50',
            growth: null,
            subtitle: 'Last 7 days',
          },
          {
            name: 'Total Shares',
            value: toNumber(overview.total_retweets),
            icon: Repeat2,
            color: 'text-green-600',
            bgColor: 'bg-green-50',
            growth: null,
            subtitle: 'Last 7 days',
          },
        ];
      }

      return [
        {
          name: 'Total Tweets',
          value: toNumber(overview.total_tweets),
          icon: MessageCircle,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          growth: growthMetrics.tweets,
          subtitle: 'Published tweets',
        },
        {
          name: 'Total Impressions',
          value: toNumber(overview.total_impressions),
          icon: Eye,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          growth: growthMetrics.impressions,
          subtitle: 'Total reach',
        },
        {
          name: 'Total Engagement',
          value: toNumber(overview.total_engagement),
          icon: Activity,
          color: 'text-purple-600',
          bgColor: 'bg-purple-50',
          growth: growthMetrics.engagement,
          subtitle: 'Likes + Retweets + Replies',
        },
        {
          name: 'Engagement Rate',
          value: `${toNumber(overview.engagement_rate).toFixed(1)}%`,
          icon: Target,
          color: 'text-orange-600',
          bgColor: 'bg-orange-50',
          growth: null,
          subtitle: 'Average engagement rate',
        },
        {
          name: 'Avg Impressions',
          value: Math.round(toNumber(overview.avg_impressions)),
          icon: TrendingUp,
          color: 'text-indigo-600',
          bgColor: 'bg-indigo-50',
          growth: null,
          subtitle: 'Per tweet',
        },
        {
          name: 'Top Tweet Reach',
          value: toNumber(overview.max_impressions),
          icon: Award,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          growth: null,
          subtitle: 'Best performing tweet',
        },
      ];
    },
    [overview, growthMetrics, isProPlan]
  );

  const nextAllowedAtMs = syncStatus?.nextAllowedAt ? new Date(syncStatus.nextAllowedAt).getTime() : 0;
  const cooldownRemainingMs = Math.max(0, nextAllowedAtMs - currentTime);
  const cooldownMinutes = Math.max(1, Math.ceil(cooldownRemainingMs / 60000));
  const isCooldownActive = cooldownRemainingMs > 0;
  const syncButtonDisabled = isProPlan && (syncing || syncStatus?.inProgress || isCooldownActive);
  const nextAllowedLabel = syncStatus?.nextAllowedAt
    ? new Date(syncStatus.nextAllowedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const activeTabConfig = Tabs.find((tab) => tab.id === activeTab) || Tabs[0];
  const isActiveTabLocked = Boolean(activeTabConfig?.proOnly && !isProPlan);

  const handleSyncButtonClick = () => {
    if (!isProPlan) {
      setError('Sync Latest is available on Pro. Upgrade to enable real-time sync.');
      toast.error('Sync Latest is available on Pro. Upgrade to continue.');
      return;
    }
    syncAnalytics();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (isDisconnected || analyticsData.disconnected) {
    return (
      <div className="space-y-6">
        <div className="card text-center py-12">
          <AlertCircle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Twitter Connection Required</h2>
          <p className="text-gray-600 mt-2 mb-6">Reconnect your Twitter account to view analytics and run sync.</p>
          <a href="/settings" className="btn btn-primary">
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
          <p className="mt-2 text-gray-600">Data-driven performance intelligence for your Twitter growth.</p>
        </div>

        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-3">
          <select
            className="input w-auto"
            value={timeframe}
            onChange={(event) => setTimeframe(String(event.target.value))}
          >
            {TIMEFRAME_OPTIONS.map((option) => {
              const isLocked = option.proOnly && !isProPlan;
              return (
                <option key={option.value} value={option.value} disabled={isLocked}>
                  {option.label}
                  {isLocked ? ' (Pro)' : ''}
                </option>
              );
            })}
          </select>

          <button
            type="button"
            onClick={handleSyncButtonClick}
            disabled={syncButtonDisabled}
            className={`btn btn-primary ${syncButtonDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {isProPlan ? (
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            ) : (
              <Lock className="h-4 w-4 mr-2" />
            )}
            {isProPlan
              ? syncing
                ? 'Syncing...'
                : syncStatus?.inProgress
                  ? 'Sync in progress'
                  : 'Sync Latest'
              : 'Sync Latest (Pro)'}
          </button>
          </div>
          {!isProPlan && (
            <p className="text-xs text-amber-700">
              Free plan includes last 7 days only. Upgrade to unlock 30/90/365 day ranges and real-time sync.
            </p>
          )}
        </div>
      </div>

      {isProPlan && (syncSummary || syncStatus) && (
        <div className="card border border-blue-100 bg-blue-50/60">
          <div className="text-sm text-blue-900 space-y-2">
            {syncSummary && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span><strong>Updated:</strong> {syncSummary.updated}</span>
                  <span><strong>Errors:</strong> {syncSummary.errors}</span>
                  <span><strong>Processed:</strong> {syncSummary.processed}</span>
                  {syncSummary.totalCandidates !== null && <span><strong>Candidates:</strong> {syncSummary.totalCandidates}</span>}
                  {syncSummary.remaining !== null && <span><strong>Left:</strong> {syncSummary.remaining}</span>}
                  {syncSummary.skipReasons?.no_change > 0 && (
                    <span><strong>No change:</strong> {syncSummary.skipReasons.no_change}</span>
                  )}
                </div>
                {syncSummary.skipReasons?.no_change > 0 && (
                  <div>
                    Twitter returned unchanged public metrics for {syncSummary.skipReasons.no_change} tweet
                    {syncSummary.skipReasons.no_change === 1 ? '' : 's'} in this run.
                  </div>
                )}
              </>
            )}
            {syncStatus?.inProgress && <div>Sync currently running for this account.</div>}
            {isCooldownActive && (
              <div>
                Cooldown active for about {cooldownMinutes} min{cooldownMinutes !== 1 ? 's' : ''}
                {nextAllowedLabel ? ` (next sync around ${nextAllowedLabel})` : ''}.
              </div>
            )}
          </div>
        </div>
      )}
      {!isProPlan && (
        <div className="card border border-amber-200 bg-amber-50/70">
          <div className="flex items-start gap-3 text-amber-900">
            <Lock className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Advanced analytics is locked on Free.</p>
              <p>
                Upgrade to Pro for trend charts, AI insights, timing intelligence, recommendations, and Sync Latest.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-200 bg-red-50 text-red-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-2">
          {Tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const locked = tab.proOnly && !isProPlan;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  if (locked) {
                    toast.error(`${tab.label} is available on Pro. Upgrade to unlock it.`);
                  }
                }}
                className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? locked
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-blue-600 text-white'
                    : locked
                      ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Icon className="h-4 w-4 mr-2" />
                {tab.label}
                {locked && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
                    <Lock className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          </div>
        }
      >
        {isActiveTabLocked && (
          <div className="card border border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-amber-700 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-amber-900">{activeTabConfig.label} is a Pro feature</h3>
                <p className="text-sm text-amber-800 mt-1">
                  Upgrade to Pro to unlock this analytics module and act on deeper performance data.
                </p>
                <a href={upgradeUrl} className="btn btn-primary mt-4 inline-flex items-center">
                  Upgrade to Pro
                </a>
              </div>
            </div>
          </div>
        )}

        {!isActiveTabLocked && activeTab === 'overview' && (
          <OverviewTab
            stats={enhancedStats}
            chartData={chartData}
            hourlyData={hourlyData}
            topTweets={topTweets}
            timeframe={timeframe}
            isProPlan={isProPlan}
            showAdvancedCharts={isProPlan}
            updatedTweetIds={updatedTweetIds}
            skippedTweetIds={skippedTweetIds}
            refreshingTweetIds={refreshingTweetIds}
            onForceCheckTweet={forceRefreshTweetMetrics}
          />
        )}

        {!isActiveTabLocked && activeTab === 'insights' && (
          <InsightsTab
            aiInsights={aiInsights}
            performanceScore={performanceScore}
            growthMetrics={growthMetrics}
            overview={overview}
          />
        )}

        {!isActiveTabLocked && activeTab === 'content' && (
          <ContentTab
            contentComparison={contentComparison}
            engagementPatterns={engagementPatterns}
            contentSignals={contentSignals}
          />
        )}

        {!isActiveTabLocked && activeTab === 'timing' && (
          <TimingTab
            hourlyData={hourlyData}
            dayPerformance={dayPerformance}
            recommendedSlots={recommendedSlots}
          />
        )}

        {!isActiveTabLocked && activeTab === 'audience' && (
          <AudienceTab
            audienceSummary={audienceSummary}
            distributionChartData={distributionChartData}
            reachChartData={reachChartData}
            recommendedSlots={recommendedSlots}
            contentSignals={contentSignals}
          />
        )}

        {!isActiveTabLocked && activeTab === 'recommendations' && (
          <RecommendationsTab
            recommendations={recommendations}
            goals={goals}
            calendarEntries={calendarEntries}
          />
        )}
      </Suspense>
    </div>
  );
};

export default Analytics;
