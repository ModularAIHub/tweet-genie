import React, { useMemo } from 'react';
import { CheckCircle, Clock, Moon, Sun, Sunrise } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const summarizeDayPart = (hourlyData, startHour, endHour, label, description) => {
  const rows = hourlyData.filter(
    (row) => row.hour >= startHour && row.hour < endHour && Number(row.tweets || 0) > 0
  );
  if (rows.length === 0) {
    return {
      label,
      description,
      peakHour: null,
      avgEngagement: 0,
      tweets: 0,
    };
  }

  const totalEngagement = rows.reduce((sum, row) => sum + Number(row.engagement || 0), 0);
  const totalTweets = rows.reduce((sum, row) => sum + Number(row.tweets || 0), 0);
  const peak = [...rows].sort((a, b) => Number(b.engagement || 0) - Number(a.engagement || 0))[0];

  return {
    label,
    description,
    peakHour: peak?.hour ?? null,
    avgEngagement: rows.length > 0 ? totalEngagement / rows.length : 0,
    tweets: totalTweets,
  };
};

const slotRankClass = (index) => {
  if (index === 0) return 'bg-green-100 text-green-800';
  if (index <= 2) return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-700';
};

const TimingTab = ({ hourlyData, dayPerformance, recommendedSlots }) => {
  const dayPartCards = useMemo(
    () => [
      summarizeDayPart(hourlyData, 6, 12, 'Morning (06:00-12:00)', 'Educational and tutorial content'),
      summarizeDayPart(hourlyData, 12, 18, 'Afternoon (12:00-18:00)', 'Insights and trend-driven posts'),
      summarizeDayPart(hourlyData, 18, 24, 'Evening (18:00-24:00)', 'Stories and community conversation'),
    ],
    [hourlyData]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {dayPartCards.map((slot, index) => {
          const Icon = index === 0 ? Sunrise : index === 1 ? Sun : Moon;
          const bgClass = index === 0 ? 'from-yellow-50 to-orange-50' : index === 1 ? 'from-orange-50 to-red-50' : 'from-blue-50 to-purple-50';
          return (
            <div key={slot.label} className={`card bg-gradient-to-br ${bgClass}`}>
              <div className="flex items-center mb-4">
                <Icon className="h-6 w-6 text-gray-700 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">{slot.label}</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Best for</span>
                  <span className="font-medium text-gray-900">{slot.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Peak hour</span>
                  <span className="font-medium text-gray-900">
                    {slot.peakHour === null ? 'N/A' : `${String(slot.peakHour).padStart(2, '0')}:00`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg engagement</span>
                  <span className="font-medium text-green-700">{slot.avgEngagement.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Sample tweets</span>
                  <span className="font-medium text-gray-900">{slot.tweets}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">24-Hour Engagement Map</h3>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={hourlyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" interval={2} />
            <YAxis />
            <Tooltip formatter={(value, name) => [value, name === 'engagement' ? 'Avg engagement' : 'Tweets']} />
            <Bar dataKey="engagement" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Performance Pattern</h3>
          <div className="space-y-3">
            {dayPerformance.map((day) => (
              <div key={day.day} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center">
                  <div
                    className={`w-3 h-3 rounded-full mr-3 ${
                      day.score >= 70 ? 'bg-green-500' : day.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="font-medium text-gray-900">{day.dayName}</span>
                  {day.isWeekend && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Weekend</span>
                  )}
                </div>
                <div className="flex items-center gap-3 min-w-[160px]">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        day.score >= 70 ? 'bg-green-500' : day.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${day.tweets > 0 ? Math.max(6, day.score) : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-600 w-10 text-right">{day.score.toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recommended Posting Slots</h3>
          {recommendedSlots.length > 0 ? (
            <div className="space-y-3">
              {recommendedSlots.slice(0, 8).map((slot, index) => (
                <div key={`${slot.day}-${slot.hour}-${index}`} className="p-3 rounded-lg border bg-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${slotRankClass(index)}`}>
                        Rank #{index + 1}
                      </span>
                      <span className="font-medium text-gray-900">
                        {slot.dayName}, {String(slot.hour).padStart(2, '0')}:00
                      </span>
                    </div>
                    <Clock className="h-4 w-4 text-gray-400" />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
                    <span>Avg engagement: {slot.avgEngagement.toFixed(0)}</span>
                    <span>Sample tweets: {slot.tweetsCount}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-500">
              Not enough timing data yet. Post more tweets to unlock timing recommendations.
            </div>
          )}
        </div>
      </div>

      {recommendedSlots.length > 0 && (
        <div className="card bg-green-50 border border-green-100">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium text-green-900">Execution Tip</p>
              <p className="text-sm text-green-700 mt-1">
                Schedule highest-priority posts in your top 3 slots, and use lower-priority slots for experiments.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimingTab;
