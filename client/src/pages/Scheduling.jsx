import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CheckCircle,
  Clock,
  Pause,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import { scheduling as schedulingAPI } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const FILTER_OPTIONS = [
  { value: 'pending', label: 'Scheduled', icon: Clock, color: 'blue' },
  { value: 'posted', label: 'Posted', icon: CheckCircle, color: 'green' },
  { value: 'failed', label: 'Failed', icon: AlertCircle, color: 'red' },
  { value: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'gray' },
];

const ACTIVE_FILTER_CLASSES = {
  blue: 'bg-blue-100 text-blue-700 ring-2 ring-blue-500 ring-offset-1',
  green: 'bg-green-100 text-green-700 ring-2 ring-green-500 ring-offset-1',
  red: 'bg-red-100 text-red-700 ring-2 ring-red-500 ring-offset-1',
  gray: 'bg-gray-200 text-gray-700 ring-2 ring-gray-400 ring-offset-1',
};

const normalizeSchedulingFilter = (value) => {
  const normalized = String(value || 'pending').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'complete') return 'posted';
  if (normalized === 'canceled') return 'cancelled';
  if (FILTER_OPTIONS.some((option) => option.value === normalized)) return normalized;
  return 'pending';
};

const TIMEZONE_ALIAS_MAP = {
  'Asia/Calcutta': 'Asia/Kolkata',
};

const normalizeTimezone = (timezone) => {
  if (!timezone) return null;
  return TIMEZONE_ALIAS_MAP[timezone] || timezone;
};

const hasExplicitTimezone = (value) => /(?:[zZ]|[+\-]\d{2}:?\d{2})$/.test(value);

const parseUtcDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = hasExplicitTimezone(raw)
    ? raw
    : `${raw.replace(' ', 'T')}Z`;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isValidTimezone = (timezone) => {
  if (!timezone) return false;
  const normalized = normalizeTimezone(timezone);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const formatDatePart = (dateValue, timezone) => {
  const parsed = parseUtcDate(dateValue);
  if (!parsed) return '--';

  const options = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };

  const normalized = normalizeTimezone(timezone);
  if (isValidTimezone(normalized)) {
    options.timeZone = normalized;
  }

  return new Intl.DateTimeFormat('en-US', options).format(parsed);
};

const formatTimePart = (dateValue, timezone) => {
  const parsed = parseUtcDate(dateValue);
  if (!parsed) return '--';

  const options = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };

  const normalized = normalizeTimezone(timezone);
  if (isValidTimezone(normalized)) {
    options.timeZone = normalized;
  }

  return new Intl.DateTimeFormat('en-US', options).format(parsed);
};

const getMediaCount = (mediaUrls) => {
  if (Array.isArray(mediaUrls)) {
    return mediaUrls.filter((url) => Boolean(url)).length;
  }

  if (typeof mediaUrls === 'string' && mediaUrls.trim()) {
    try {
      const parsed = JSON.parse(mediaUrls);
      return Array.isArray(parsed) ? parsed.filter((url) => Boolean(url)).length : 0;
    } catch {
      return 0;
    }
  }

  return 0;
};

const getStatusBadge = (status) => {
  const badges = {
    pending: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock, label: 'Scheduled' },
    processing: { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: Clock, label: 'Processing' },
    completed: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle, label: 'Posted' },
    partially_completed: {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      icon: CheckCircle,
      label: 'Posted (Partial)',
    },
    failed: { bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle, label: 'Failed' },
    cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', icon: XCircle, label: 'Cancelled' },
  };

  const badge = badges[status] || badges.pending;
  const Icon = badge.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
    >
      <Icon size={12} />
      {badge.label}
    </span>
  );
};

const readJsonSafely = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const Scheduling = () => {
  const { selectedAccount, isTeamMode, activeTeamId } = useAccount();
  const accountAPI = useAccountAwareAPI();
  const effectiveTeamId = selectedAccount?.team_id || selectedAccount?.teamId || activeTeamId || null;
  const isTeamScope = Boolean(isTeamMode && effectiveTeamId);
  const currentAccountId = selectedAccount?.id || (isTeamScope ? `team:${effectiveTeamId}` : 'personal');

  const [scheduledTweets, setScheduledTweets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [schedulerInfo, setSchedulerInfo] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem(`schedulingFilter:${currentAccountId}`);
    if (!saved) {
      setFilter('pending');
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      setFilter(normalizeSchedulingFilter(parsed.filter || 'pending'));
    } catch {
      setFilter('pending');
    }
  }, [currentAccountId]);

  useEffect(() => {
    localStorage.setItem(`schedulingFilter:${currentAccountId}`, JSON.stringify({ filter }));
  }, [filter, currentAccountId]);

  const schedulerSummary = useMemo(() => {
    if (!schedulerInfo?.scheduler) return null;

    const nextRunInMs = schedulerInfo.scheduler.nextRunInMs;
    const nextRunText =
      nextRunInMs !== null && nextRunInMs !== undefined
        ? `${Math.ceil((nextRunInMs || 0) / 1000)}s`
        : null;

    return {
      started: Boolean(schedulerInfo.scheduler.started),
      lastTickStatus: schedulerInfo.scheduler.lastTick?.status || 'unknown',
      dueNowCount: schedulerInfo.userQueue?.dueNowCount ?? 0,
      nextRunText,
    };
  }, [schedulerInfo]);

  const emptyStateLabel = normalizeSchedulingFilter(filter);

  const fetchScheduledTweets = async ({ showLoading = true } = {}) => {
    const normalizedFilter = normalizeSchedulingFilter(filter);

    try {
      if (showLoading) {
        setLoading(true);
      }

      let listPayload = { scheduled_tweets: [], disconnected: false };

      if (isTeamScope) {
        const listResponse = await accountAPI.fetchForCurrentAccount(
          `/api/scheduling/scheduled?status=${encodeURIComponent(normalizedFilter)}`
        );
        const listData = await readJsonSafely(listResponse);

        if (!listResponse.ok) {
          if (
            listData?.code === 'TWITTER_RECONNECT_REQUIRED' ||
            listData?.reconnect === true
          ) {
            setIsDisconnected(true);
            setScheduledTweets([]);
            setSchedulerInfo(null);
            return;
          }
          throw new Error(listData?.error || 'Failed to fetch scheduled tweets');
        }

        listPayload = listData || listPayload;

        try {
          const statusResponse = await accountAPI.fetchForCurrentAccount('/api/scheduling/status');
          if (statusResponse.ok) {
            const statusData = await readJsonSafely(statusResponse);
            setSchedulerInfo(statusData || null);
          } else {
            setSchedulerInfo(null);
          }
        } catch {
          setSchedulerInfo(null);
        }
      } else {
        const listResponse = await schedulingAPI.list({ status: normalizedFilter });
        listPayload = listResponse.data || listPayload;

        try {
          const statusResponse = await schedulingAPI.status();
          setSchedulerInfo(statusResponse.data || null);
        } catch {
          setSchedulerInfo(null);
        }
      }

      setScheduledTweets(listPayload.scheduled_tweets || []);
      setIsDisconnected(Boolean(listPayload.disconnected));
    } catch (error) {
      console.error('Failed to fetch scheduled tweets:', error);

      const reconnectRequired =
        error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
        error?.response?.data?.reconnect === true;

      if (reconnectRequired) {
        setIsDisconnected(true);
        setScheduledTweets([]);
        toast.error('Twitter is disconnected. Please reconnect in Settings.');
      } else {
        toast.error('Failed to load scheduled tweets');
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchScheduledTweets();
  }, [filter, selectedAccount?.id, selectedAccount?.team_id, selectedAccount?.teamId, isTeamScope, effectiveTeamId]);

  const handleCancel = async (scheduleId) => {
    try {
      if (isTeamScope) {
        const response = await accountAPI.fetchForCurrentAccount(`/api/scheduling/${scheduleId}`, {
          method: 'DELETE',
        });
        const payload = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to cancel scheduled tweet');
        }
      } else {
        await schedulingAPI.cancel(scheduleId);
      }

      toast.success('Scheduled tweet cancelled');
      fetchScheduledTweets({ showLoading: false });
    } catch (error) {
      console.error('Failed to cancel scheduled tweet:', error);
      toast.error('Failed to cancel scheduled tweet');
    }
  };

  const handleRetry = async (scheduleId) => {
    try {
      if (isTeamScope) {
        const response = await accountAPI.fetchForCurrentAccount('/api/scheduling/retry', {
          method: 'POST',
          body: JSON.stringify({ id: scheduleId }),
        });
        const payload = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to retry scheduled tweet');
        }
      } else {
        await schedulingAPI.retry(scheduleId);
      }

      toast.success('Retry queued');
      fetchScheduledTweets({ showLoading: false });
    } catch (error) {
      console.error('Failed to retry scheduled tweet:', error);
      toast.error('Failed to retry scheduled tweet');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading scheduled tweets...</p>
        </div>
      </div>
    );
  }

  if (isDisconnected) {
    return (
      <div className="card text-center py-12">
        <Calendar className="h-12 w-12 text-orange-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Twitter Connection Required</h3>
        <p className="text-gray-600 mb-6">Reconnect your Twitter account to view scheduled tweets.</p>
        <a href="/settings" className="btn btn-primary btn-md">
          Go to Settings
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scheduled Tweets</h1>
          <p className="mt-2 text-gray-600">Manage your scheduled Twitter posts</p>
        </div>
        <button
          onClick={() => fetchScheduledTweets({ showLoading: false })}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {schedulerSummary && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
          <span className="font-medium">Scheduler:</span>{' '}
          {schedulerSummary.started ? 'running' : 'stopped'}
          {' - '}
          <span>Last tick: {schedulerSummary.lastTickStatus}</span>
          {' - '}
          <span>Due now: {schedulerSummary.dueNowCount}</span>
          {schedulerSummary.nextRunText && (
            <>
              {' - '}
              <span>Next run in {schedulerSummary.nextRunText}</span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(({ value, label, icon: Icon, color }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              filter === value
                ? ACTIVE_FILTER_CLASSES[color]
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {scheduledTweets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <CalendarCheck className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No {emptyStateLabel} tweets</h3>
            <p className="text-gray-500 text-center max-w-sm">
              {filter === 'pending'
                ? "You don't have any upcoming scheduled tweets."
                : `No ${emptyStateLabel} tweets found.`}
            </p>
            {filter === 'pending' && (
              <a
                href="/compose"
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Calendar size={16} />
                Schedule a Tweet
              </a>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Content</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Scheduled For</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scheduledTweets.map((tweet) => {
                  const mediaCount = getMediaCount(tweet.media_urls);
                  const timezoneLabel = isValidTimezone(tweet.timezone)
                    ? normalizeTimezone(tweet.timezone)
                    : null;

                  return (
                    <tr key={tweet.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="max-w-xl">
                          <p className="text-sm text-gray-900 line-clamp-2" title={tweet.content}>
                            {tweet.content}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span>@{tweet.account_username || tweet.twitter_username || 'twitter'}</span>
                            {tweet.scheduled_by_name && <span>By {tweet.scheduled_by_name}</span>}
                            {mediaCount > 0 && <span>{mediaCount} media</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">
                            {formatDatePart(tweet.scheduled_for, timezoneLabel)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatTimePart(tweet.scheduled_for, timezoneLabel)}
                            {timezoneLabel ? ` (${timezoneLabel})` : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {getStatusBadge(tweet.status)}
                          {tweet.status === 'failed' && tweet.error_message && (
                            <p className="text-xs text-red-600 max-w-xs truncate" title={tweet.error_message}>
                              {tweet.error_message}
                            </p>
                          )}
                          {['completed', 'partially_completed'].includes(tweet.status) && tweet.posted_at && (
                            <p className="text-xs text-gray-500">
                              Posted {formatTimePart(tweet.posted_at, timezoneLabel)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {['pending', 'processing'].includes(tweet.status) && (
                            <button
                              onClick={() => handleCancel(tweet.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                            >
                              <Pause size={14} />
                              Cancel
                            </button>
                          )}

                          {tweet.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(tweet.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              <RotateCcw size={14} />
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scheduling;
