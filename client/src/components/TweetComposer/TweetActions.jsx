
import React, { useState, useEffect, useMemo } from 'react';
import { Send, Calendar, Clock } from 'lucide-react';
import Modal from './Modal';
import { strategy as strategyApi } from '../../utils/api';

const TIMEZONE_ALIAS_MAP = {
  'Asia/Calcutta': 'Asia/Kolkata',
};

const normalizeTimezone = (timezone) => TIMEZONE_ALIAS_MAP[timezone] || timezone || 'UTC';
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
];

const isValidTimezone = (timezone) => {
  const normalizedTimezone = normalizeTimezone(timezone);
  if (!normalizedTimezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const toLocalDateTimeInputMin = () => {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

// Parse best_hours like "9am-11am" and return [startHour, endHour] in 24h
const parseBestHours = (bestHours) => {
  if (!bestHours) return null;
  const match = bestHours.match(/(\d{1,2})(am|pm)/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const ampm = match[2].toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return hour;
};

// Get next recommended datetime-local string based on best_days & best_hours
const getNextRecommendedSlot = (bestDays, bestHours) => {
  const targetHour = parseBestHours(bestHours) ?? 10; // default 10am
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetDayIndices = (bestDays || [])
    .map((d) => dayNames.indexOf(d))
    .filter((i) => i >= 0);

  if (targetDayIndices.length === 0) targetDayIndices.push(2, 4); // Tue, Thu fallback

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  // Search next 14 days for a matching best day
  for (let offset = 0; offset < 14; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(targetHour, 0, 0, 0);

    if (candidate <= now) continue;
    if (!targetDayIndices.includes(candidate.getDay())) continue;

    return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}T${pad(targetHour)}:00`;
  }

  // Fallback: next available day at target hour
  const fallback = new Date(now);
  fallback.setDate(now.getDate() + 1);
  fallback.setHours(targetHour, 0, 0, 0);
  return `${fallback.getFullYear()}-${pad(fallback.getMonth() + 1)}-${pad(fallback.getDate())}T${pad(targetHour)}:00`;
};

const TweetActions = ({
  isThread,
  content,
  threadTweets,
  selectedImages,
  isPosting,
  isScheduling,
  onPost,
  onSchedule
}) => {
  const hasContent = isThread 
    ? threadTweets.some(tweet => tweet.trim().length > 0)
    : content.trim().length > 0;

  const canPost = hasContent || selectedImages.length > 0;

  // Modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const detectedTimezone = normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [scheduleTimezone, setScheduleTimezone] = useState(detectedTimezone);
  const [localError, setLocalError] = useState('');
  const [recommendedSlot, setRecommendedSlot] = useState(null);
  const [recommendedLabel, setRecommendedLabel] = useState('');
  const timezoneSuggestions = useMemo(() => {
    return [...new Set([detectedTimezone, ...COMMON_TIMEZONES].filter(Boolean))];
  }, [detectedTimezone]);

  // Fetch recommended posting time from active strategy analysis
  useEffect(() => {
    let cancelled = false;
    const fetchRecommended = async () => {
      try {
        const resp = await strategyApi.getCurrent();
        const cache = resp?.data?.strategy?.metadata?.analysis_cache;
        if (!cache || cancelled) return;
        const bestDays = cache.best_days || [];
        const bestHours = cache.best_hours || null;
        if (bestDays.length > 0 || bestHours) {
          const slot = getNextRecommendedSlot(bestDays, bestHours);
          if (!cancelled) {
            setRecommendedSlot(slot);
            const label = bestDays.length > 0
              ? `${bestDays.join(', ')} ${bestHours || ''}`
              : bestHours || '';
            setRecommendedLabel(label.trim());
          }
        }
      } catch {
        // Silently fail — no strategy or analysis available
      }
    };
    fetchRecommended();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex space-x-3">
      <button
        onClick={() => onPost?.()}
        disabled={!canPost || isPosting}
        className="flex-1 flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPosting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Posting...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {isThread ? 'Post Thread' : 'Post Tweet'}
          </>
        )}
      </button>
      
      <button
        onClick={() => setShowScheduleModal(true)}
        disabled={!canPost || isScheduling}
        className="flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isScheduling ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
            Scheduling...
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4 mr-2" />
            Schedule
          </>
        )}
      </button>

      {/* Schedule Modal */}
      <Modal
        isOpen={showScheduleModal}
        onClose={() => {
          setShowScheduleModal(false);
          setLocalError('');
          setScheduleTimezone(detectedTimezone);
        }}
      >
        <h2 className="text-lg font-semibold mb-4">Schedule Tweet</h2>
        <label className="block text-sm font-medium text-gray-700 mb-2">Date & Time</label>
        <input
          type="datetime-local"
          value={scheduleDate}
          min={toLocalDateTimeInputMin()}
          onChange={e => setScheduleDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        />
        <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
        <input
          type="text"
          list="tweet-timezone-options"
          value={scheduleTimezone}
          onChange={(e) => setScheduleTimezone(e.target.value)}
          placeholder="e.g. America/New_York"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1"
        />
        <datalist id="tweet-timezone-options">
          {timezoneSuggestions.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
        <p className="text-xs text-gray-500 mb-3">
          Auto-detected: {detectedTimezone}
        </p>
        {recommendedSlot && (
          <button
            type="button"
            onClick={() => setScheduleDate(recommendedSlot)}
            className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 mb-3 hover:bg-emerald-100 transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            Use recommended slot{recommendedLabel ? ` (${recommendedLabel})` : ''}
          </button>
        )}
        {!recommendedSlot && <div className="mb-2" />}
        {localError && <div className="text-red-500 text-sm mb-2">{localError}</div>}
        <div className="flex justify-end space-x-2 mt-4">
          <button
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={() => {
              setShowScheduleModal(false);
              setLocalError('');
              setScheduleTimezone(detectedTimezone);
            }}
            disabled={isScheduling}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={async () => {
              if (!scheduleDate) {
                setLocalError('Please select a date and time');
                return;
              }
              const timezoneCandidate = (scheduleTimezone || '').trim() || detectedTimezone;
              if (!isValidTimezone(timezoneCandidate)) {
                setLocalError('Enter a valid timezone (example: America/New_York)');
                return;
              }
              setLocalError('');
              // Pass both date and timezone
              await onSchedule(scheduleDate, normalizeTimezone(timezoneCandidate));
              setShowScheduleModal(false);
              setScheduleDate('');
              setScheduleTimezone(detectedTimezone);
            }}
            disabled={isScheduling}
          >
            {isScheduling ? 'Scheduling...' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default TweetActions;
