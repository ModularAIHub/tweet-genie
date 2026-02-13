const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first ordering

export const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeDivide = (numerator, denominator, fallback = 0) => {
  const den = toNumber(denominator);
  if (den <= 0) return fallback;
  return toNumber(numerator) / den;
};

export const formatDayName = (dayOfWeek) => DAY_NAMES[toNumber(dayOfWeek)] || 'Unknown';

const toTitleCase = (value) =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const calculateGrowth = (current, previous) => {
  const currentValue = toNumber(current);
  const previousValue = toNumber(previous);
  if (previousValue <= 0) return currentValue > 0 ? 100 : 0;
  return ((currentValue - previousValue) / previousValue) * 100;
};

export const buildGrowthMetrics = (overview = {}, growth = {}) => {
  const previous = growth?.previous || {};
  const previousEngagement = toNumber(
    previous.prev_total_engagement,
    toNumber(previous.prev_total_likes) +
      toNumber(previous.prev_total_retweets) +
      toNumber(previous.prev_total_replies) +
      toNumber(previous.prev_total_quotes) +
      toNumber(previous.prev_total_bookmarks)
  );

  return {
    tweets: calculateGrowth(overview.total_tweets, previous.prev_total_tweets),
    impressions: calculateGrowth(overview.total_impressions, previous.prev_total_impressions),
    likes: calculateGrowth(overview.total_likes, previous.prev_total_likes),
    engagement: calculateGrowth(overview.total_engagement, previousEngagement),
  };
};

export const buildContentComparison = (contentTypeMetrics = []) =>
  contentTypeMetrics.map((metric) => {
    const avgImpressions = toNumber(metric.avg_impressions);
    const avgEngagement = toNumber(metric.avg_total_engagement);
    return {
      type: metric.content_type === 'thread' ? 'Threads' : 'Single Tweets',
      tweets: toNumber(metric.tweets_count),
      avgImpressions: Math.round(avgImpressions),
      avgEngagement: Math.round(avgEngagement),
      engagementRate: avgImpressions > 0 ? (avgEngagement / avgImpressions) * 100 : 0,
    };
  });

export const buildChartData = (dailyMetrics = []) =>
  dailyMetrics
    .map((day) => ({
      ...day,
      date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      impressions: toNumber(day.impressions),
      total_engagement: toNumber(day.total_engagement),
      tweets_count: toNumber(day.tweets_count),
    }))
    .reverse();

export const buildHourlyData = (hourlyEngagement = []) => {
  const byHour = new Map(
    hourlyEngagement.map((row) => [
      toNumber(row.hour),
      {
        hour: toNumber(row.hour),
        avgEngagement: toNumber(row.avg_engagement),
        avgImpressions: toNumber(row.avg_impressions),
        tweetsCount: toNumber(row.tweets_count),
      },
    ])
  );

  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    return {
      hour,
      label: `${hour}:00`,
      engagement: row ? Math.round(row.avgEngagement) : 0,
      impressions: row ? Math.round(row.avgImpressions) : 0,
      tweets: row ? row.tweetsCount : 0,
    };
  });
};

const aggregateByCategory = (rows, categoryField, metricField = 'avg_total_engagement') => {
  const map = new Map();
  for (const row of rows) {
    const key = String(row?.[categoryField] || 'unknown');
    const tweets = toNumber(row?.tweets_count);
    const metricValue = toNumber(row?.[metricField]);
    const existing = map.get(key) || { totalWeight: 0, weightedMetric: 0, entries: 0 };

    existing.totalWeight += Math.max(tweets, 1);
    existing.weightedMetric += metricValue * Math.max(tweets, 1);
    existing.entries += 1;
    map.set(key, existing);
  }

  return Array.from(map.entries()).map(([key, stats]) => ({
    key,
    avgMetric: safeDivide(stats.weightedMetric, stats.totalWeight),
    entries: stats.entries,
  }));
};

export const buildContentSignals = (engagementPatterns = [], contentTypeMetrics = []) => {
  const contentType = aggregateByCategory(engagementPatterns, 'content_type').sort(
    (a, b) => b.avgMetric - a.avgMetric
  );
  if (contentType.length === 0 && Array.isArray(contentTypeMetrics) && contentTypeMetrics.length > 0) {
    for (const row of contentTypeMetrics) {
      const key = String(row?.content_type || 'single');
      contentType.push({
        key,
        avgMetric: toNumber(row?.avg_total_engagement),
        entries: toNumber(row?.tweets_count),
      });
    }
    contentType.sort((a, b) => b.avgMetric - a.avgMetric);
  }
  const hashtagUsage = aggregateByCategory(engagementPatterns, 'hashtag_usage').sort(
    (a, b) => b.avgMetric - a.avgMetric
  );
  const contentLength = aggregateByCategory(engagementPatterns, 'content_length').sort(
    (a, b) => b.avgMetric - a.avgMetric
  );

  const bestContentType = contentType[0] || null;
  const bestHashtagUsage = hashtagUsage[0] || null;
  const bestContentLength = contentLength[0] || null;

  return {
    bestContentType,
    bestHashtagUsage,
    bestContentLength,
    threadVsSingle: {
      thread: contentType.find((row) => row.key === 'thread')?.avgMetric || 0,
      single:
        contentType.find((row) => row.key === 'single')?.avgMetric ||
        contentType.find((row) => row.key === 'single_tweets')?.avgMetric ||
        0,
    },
  };
};

export const buildDayPerformance = (optimalTimes = []) => {
  const byDay = new Map();

  for (const row of optimalTimes) {
    const day = toNumber(row.day_of_week, -1);
    if (day < 0 || day > 6) continue;
    const tweets = toNumber(row.tweets_count);
    if (tweets <= 0) continue;
    const avgEngagement = toNumber(row.avg_engagement);

    const existing = byDay.get(day) || {
      day,
      tweets: 0,
      engagementWeighted: 0,
      slots: 0,
    };

    existing.tweets += tweets;
    existing.engagementWeighted += avgEngagement * tweets;
    existing.slots += 1;
    byDay.set(day, existing);
  }

  const rows = DAY_ORDER.map((day) => {
    const stats = byDay.get(day);
    const avgEngagement = stats ? safeDivide(stats.engagementWeighted, stats.tweets) : 0;
    return {
      day,
      dayName: formatDayName(day),
      avgEngagement,
      tweets: stats?.tweets || 0,
      slots: stats?.slots || 0,
      isWeekend: day === 0 || day === 6,
    };
  });

  const maxAvg = Math.max(...rows.map((row) => row.avgEngagement), 0);
  return rows.map((row) => ({
    ...row,
    score: maxAvg > 0 ? (row.avgEngagement / maxAvg) * 100 : 0,
  }));
};

export const buildRecommendedSlots = (optimalTimes = [], limit = 6) => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const prioritized = optimalTimes
    .map((row) => ({
      day: toNumber(row.day_of_week, -1),
      dayName: formatDayName(row.day_of_week),
      hour: toNumber(row.hour_of_day),
      tweetsCount: toNumber(row.tweets_count),
      avgEngagement: toNumber(row.avg_engagement),
      avgEngagementRate: toNumber(row.avg_engagement_rate),
    }))
    .filter((row) => row.day >= 0 && row.day <= 6 && row.tweetsCount > 0)
    .sort((a, b) => {
      const aWeight = clamp(a.tweetsCount / 5, 0.35, 1);
      const bWeight = clamp(b.tweetsCount / 5, 0.35, 1);
      const aScore = a.avgEngagement * aWeight + a.avgEngagementRate * (2 + aWeight);
      const bScore = b.avgEngagement * bWeight + b.avgEngagementRate * (2 + bWeight);

      if (bScore !== aScore) return bScore - aScore;
      if (b.tweetsCount !== a.tweetsCount) return b.tweetsCount - a.tweetsCount;
      return b.avgEngagement - a.avgEngagement;
    });

  const withSamples = prioritized.filter((row) => row.tweetsCount >= 2);
  const source = withSamples.length > 0 ? withSamples : prioritized;

  const unique = [];
  const seen = new Set();
  for (const row of source) {
    const key = `${row.day}-${row.hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= limit) break;
  }

  return unique;
};

const getDayPart = (hour) => {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'late-night';
};

const topicLibrary = {
  thread: {
    morning: ['How-to breakdown', 'Framework deep dive', 'Step-by-step tutorial'],
    afternoon: ['Industry trend analysis', 'Hot take with data', 'Case study thread'],
    evening: ['Founder story', 'Behind-the-scenes lessons', 'Weekly recap'],
    'late-night': ['Opinion thread', 'Experiment summary', 'Build-in-public notes'],
  },
  single: {
    morning: ['Quick tip', 'Checklist post', 'Daily insight'],
    afternoon: ['Trend reaction', 'Question post', 'Mini case insight'],
    evening: ['Personal lesson', 'Contrarian thought', 'Audience prompt'],
    'late-night': ['Reflection post', 'Build update', 'Community question'],
  },
};

export const buildCalendarEntries = ({ recommendedSlots = [], bestContentType = 'single', limit = 6 }) => {
  const contentType = bestContentType === 'thread' ? 'thread' : 'single';
  const topEngagement = Math.max(...recommendedSlots.map((slot) => slot.avgEngagement), 0);

  return recommendedSlots.slice(0, limit).map((slot, index) => {
    const dayPart = getDayPart(slot.hour);
    const topics = topicLibrary[contentType][dayPart];
    const topic = topics[index % topics.length];
    const confidence = topEngagement > 0 ? safeDivide(slot.avgEngagement, topEngagement) : 0;

    let engagementLabel = 'Low';
    if (confidence >= 0.8) engagementLabel = 'Very High';
    else if (confidence >= 0.6) engagementLabel = 'High';
    else if (confidence >= 0.4) engagementLabel = 'Medium';

    return {
      day: slot.dayName,
      time: `${String(slot.hour).padStart(2, '0')}:00`,
      type: contentType === 'thread' ? 'Thread' : 'Single Tweet',
      topic,
      engagement: engagementLabel,
      confidence,
      avgEngagement: slot.avgEngagement,
      tweetsCount: slot.tweetsCount,
    };
  });
};

export const buildDistributionChartData = (engagementDistribution = []) => {
  const colorMap = {
    viral_reach: '#10b981',
    high_reach: '#3b82f6',
    medium_reach: '#f59e0b',
    low_reach: '#ef4444',
    no_impressions: '#6b7280',
  };

  return engagementDistribution.map((row) => ({
    key: row.reach_category,
    name: toTitleCase(row.reach_category),
    value: toNumber(row.tweets_count),
    fill: colorMap[row.reach_category] || '#94a3b8',
    avgImpressions: Math.round(toNumber(row.avg_impressions)),
  }));
};

export const buildAudienceSummary = ({
  overview = {},
  reachMetrics = [],
  engagementDistribution = [],
  optimalTimes = [],
  contentSignals = {},
}) => {
  const totals = reachMetrics.reduce(
    (acc, row) => {
      acc.impressions += toNumber(row.total_impressions);
      acc.engagement += toNumber(row.total_engagement);
      acc.reachDays += 1;
      acc.tweetsWithImpressions += toNumber(row.tweets_with_impressions);
      return acc;
    },
    { impressions: 0, engagement: 0, reachDays: 0, tweetsWithImpressions: 0 }
  );

  const totalTweets = Math.max(1, toNumber(overview.total_tweets));
  const avgImpressionsPerTweet = safeDivide(totals.impressions, totalTweets);
  const engagementRate = safeDivide(totals.engagement * 100, Math.max(totals.impressions, 1));
  const discussionRate = safeDivide(toNumber(overview.total_replies) * 100, Math.max(totals.impressions, 1));
  const shareRate = safeDivide(toNumber(overview.total_retweets) * 100, Math.max(totals.impressions, 1));
  const likeRate = safeDivide(toNumber(overview.total_likes) * 100, Math.max(totals.impressions, 1));
  const saveRate = safeDivide(toNumber(overview.total_bookmarks) * 100, Math.max(totals.impressions, 1));

  const distributionTotals = engagementDistribution.reduce(
    (acc, row) => {
      const key = String(row.reach_category || 'unknown');
      const count = toNumber(row.tweets_count);
      acc.total += count;
      acc[key] = (acc[key] || 0) + count;
      return acc;
    },
    { total: 0 }
  );

  const highReachShare = safeDivide(
    ((distributionTotals.high_reach || 0) + (distributionTotals.viral_reach || 0)) * 100,
    Math.max(distributionTotals.total, 1)
  );
  const noReachShare = safeDivide((distributionTotals.no_impressions || 0) * 100, Math.max(distributionTotals.total, 1));

  const topTime = buildRecommendedSlots(optimalTimes, 1)[0] || null;
  const favoriteContentType = contentSignals?.bestContentType?.key || 'unknown';

  return {
    totalReach: Math.round(totals.impressions),
    engagedUsers: Math.round(totals.engagement),
    tweetsWithImpressions: Math.round(totals.tweetsWithImpressions),
    avgImpressionsPerTweet: Math.round(avgImpressionsPerTweet),
    engagementRate,
    discussionRate,
    shareRate,
    likeRate,
    saveRate,
    highReachShare,
    noReachShare,
    topTime,
    favoriteContentType,
  };
};

const getConfidenceLabel = (sampleSize) => {
  if (sampleSize >= 30) return 'High';
  if (sampleSize >= 10) return 'Medium';
  return 'Low';
};

export const buildAiInsights = ({
  overview = {},
  timeframeDays = 50,
  growthMetrics = {},
  contentSignals = {},
  recommendedSlots = [],
  audienceSummary = {},
}) => {
  const insights = [];
  const totalTweets = toNumber(overview.total_tweets);
  const engagementRate = toNumber(overview.engagement_rate);
  const tweetsPerDay = safeDivide(totalTweets, Math.max(timeframeDays, 1));
  const confidence = getConfidenceLabel(totalTweets);

  if (engagementRate >= 3) {
    insights.push({
      type: 'success',
      title: 'Strong Engagement Momentum',
      message: `Your ${engagementRate.toFixed(1)}% engagement rate is outperforming common account baselines.`,
      confidence,
    });
  } else if (engagementRate >= 1.5) {
    insights.push({
      type: 'info',
      title: 'Healthy Baseline, Room to Scale',
      message: `Current engagement is ${engagementRate.toFixed(1)}%. Focus on timing and format to push past 3%.`,
      confidence,
    });
  } else {
    insights.push({
      type: 'warning',
      title: 'Engagement Recovery Needed',
      message: `Engagement is ${engagementRate.toFixed(1)}%. Prioritize stronger hooks, clearer CTAs, and high-performing slots.`,
      confidence,
    });
  }

  if (tweetsPerDay < 1) {
    insights.push({
      type: 'warning',
      title: 'Posting Cadence Is Limiting Reach',
      message: `You publish ${tweetsPerDay.toFixed(1)} tweets/day. Moving toward 1-2 daily posts should improve distribution.`,
      confidence,
    });
  }

  const threadScore = contentSignals?.threadVsSingle?.thread || 0;
  const singleScore = contentSignals?.threadVsSingle?.single || 0;
  if (threadScore > 0 && singleScore > 0 && threadScore > singleScore) {
    const uplift = ((threadScore - singleScore) / singleScore) * 100;
    insights.push({
      type: 'opportunity',
      title: 'Threads Are Your Growth Lever',
      message: `Thread engagement is approximately ${uplift.toFixed(0)}% higher than single tweets.`,
      confidence,
    });
  }

  if (recommendedSlots.length > 0) {
    const best = recommendedSlots[0];
    insights.push({
      type: 'info',
      title: 'Timing Edge Detected',
      message: `${best.dayName} around ${String(best.hour).padStart(2, '0')}:00 is your highest-performing slot.`,
      confidence: getConfidenceLabel(best.tweetsCount),
    });
  }

  if (audienceSummary.noReachShare >= 35) {
    insights.push({
      type: 'warning',
      title: 'Reach Reliability Is Volatile',
      message: `${audienceSummary.noReachShare.toFixed(0)}% of tweets land in no-impression buckets. Increase consistency and test stronger opening lines.`,
      confidence,
    });
  }

  return insights.slice(0, 6);
};

export const buildRecommendations = ({
  overview = {},
  timeframeDays = 50,
  growthMetrics = {},
  contentSignals = {},
  audienceSummary = {},
  recommendedSlots = [],
}) => {
  const recs = [];
  const totalTweets = toNumber(overview.total_tweets);
  const tweetsPerDay = safeDivide(totalTweets, Math.max(timeframeDays, 1));
  const engagementRate = toNumber(overview.engagement_rate);

  if (tweetsPerDay < 1) {
    recs.push({
      priority: 'high',
      title: 'Increase Publishing Frequency',
      description: `Current cadence is ${tweetsPerDay.toFixed(1)} tweets/day. Target at least 1.2/day for steadier reach.`,
      metricLabel: 'Cadence',
      metricValue: `${tweetsPerDay.toFixed(1)} / day`,
    });
  }

  if (engagementRate < 2) {
    recs.push({
      priority: 'high',
      title: 'Improve Hook + CTA Structure',
      description: `Engagement rate is ${engagementRate.toFixed(1)}%. Use first-line hooks and explicit response prompts.`,
      metricLabel: 'Engagement Rate',
      metricValue: `${engagementRate.toFixed(1)}%`,
    });
  }

  const thread = contentSignals?.threadVsSingle?.thread || 0;
  const single = contentSignals?.threadVsSingle?.single || 0;
  if (thread > 0 && single > 0 && thread > single) {
    recs.push({
      priority: 'medium',
      title: 'Shift Mix Toward Threads',
      description: 'Threads outperform single tweets in your current dataset. Increase thread share in weekly planning.',
      metricLabel: 'Thread Advantage',
      metricValue: `${(((thread - single) / single) * 100).toFixed(0)}%`,
    });
  }

  if (audienceSummary.noReachShare >= 35) {
    recs.push({
      priority: 'medium',
      title: 'Reduce Zero-Reach Posts',
      description: 'A large share of posts are not getting impressions. Focus on quality over quantity and stronger timing.',
      metricLabel: 'No Reach Share',
      metricValue: `${audienceSummary.noReachShare.toFixed(0)}%`,
    });
  }

  if (recommendedSlots.length > 0) {
    const best = recommendedSlots[0];
    recs.push({
      priority: 'low',
      title: 'Anchor Key Posts to Peak Slot',
      description: `Schedule high-value posts around ${best.dayName} ${String(best.hour).padStart(2, '0')}:00.`,
      metricLabel: 'Peak Slot',
      metricValue: `${best.avgEngagement.toFixed(0)} avg engagement`,
    });
  }

  if (toNumber(growthMetrics.impressions) < 0) {
    recs.push({
      priority: 'high',
      title: 'Reverse Reach Decline',
      description: 'Impressions are trending down versus previous period. Increase posting consistency and experiment with proven formats.',
      metricLabel: 'Impressions Growth',
      metricValue: `${toNumber(growthMetrics.impressions).toFixed(1)}%`,
    });
  }

  if (recs.length === 0) {
    recs.push({
      priority: 'low',
      title: 'Maintain Current Strategy',
      description: 'Current indicators are stable. Continue iterating in small weekly experiments.',
      metricLabel: 'Status',
      metricValue: 'Stable',
    });
  }

  const priorityScore = { high: 3, medium: 2, low: 1 };
  return recs.sort((a, b) => priorityScore[b.priority] - priorityScore[a.priority]);
};

export const buildGoalTargets = ({ overview = {}, timeframeDays = 50 }) => {
  const totalTweets = toNumber(overview.total_tweets);
  const avgPerDay = safeDivide(totalTweets, Math.max(timeframeDays, 1));
  const engagementRate = toNumber(overview.engagement_rate);
  const avgImpressions = toNumber(overview.avg_impressions);

  const targetTweetsPerDay = Math.max(1.2, avgPerDay * 1.2);
  const targetEngagementRate = engagementRate + Math.max(0.8, Math.min(2.0, engagementRate * 0.35));
  const targetAvgImpressions = avgImpressions > 0 ? avgImpressions * 1.25 : 300;

  return {
    tweetsPerDay: {
      current: avgPerDay,
      target: targetTweetsPerDay,
    },
    engagementRate: {
      current: engagementRate,
      target: targetEngagementRate,
    },
    avgImpressions: {
      current: avgImpressions,
      target: targetAvgImpressions,
    },
  };
};
