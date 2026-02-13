import React from 'react';
import { Calendar, Clock, Download, Target } from 'lucide-react';

const priorityStyles = {
  high: {
    container: 'bg-red-50 border-red-200',
    badge: 'bg-red-100 text-red-800',
    title: 'text-red-900',
    body: 'text-red-700',
  },
  medium: {
    container: 'bg-yellow-50 border-yellow-200',
    badge: 'bg-yellow-100 text-yellow-800',
    title: 'text-yellow-900',
    body: 'text-yellow-700',
  },
  low: {
    container: 'bg-blue-50 border-blue-200',
    badge: 'bg-blue-100 text-blue-800',
    title: 'text-blue-900',
    body: 'text-blue-700',
  },
};

const engagementClass = (label) => {
  if (label === 'Very High') return 'bg-green-100 text-green-800';
  if (label === 'High') return 'bg-blue-100 text-blue-800';
  if (label === 'Medium') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-800';
};

const RecommendationsTab = ({ recommendations, goals, calendarEntries }) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center mb-4">
            <Target className="h-6 w-6 text-red-500 mr-3" />
            <h3 className="text-xl font-semibold text-gray-900">Prioritized Actions</h3>
          </div>

          <div className="space-y-3">
            {recommendations.map((recommendation, index) => {
              const style = priorityStyles[recommendation.priority] || priorityStyles.low;
              return (
                <div key={`${recommendation.title}-${index}`} className={`p-4 border rounded-lg ${style.container}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${style.badge}`}>
                          {recommendation.priority.toUpperCase()}
                        </span>
                        <h4 className={`font-medium ${style.title}`}>{recommendation.title}</h4>
                      </div>
                      <p className={`text-sm ${style.body}`}>{recommendation.description}</p>
                    </div>
                    <div className="text-right min-w-[96px]">
                      <p className="text-xs text-gray-500">{recommendation.metricLabel}</p>
                      <p className="text-sm font-semibold text-gray-800">{recommendation.metricValue}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">30-Day Targets</h3>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">Tweets per day</p>
                  <p className="text-sm text-gray-600">Cadence target</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Current: {goals.tweetsPerDay.current.toFixed(2)}</p>
                  <p className="font-semibold text-blue-600">Target: {goals.tweetsPerDay.target.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">Engagement rate</p>
                  <p className="text-sm text-gray-600">Interaction quality target</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Current: {goals.engagementRate.current.toFixed(1)}%</p>
                  <p className="font-semibold text-green-600">Target: {goals.engagementRate.target.toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">Avg impressions</p>
                  <p className="text-sm text-gray-600">Distribution target</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">
                    Current: {Math.round(goals.avgImpressions.current).toLocaleString()}
                  </p>
                  <p className="font-semibold text-purple-600">
                    Target: {Math.round(goals.avgImpressions.target).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Calendar className="h-6 w-6 text-green-500 mr-3" />
            <h3 className="text-xl font-semibold text-gray-900">Suggested Content Calendar</h3>
          </div>
          <button type="button" className="btn btn-secondary btn-sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </button>
        </div>

        {calendarEntries.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {calendarEntries.map((entry, index) => (
              <div key={`${entry.day}-${entry.time}-${index}`} className="p-4 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{entry.day}</h4>
                  <span className={`text-xs px-2 py-1 rounded-full ${engagementClass(entry.engagement)}`}>
                    {entry.engagement}
                  </span>
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex items-center">
                    <Clock className="h-3 w-3 mr-1" />
                    <span>{entry.time}</span>
                  </div>
                  <div className="font-medium text-gray-800">{entry.type}</div>
                  <div>{entry.topic}</div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Based on {entry.tweetsCount} sample tweet{entry.tweetsCount === 1 ? '' : 's'} in this slot
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-10 text-center text-gray-500">
            Not enough timing signals yet to generate a schedule. Run sync and post more consistently.
          </div>
        )}
      </div>
    </div>
  );
};

export default RecommendationsTab;

