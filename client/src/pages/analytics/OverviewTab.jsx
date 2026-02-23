import React from 'react';
import { BarChart3, ExternalLink, Eye, Heart, Lock, MessageCircle, Repeat2 } from 'lucide-react';
import { getSuiteGenieProUpgradeUrl } from '../../utils/upgradeUrl';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const formatValue = (value) => {
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return value;
};

const formatGrowth = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}%`;
};

const growthClass = (value) => {
  if (value === null || value === undefined) return 'text-gray-500';
  return Number(value) >= 0 ? 'text-green-600' : 'text-red-600';
};

const formatDateTime = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
};

const toXStatusUrl = (tweetId) => {
  if (!tweetId) return null;
  return `https://x.com/i/web/status/${tweetId}`;
};

const OverviewTab = ({
  stats,
  chartData,
  hourlyData,
  topTweets,
  recentTweets = [],
  timeframe,
  isProPlan = true,
  showAdvancedCharts = true,
  updatedTweetIds,
  skippedTweetIds,
  refreshingTweetIds = new Set(),
  onForceCheckTweet = null,
}) => {
  const upgradeUrl = getSuiteGenieProUpgradeUrl();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const growth = formatGrowth(stat.growth);
          return (
            <div key={stat.name} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.name}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{formatValue(stat.value)}</p>
                  <p className="text-xs text-gray-500 mt-1">{stat.subtitle}</p>
                </div>
                <div className={`rounded-xl p-3 ${stat.bgColor}`}>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              {growth && (
                <div className={`mt-3 text-sm font-medium ${growthClass(stat.growth)}`}>
                  {growth} vs previous period
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdvancedCharts ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Reach vs Engagement Trend</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="impressions" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.25} />
                  <Area
                    type="monotone"
                    dataKey="total_engagement"
                    stroke="#059669"
                    fill="#10b981"
                    fillOpacity={0.25}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-16 text-center text-gray-500">No daily metrics available for this timeframe.</div>
            )}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Hourly Engagement Heat</h3>
            {hourlyData.some((row) => row.tweets > 0) ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" interval={2} />
                  <YAxis />
                  <Tooltip formatter={(value, name) => [value, name === 'engagement' ? 'Avg engagement' : 'Tweets']} />
                  <Bar dataKey="engagement" name="engagement" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-16 text-center text-gray-500">No hourly engagement data available.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="card border border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-700 mt-0.5" />
            <div>
              <h3 className="text-lg font-semibold text-amber-900">Trend charts are Pro only</h3>
              <p className="text-sm text-amber-800 mt-1">
                Upgrade to Pro to unlock daily trend charts, engagement breakdowns, and timing insights.
              </p>
              <a href={upgradeUrl} className="btn btn-primary mt-4 inline-flex items-center">
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Top Posts</h3>
          <span className="text-sm text-gray-500">
            {isProPlan ? `Last ${timeframe} days • Top 20` : 'Last 7 days • Top 5 (Free)'}
          </span>
        </div>

        {topTweets.length > 0 ? (
          <div className="space-y-4">
            {topTweets.map((tweet, index) => {
              let badge = null;
              if (updatedTweetIds.has(tweet.id)) {
                badge = (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-green-200 text-green-800 text-xs font-semibold">
                    Synced
                  </span>
                );
              } else if (skippedTweetIds.has(tweet.id)) {
                badge = (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-800 text-xs font-semibold">
                    Skipped
                  </span>
                );
              }

              const content = String(tweet.content || '');
              const preview = content.split('---')[0].slice(0, 220);
              const tweetId = tweet.tweet_id ? String(tweet.tweet_id) : null;
              const xUrl = toXStatusUrl(tweetId);
              const metricsUpdatedAt = tweet.metrics_updated_at || tweet.created_at || null;
              const isRefreshing = refreshingTweetIds.has(tweet.id);

              return (
                <div key={tweet.id} className="p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full">
                          {index + 1}
                        </span>
                        <span className="text-xs text-gray-500">
                          {tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : 'Unknown date'}
                        </span>
                        {tweetId && (
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                            ID: {tweetId}
                          </span>
                        )}
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                          {Number(tweet.tweet_engagement_rate || 0).toFixed(1)}% engagement rate
                        </span>
                        {badge}
                      </div>

                      <p className="text-gray-700 mb-3 line-clamp-3">
                        {preview}
                        {content.length > preview.length ? '...' : ''}
                      </p>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="flex items-center text-gray-600">
                          <Eye className="h-4 w-4 mr-1" />
                          <span className="font-medium">{Number(tweet.impressions || 0).toLocaleString()}</span>
                          <span className="ml-1">views</span>
                        </div>
                        <div className="flex items-center text-red-600">
                          <Heart className="h-4 w-4 mr-1" />
                          <span className="font-medium">{Number(tweet.likes || 0)}</span>
                          <span className="ml-1">likes</span>
                        </div>
                        <div className="flex items-center text-green-600">
                          <Repeat2 className="h-4 w-4 mr-1" />
                          <span className="font-medium">{Number(tweet.retweets || 0)}</span>
                          <span className="ml-1">retweets</span>
                        </div>
                        <div className="flex items-center text-blue-600">
                          <MessageCircle className="h-4 w-4 mr-1" />
                          <span className="font-medium">{Number(tweet.replies || 0)}</span>
                          <span className="ml-1">replies</span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span>Metrics updated: {formatDateTime(metricsUpdatedAt)}</span>
                        {isProPlan && onForceCheckTweet && (
                          <button
                            type="button"
                            onClick={() => onForceCheckTweet(tweet.id)}
                            disabled={isRefreshing}
                            className={`px-2 py-1 rounded border ${
                              isRefreshing
                                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'border-blue-200 text-blue-600 hover:bg-blue-50'
                            }`}
                          >
                            {isRefreshing ? 'Checking...' : 'Force check'}
                          </button>
                        )}
                        {xUrl && (
                          <a
                            href={xUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                          >
                            View on X
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-10">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No tweet performance data available yet.</p>
            <p className="text-sm text-gray-500 mt-2">Post tweets and run sync to populate this section.</p>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-gray-900">Recent Posts (Tracking Check)</h4>
            <span className="text-xs text-gray-500">{isProPlan ? 'Latest 10' : 'Latest 5'}</span>
          </div>

          {recentTweets.length > 0 ? (
            <div className="space-y-3">
              {recentTweets.map((tweet) => {
                const content = String(tweet.content || '');
                const preview = content.split('---')[0].slice(0, 180);
                const tweetId = tweet.tweet_id ? String(tweet.tweet_id) : null;
                const xUrl = toXStatusUrl(tweetId);
                const engagement = Number(tweet.likes || 0) + Number(tweet.retweets || 0) + Number(tweet.replies || 0);

                return (
                  <div key={`recent-${tweet.id}`} className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-xs text-gray-500">
                        {tweet.created_at ? new Date(tweet.created_at).toLocaleString() : 'Unknown date'}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
                          {engagement} engagement
                        </span>
                        {tweet.source && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            {String(tweet.source)}
                          </span>
                        )}
                        {xUrl && (
                          <a
                            href={xUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                          >
                            View
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">
                      {preview}
                      {content.length > preview.length ? '...' : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No recent posts found in this analytics window yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
