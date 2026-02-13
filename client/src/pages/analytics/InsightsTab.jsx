import React from 'react';
import { AlertCircle, CheckCircle, Info, TrendingDown, TrendingUp } from 'lucide-react';

const insightStyles = {
  success: {
    container: 'bg-green-50 border-green-200',
    title: 'text-green-900',
    body: 'text-green-700',
    icon: CheckCircle,
    iconClass: 'text-green-600',
  },
  warning: {
    container: 'bg-orange-50 border-orange-200',
    title: 'text-orange-900',
    body: 'text-orange-700',
    icon: AlertCircle,
    iconClass: 'text-orange-600',
  },
  opportunity: {
    container: 'bg-blue-50 border-blue-200',
    title: 'text-blue-900',
    body: 'text-blue-700',
    icon: TrendingUp,
    iconClass: 'text-blue-600',
  },
  info: {
    container: 'bg-indigo-50 border-indigo-200',
    title: 'text-indigo-900',
    body: 'text-indigo-700',
    icon: Info,
    iconClass: 'text-indigo-600',
  },
};

const formatGrowth = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

const InsightsTab = ({ aiInsights, performanceScore, growthMetrics, overview }) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">AI Insights (Rule-Based)</h3>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Live analytics model</span>
          </div>

          {aiInsights.length > 0 ? (
            <div className="space-y-3">
              {aiInsights.map((insight, index) => {
                const style = insightStyles[insight.type] || insightStyles.info;
                const Icon = style.icon;

                return (
                  <div key={`${insight.title}-${index}`} className={`p-4 border rounded-lg ${style.container}`}>
                    <div className="flex items-start">
                      <Icon className={`h-5 w-5 mt-0.5 mr-3 ${style.iconClass}`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className={`font-medium ${style.title}`}>{insight.title}</h4>
                          {insight.confidence && (
                            <span className="text-xs bg-white/70 text-gray-700 px-2 py-1 rounded">
                              Confidence: {insight.confidence}
                            </span>
                          )}
                        </div>
                        <p className={`text-sm mt-1 ${style.body}`}>{insight.message}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500">Not enough data to generate insights yet.</div>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Score</h3>
          <div className="flex items-end justify-between mb-2">
            <span className="text-4xl font-bold text-gray-900">{performanceScore}</span>
            <span className="text-sm text-gray-500">/100</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
            <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${performanceScore}%` }} />
          </div>
          <p className="text-sm text-gray-600">
            Score combines engagement quality, growth trend, posting consistency, and reach reliability.
          </p>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Signal Dashboard</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">Tweet growth</p>
            <div className="mt-2 flex items-center gap-2">
              {growthMetrics.tweets >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span className={`font-semibold ${growthMetrics.tweets >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatGrowth(growthMetrics.tweets)}
              </span>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">Impressions growth</p>
            <div className="mt-2 flex items-center gap-2">
              {growthMetrics.impressions >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span className={`font-semibold ${growthMetrics.impressions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatGrowth(growthMetrics.impressions)}
              </span>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">Engagement growth</p>
            <div className="mt-2 flex items-center gap-2">
              {growthMetrics.engagement >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span className={`font-semibold ${growthMetrics.engagement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatGrowth(growthMetrics.engagement)}
              </span>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">Current engagement rate</p>
            <div className="mt-2 text-xl font-semibold text-gray-900">
              {Number(overview.engagement_rate || 0).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InsightsTab;
