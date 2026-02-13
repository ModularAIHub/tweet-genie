import React, { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const prettify = (value) =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const safePercent = (value) => `${Number(value || 0).toFixed(1)}%`;
const displaySignalValue = (value) => {
  const normalized = prettify(value || 'unknown');
  return normalized === 'Unknown' ? 'Insufficient data' : normalized;
};

const ContentTab = ({ contentComparison, engagementPatterns, contentSignals }) => {
  const topPatterns = useMemo(
    () =>
      [...engagementPatterns]
        .sort((a, b) => Number(b.avg_total_engagement || 0) - Number(a.avg_total_engagement || 0))
        .slice(0, 8),
    [engagementPatterns]
  );

  const threadScore = Number(contentSignals?.threadVsSingle?.thread || 0);
  const singleScore = Number(contentSignals?.threadVsSingle?.single || 0);
  const threadUplift = singleScore > 0 ? ((threadScore - singleScore) / singleScore) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Content Type Performance</h3>
          {contentComparison.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={contentComparison}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avgImpressions" fill="#3b82f6" name="Avg impressions" />
                <Bar dataKey="avgEngagement" fill="#10b981" name="Avg engagement" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-16 text-center text-gray-500">No content-type metrics available yet.</div>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Strategy Signals</h3>
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-blue-700">Best content format</p>
              <p className="mt-1 text-lg font-semibold text-blue-900">
                {displaySignalValue(contentSignals?.bestContentType?.key)}
              </p>
            </div>

            <div className="p-4 bg-green-50 rounded-lg border border-green-100">
              <p className="text-sm text-green-700">Best hashtag usage</p>
              <p className="mt-1 text-lg font-semibold text-green-900">
                {displaySignalValue(contentSignals?.bestHashtagUsage?.key)}
              </p>
            </div>

            <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
              <p className="text-sm text-purple-700">Best content length</p>
              <p className="mt-1 text-lg font-semibold text-purple-900">
                {displaySignalValue(contentSignals?.bestContentLength?.key)}
              </p>
            </div>

            {threadScore > 0 && singleScore > 0 && (
              <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-sm text-indigo-700">Thread advantage</p>
                <p className="mt-1 text-lg font-semibold text-indigo-900">
                  {threadUplift >= 0 ? '+' : ''}
                  {threadUplift.toFixed(0)}%
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center mb-4">
          <Lightbulb className="h-5 w-5 text-blue-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">High-Performing Pattern Combinations</h3>
        </div>

        {topPatterns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b">
                  <th className="py-2 pr-4">Format</th>
                  <th className="py-2 pr-4">Hashtags</th>
                  <th className="py-2 pr-4">Length</th>
                  <th className="py-2 pr-4">Tweets</th>
                  <th className="py-2 pr-4">Avg Impressions</th>
                  <th className="py-2 pr-4">Avg Engagement</th>
                  <th className="py-2">Engagement Rate</th>
                </tr>
              </thead>
              <tbody>
                {topPatterns.map((row, index) => (
                  <tr key={`${row.content_type}-${row.hashtag_usage}-${row.content_length}-${index}`} className="border-b">
                    <td className="py-2 pr-4 font-medium text-gray-900">{prettify(row.content_type)}</td>
                    <td className="py-2 pr-4">{prettify(row.hashtag_usage)}</td>
                    <td className="py-2 pr-4">{prettify(row.content_length)}</td>
                    <td className="py-2 pr-4">{Number(row.tweets_count || 0)}</td>
                    <td className="py-2 pr-4">{Math.round(Number(row.avg_impressions || 0)).toLocaleString()}</td>
                    <td className="py-2 pr-4">{Math.round(Number(row.avg_total_engagement || 0)).toLocaleString()}</td>
                    <td className="py-2">{safePercent(row.avg_engagement_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-gray-500">Not enough pattern data available yet.</div>
        )}
      </div>
    </div>
  );
};

export default ContentTab;
