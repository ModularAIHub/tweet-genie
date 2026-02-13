import React from 'react';
import { Activity, Bookmark, Clock, Eye, Heart, MessageCircle, Repeat2, Users } from 'lucide-react';
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const prettify = (value) =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const metricPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

const AudienceTab = ({ audienceSummary, distributionChartData, reachChartData, recommendedSlots, contentSignals }) => {
  const topSlot = recommendedSlots[0];
  const bestContent = contentSignals?.bestContentType?.key ? prettify(contentSignals.bestContentType.key) : 'Unknown';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card bg-gradient-to-br from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3 mb-3">
            <Users className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold text-gray-900">Total Reach</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{audienceSummary.totalReach.toLocaleString()}</p>
          <p className="text-sm text-gray-600 mt-1">Impressions in selected timeframe</p>
        </div>

        <div className="card bg-gradient-to-br from-green-50 to-emerald-50">
          <div className="flex items-center gap-3 mb-3">
            <Activity className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold text-gray-900">Engaged Users</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{audienceSummary.engagedUsers.toLocaleString()}</p>
          <p className="text-sm text-gray-600 mt-1">{metricPercent(audienceSummary.engagementRate)} engagement rate</p>
        </div>

        <div className="card bg-gradient-to-br from-purple-50 to-pink-50">
          <div className="flex items-center gap-3 mb-3">
            <Eye className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold text-gray-900">Avg Reach / Tweet</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{audienceSummary.avgImpressionsPerTweet.toLocaleString()}</p>
          <p className="text-sm text-gray-600 mt-1">{metricPercent(audienceSummary.highReachShare)} high/viral share</p>
        </div>

        <div className="card bg-gradient-to-br from-orange-50 to-red-50">
          <div className="flex items-center gap-3 mb-3">
            <MessageCircle className="h-5 w-5 text-orange-600" />
            <h3 className="font-semibold text-gray-900">Reach Reliability</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{metricPercent(100 - audienceSummary.noReachShare)}</p>
          <p className="text-sm text-gray-600 mt-1">{metricPercent(audienceSummary.noReachShare)} no-impression share</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Reach Distribution</h3>
          {distributionChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={distributionChartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {distributionChartData.map((entry, index) => (
                    <Cell key={`${entry.key}-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, _name, props) => [`${value} tweets`, props?.payload?.name]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-16 text-center text-gray-500">No reach-distribution data available.</div>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Reach Trend</h3>
          {reachChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={reachChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="impressions" stroke="#2563eb" strokeWidth={2} name="Impressions" />
                <Line type="monotone" dataKey="engagement" stroke="#059669" strokeWidth={2} name="Engagement" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-16 text-center text-gray-500">No daily audience trend data available.</div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Audience Behavior Signals</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center mb-2">
              <Clock className="h-5 w-5 text-blue-500 mr-2" />
              <h4 className="font-medium text-blue-900">Most Active Slot</h4>
            </div>
            <p className="text-xl font-bold text-blue-700">
              {topSlot ? `${topSlot.dayName} ${String(topSlot.hour).padStart(2, '0')}:00` : 'N/A'}
            </p>
            <p className="text-sm text-blue-600">Best posting window based on engagement</p>
          </div>

          <div className="p-4 bg-green-50 rounded-lg">
            <div className="flex items-center mb-2">
              <Heart className="h-5 w-5 text-green-500 mr-2" />
              <h4 className="font-medium text-green-900">Favorite Format</h4>
            </div>
            <p className="text-xl font-bold text-green-700">{bestContent}</p>
            <p className="text-sm text-green-600">Highest weighted engagement profile</p>
          </div>

          <div className="p-4 bg-purple-50 rounded-lg">
            <div className="flex items-center mb-2">
              <Repeat2 className="h-5 w-5 text-purple-500 mr-2" />
              <h4 className="font-medium text-purple-900">Reshare Rate</h4>
            </div>
            <p className="text-xl font-bold text-purple-700">{metricPercent(audienceSummary.shareRate)}</p>
            <p className="text-sm text-purple-600">Retweets per impression</p>
          </div>

          <div className="p-4 bg-orange-50 rounded-lg">
            <div className="flex items-center mb-2">
              <Bookmark className="h-5 w-5 text-orange-500 mr-2" />
              <h4 className="font-medium text-orange-900">Save Rate</h4>
            </div>
            <p className="text-xl font-bold text-orange-700">{metricPercent(audienceSummary.saveRate)}</p>
            <p className="text-sm text-orange-600">Bookmarks per impression</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudienceTab;
