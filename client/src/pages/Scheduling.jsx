import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  GripVertical,
  Layers,
  LayoutGrid,
  List,
  Pause,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import useAccountAwareAPI from '../hooks/useAccountAwareAPI';
import { scheduling as schedulingAPI, contentReview } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

// ─── View modes ──────────────────────────────────────────────────────────
const VIEW_MODES = [
  { value: 'list', label: 'List', icon: List },
  { value: 'week', label: 'Week', icon: CalendarDays },
  { value: 'month', label: 'Month', icon: LayoutGrid },
];

// ─── List-view filter config ─────────────────────────────────────────────
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

// ─── Calendar status config ─────────────────────────────────────────────
const CAL_STATUS = {
  pending:         { label: 'Scheduled',       dot: 'bg-blue-500',   bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   icon: Clock },
  processing:      { label: 'Processing',      dot: 'bg-yellow-500', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: RefreshCw },
  completed:       { label: 'Posted',          dot: 'bg-green-500',  bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  icon: CheckCircle },
  failed:          { label: 'Failed',          dot: 'bg-red-500',    bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    icon: AlertCircle },
  cancelled:       { label: 'Cancelled',       dot: 'bg-gray-400',   bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-500',   icon: XCircle },
  review_pending:  { label: 'Pending Review',  dot: 'bg-purple-500', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: Eye },
  review_approved: { label: 'Approved',        dot: 'bg-indigo-500', bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: CheckCircle },
};

// ─── Date / timezone helpers (kept from original Scheduling) ─────────────
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const TIMEZONE_ALIAS_MAP = { 'Asia/Calcutta': 'Asia/Kolkata' };
const normalizeTimezone = (tz) => tz ? (TIMEZONE_ALIAS_MAP[tz] || tz) : null;
const hasExplicitTimezone = (v) => /(?:[zZ]|[+\-]\d{2}:?\d{2})$/.test(v);

const parseUtcDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = hasExplicitTimezone(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isValidTimezone = (tz) => {
  if (!tz) return false;
  const n = normalizeTimezone(tz);
  try { new Intl.DateTimeFormat('en-US', { timeZone: n }).format(new Date()); return true; } catch { return false; }
};

const formatDatePart = (dateValue, timezone) => {
  const parsed = parseUtcDate(dateValue);
  if (!parsed) return '--';
  const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  const n = normalizeTimezone(timezone);
  if (isValidTimezone(n)) opts.timeZone = n;
  return new Intl.DateTimeFormat('en-US', opts).format(parsed);
};

const formatTimePart = (dateValue, timezone) => {
  const parsed = parseUtcDate(dateValue);
  if (!parsed) return '--';
  const opts = { hour: '2-digit', minute: '2-digit', hour12: true };
  const n = normalizeTimezone(timezone);
  if (isValidTimezone(n)) opts.timeZone = n;
  return new Intl.DateTimeFormat('en-US', opts).format(parsed);
};

const normalizeSchedulingFilter = (value) => {
  const n = String(value || 'pending').trim().toLowerCase();
  if (n === 'completed' || n === 'complete') return 'posted';
  if (n === 'canceled') return 'cancelled';
  if (FILTER_OPTIONS.some((o) => o.value === n)) return n;
  return 'pending';
};

// ─── Calendar helpers ────────────────────────────────────────────────────
function startOfWeek(d) { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0,0,0,0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isToday(d) { return isSameDay(d, new Date()); }
function isPast(d) { const n = new Date(); n.setHours(0,0,0,0); return d < n; }
function formatDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function shortTime(s, tz) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const opts = { hour: 'numeric', minute: '2-digit' };
  const n = tz ? (TIMEZONE_ALIAS_MAP[tz] || tz) : null;
  if (n && isValidTimezone(n)) opts.timeZone = n;
  try { return d.toLocaleTimeString([], opts); } catch { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
}
function truncate(s, n=80) { return !s ? '' : s.length > n ? s.slice(0, n) + '\u2026' : s; }

function getMonthDays(year, month) {
  const start = startOfWeek(new Date(year, month, 1));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// ─── List-view helpers ──────────────────────────────────────────────────
const getMediaCount = (mediaUrls) => {
  if (Array.isArray(mediaUrls)) return mediaUrls.filter(Boolean).length;
  if (typeof mediaUrls === 'string' && mediaUrls.trim()) {
    try { const p = JSON.parse(mediaUrls); return Array.isArray(p) ? p.filter(Boolean).length : 0; } catch { return 0; }
  }
  return 0;
};

const getStatusBadge = (status) => {
  const badges = {
    pending:              { bg: 'bg-blue-100',   text: 'text-blue-700',   icon: Clock,       label: 'Scheduled' },
    processing:           { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: Clock,       label: 'Processing' },
    completed:            { bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle, label: 'Posted' },
    partially_completed:  { bg: 'bg-amber-100',  text: 'text-amber-700',  icon: CheckCircle, label: 'Posted (Partial)' },
    failed:               { bg: 'bg-red-100',    text: 'text-red-700',    icon: AlertCircle, label: 'Failed' },
    cancelled:            { bg: 'bg-gray-100',   text: 'text-gray-700',   icon: XCircle,     label: 'Cancelled' },
  };
  const b = badges[status] || badges.pending;
  const Icon = b.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${b.bg} ${b.text}`}>
      <Icon size={12} />
      {b.label}
    </span>
  );
};

const readJsonSafely = async (response) => { try { return await response.json(); } catch { return {}; } };

// ─── Thread helpers ──────────────────────────────────────────────────────
function getThreadParts(item) {
  let parts = item?.thread_tweets;
  if (typeof parts === 'string') { try { parts = JSON.parse(parts); } catch { parts = null; } }
  if (!Array.isArray(parts) || parts.length === 0) return null;
  return parts;
}
function isThreadItem(item) {
  return !!getThreadParts(item);
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function CalendarItem({ item, onDragStart, onClick, compact }) {
  const cfg = CAL_STATUS[item._calendarStatus] || CAL_STATUS.pending;
  const isReview = item._isReviewItem;
  const isThread = isThreadItem(item);
  return (
    <div
      draggable={item._calendarStatus === 'pending' || isReview}
      onDragStart={(e) => onDragStart(e, item)}
      onClick={() => onClick(item)}
      className={`group relative px-2 py-1 rounded-md text-xs cursor-pointer transition-all
        ${cfg.bg} ${cfg.border} border ${cfg.text}
        hover:shadow-md hover:scale-[1.02] active:scale-[0.98]
        ${(item._calendarStatus === 'pending' || isReview) ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={item.content}
    >
      <div className="flex items-start gap-1">
        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          {!compact && (
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-[10px] opacity-70">{shortTime(item.scheduled_for || item.suggested_time, item.timezone)}</span>
              {isThread && <span className="text-[9px] font-semibold bg-purple-200 text-purple-800 px-1 rounded">Thread</span>}
              {item.source === 'autopilot' && <span className="text-[9px] font-semibold bg-violet-200 text-violet-800 px-1 rounded">AP</span>}
            </div>
          )}
          <span className="block leading-snug line-clamp-2">{truncate(item.content, compact ? 40 : 80)}</span>
        </div>
        {(item._calendarStatus === 'pending' || isReview) && (
          <GripVertical className="w-3 h-3 opacity-0 group-hover:opacity-40 flex-shrink-0 mt-0.5" />
        )}
      </div>
    </div>
  );
}

function DayCell({ date, items, onDrop, onDragOver, onItemClick, onDragStart, isCurrentMonth, viewMode }) {
  const today = isToday(date);
  const past = isPast(date);
  const hasGap = items.length === 0 && !past;
  const compact = viewMode === 'month';
  const shown = compact ? items.slice(0, 3) : items;
  const overflow = items.length - shown.length;

  return (
    <div
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, date)}
      className={`min-h-[80px] ${viewMode === 'week' ? 'min-h-[120px]' : ''} p-1.5 border-b border-r transition-colors
        ${today ? 'bg-blue-50/50 ring-1 ring-inset ring-blue-200' : ''}
        ${!isCurrentMonth ? 'bg-gray-50/50' : 'bg-white'}
        ${hasGap ? 'bg-amber-50/30' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium leading-none
          ${today ? 'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center' : ''}
          ${!isCurrentMonth ? 'text-gray-400' : 'text-gray-700'}
          ${past && !today ? 'text-gray-400' : ''}`}>
          {date.getDate()}
        </span>
        {hasGap && <span className="text-[9px] text-amber-500 font-medium">gap</span>}
      </div>
      <div className="space-y-1">
        {shown.map((item) => (
          <CalendarItem key={item._calendarId} item={item} onDragStart={onDragStart} onClick={onItemClick} compact={compact} />
        ))}
        {overflow > 0 && <div className="text-[10px] text-gray-500 text-center py-0.5">+{overflow} more</div>}
      </div>
    </div>
  );
}

function DetailModal({ item, onClose, onReschedule, onCancel, onApprove, onReject, onRetry }) {
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  if (!item) return null;

  const cfg = CAL_STATUS[item._calendarStatus] || CAL_STATUS.pending;
  const isReview = item._isReviewItem;
  const scheduledDate = item.scheduled_for || item.suggested_time;
  const CfgIcon = cfg.icon;

  const handleReschedule = () => {
    if (!newDate || !newTime) { toast.error('Please select date and time'); return; }
    onReschedule(item, `${newDate}T${newTime}:00`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className={`px-5 py-3 rounded-t-xl ${cfg.bg} ${cfg.border} border-b flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <CfgIcon className={`w-4 h-4 ${cfg.text}`} />
            <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
            {isReview && <span className="text-[10px] bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">Review Queue</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XCircle className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {(() => {
            const threadParts = getThreadParts(item);
            if (threadParts && threadParts.length > 0) {
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Layers className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold text-purple-700">Thread · {threadParts.length + 1} tweets</span>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed border-l-4 border-blue-400">
                    <span className="text-[10px] font-bold text-blue-600 block mb-1">1/{threadParts.length + 1}</span>
                    {item.content}
                  </div>
                  {threadParts.map((part, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed border-l-4 border-purple-300">
                      <span className="text-[10px] font-bold text-purple-600 block mb-1">{i + 2}/{threadParts.length + 1}</span>
                      {typeof part === 'string' ? part : part?.content || ''}
                    </div>
                  ))}
                </div>
              );
            }
            return <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{item.content}</div>;
          })()}
          {scheduledDate && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              <span>
                {formatDatePart(scheduledDate, item.timezone)} at {formatTimePart(scheduledDate, item.timezone)}
              </span>
            </div>
          )}
          {item.category && <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{item.category}</span>}
          {item.reason && <p className="text-xs text-gray-500 italic">{item.reason}</p>}
          {item.status === 'failed' && item.error_message && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{item.error_message}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex flex-wrap gap-2">
          {(item._calendarStatus === 'pending' || isReview) && (
            <>
              {!rescheduleOpen ? (
                <button onClick={() => setRescheduleOpen(true)} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  Reschedule
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} min={new Date().toISOString().split('T')[0]} className="px-2 py-1 text-xs border rounded-md" />
                  <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="px-2 py-1 text-xs border rounded-md" />
                  <button onClick={handleReschedule} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">Confirm</button>
                  <button onClick={() => setRescheduleOpen(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Cancel</button>
                </div>
              )}
            </>
          )}
          {item._calendarStatus === 'pending' && !isReview && (
            <button onClick={() => onCancel(item)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">Cancel Tweet</button>
          )}
          {!isReview && item._calendarStatus === 'failed' && (
            <button onClick={() => onRetry(item)} className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
              <RotateCcw className="w-3 h-3 inline mr-1" />Retry
            </button>
          )}
          {isReview && item._calendarStatus === 'review_pending' && (
            <>
              <button onClick={() => onApprove(item)} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">Approve & Schedule</button>
              <button onClick={() => onReject(item)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">Reject</button>
            </>
          )}
          <button onClick={onClose} className="ml-auto px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Close</button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon: Icon, subtitle }) {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200', green: 'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200', indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    red: 'bg-red-50 text-red-700 border-red-200', amber: 'bg-amber-50 text-amber-700 border-amber-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${cls[color] || cls.gray}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 opacity-70" />
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
      {subtitle && <div className="text-[10px] opacity-60">{subtitle}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const Scheduling = () => {
  // ─── Account context (team mode support) ────────────────────────────
  const { selectedAccount, isTeamMode, activeTeamId } = useAccount();
  const accountAPI = useAccountAwareAPI();
  const effectiveTeamId = selectedAccount?.team_id || selectedAccount?.teamId || activeTeamId || null;
  const isTeamScope = Boolean(isTeamMode && effectiveTeamId);
  const currentAccountId = selectedAccount?.id || (isTeamScope ? `team:${effectiveTeamId}` : 'personal');

  // ─── View state ─────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('schedulingViewMode') || 'list');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showReviewItems, setShowReviewItems] = useState(true);

  // ─── List view state ────────────────────────────────────────────────
  const [filter, setFilter] = useState('pending');
  const [schedulerInfo, setSchedulerInfo] = useState(null);

  // ─── Shared data state ──────────────────────────────────────────────
  const [scheduledTweets, setScheduledTweets] = useState([]);
  const [allTweets, setAllTweets] = useState([]); // for calendar (all statuses)
  const [reviewItems, setReviewItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const dragItemRef = useRef(null);
  const accountAPIRef = useRef(accountAPI);
  accountAPIRef.current = accountAPI;
  const fetchErrorCountRef = useRef(0);

  // Persist view mode + filter
  useEffect(() => { localStorage.setItem('schedulingViewMode', viewMode); }, [viewMode]);
  useEffect(() => {
    const saved = localStorage.getItem(`schedulingFilter:${currentAccountId}`);
    if (saved) { try { setFilter(normalizeSchedulingFilter(JSON.parse(saved).filter)); } catch { setFilter('pending'); } }
  }, [currentAccountId]);
  useEffect(() => {
    localStorage.setItem(`schedulingFilter:${currentAccountId}`, JSON.stringify({ filter }));
  }, [filter, currentAccountId]);

  // ─── Data fetching ──────────────────────────────────────────────────
  const fetchData = useCallback(async ({ showLoading = true } = {}) => {
    // Prevent infinite retry: stop after 3 consecutive failures
    if (fetchErrorCountRef.current >= 3 && showLoading) {
      console.warn('[Scheduling] Skipping fetch — too many consecutive errors');
      return;
    }
    const normalizedFilter = normalizeSchedulingFilter(filter);
    const api = accountAPIRef.current;
    try {
      if (showLoading) setLoading(true);
      let listPayload = { scheduled_tweets: [], disconnected: false };

      if (isTeamScope) {
        // Team mode: fire list + status in parallel
        const [listResp, statusResp] = await Promise.all([
          api.fetchForCurrentAccount(
            `/api/scheduling/scheduled?status=${encodeURIComponent(normalizedFilter)}`
          ),
          api.fetchForCurrentAccount('/api/scheduling/status').catch(() => null),
        ]);
        const listData = await readJsonSafely(listResp);
        if (!listResp.ok) {
          if (listData?.code === 'TWITTER_RECONNECT_REQUIRED' || listData?.reconnect === true) {
            setIsDisconnected(true); setScheduledTweets([]); setAllTweets([]); setSchedulerInfo(null); return;
          }
          throw new Error(listData?.error || 'Failed to fetch scheduled tweets');
        }
        listPayload = listData || listPayload;
        if (statusResp?.ok) setSchedulerInfo(await readJsonSafely(statusResp));
        else setSchedulerInfo(null);
      } else {
        // Personal mode: fire list + status in parallel
        const [listResp, statusResp] = await Promise.allSettled([
          schedulingAPI.list({ status: normalizedFilter }),
          schedulingAPI.status(),
        ]);
        listPayload = (listResp.status === 'fulfilled' ? listResp.value.data : null) || listPayload;
        setSchedulerInfo(statusResp.status === 'fulfilled' ? (statusResp.value.data || null) : null);
      }

      setScheduledTweets(listPayload.scheduled_tweets || []);
      setIsDisconnected(Boolean(listPayload.disconnected));
      fetchErrorCountRef.current = 0; // Reset on success

      // For calendar views: also fetch all statuses + review queue in parallel
      if (viewMode !== 'list') {
        const [allRes, reviewRes] = await Promise.allSettled([
          isTeamScope
            ? api.fetchForCurrentAccount('/api/scheduling/scheduled?status=all&limit=100').then(readJsonSafely)
            : schedulingAPI.list({ status: 'all', limit: 100 }).then((r) => r.data),
          contentReview.list({ limit: 100 }).then((r) => r.data),
        ]);
        setAllTweets(allRes.status === 'fulfilled' ? (allRes.value?.scheduled_tweets || []) : []);
        setReviewItems(reviewRes.status === 'fulfilled' ? (reviewRes.value?.items || []) : []);
      }
    } catch (error) {
      fetchErrorCountRef.current += 1;
      console.error('Failed to fetch scheduled tweets:', error);
      const reconnectRequired = error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' || error?.response?.data?.reconnect === true;
      if (reconnectRequired) {
        setIsDisconnected(true); setScheduledTweets([]); setAllTweets([]);
        toast.error('Twitter is disconnected. Please reconnect in Settings.');
      } else if (fetchErrorCountRef.current <= 1) {
        // Only show toast on first failure to avoid spam
        toast.error('Failed to load scheduled tweets');
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [filter, isTeamScope, viewMode]);

  useEffect(() => {
    fetchErrorCountRef.current = 0; // Reset on account/dep change
    fetchData();
  }, [fetchData, selectedAccount?.id, selectedAccount?.team_id, selectedAccount?.teamId, effectiveTeamId]);

  // ─── Scheduler summary ─────────────────────────────────────────────
  const schedulerSummary = useMemo(() => {
    if (!schedulerInfo?.scheduler) return null;
    const nextRunInMs = schedulerInfo.scheduler.nextRunInMs;
    return {
      started: Boolean(schedulerInfo.scheduler.started),
      lastTickStatus: schedulerInfo.scheduler.lastTick?.status || 'unknown',
      dueNowCount: schedulerInfo.userQueue?.dueNowCount ?? 0,
      nextRunText: nextRunInMs != null ? `${Math.ceil((nextRunInMs || 0) / 1000)}s` : null,
    };
  }, [schedulerInfo]);

  // ─── Calendar items bucketed by date ───────────────────────────────
  const calendarSource = viewMode === 'list' ? scheduledTweets : allTweets;

  const itemsByDate = useMemo(() => {
    const map = {};
    for (const t of calendarSource) {
      if (!t.scheduled_for) continue;
      const key = formatDateKey(new Date(t.scheduled_for));
      if (!map[key]) map[key] = [];
      map[key].push({ ...t, _calendarId: `sched_${t.id}`, _calendarStatus: t.status || 'pending', _isReviewItem: false });
    }
    if (showReviewItems) {
      for (const item of reviewItems) {
        if (!item.suggested_time || item.status === 'scheduled' || item.status === 'rejected') continue;
        const key = formatDateKey(new Date(item.suggested_time));
        if (!map[key]) map[key] = [];
        map[key].push({ ...item, _calendarId: `review_${item.id}`, _calendarStatus: item.status === 'approved' ? 'review_approved' : 'review_pending', _isReviewItem: true });
      }
    }
    for (const key in map) map[key].sort((a, b) => new Date(a.scheduled_for || a.suggested_time) - new Date(b.scheduled_for || b.suggested_time));
    return map;
  }, [calendarSource, reviewItems, showReviewItems]);

  // ─── Calendar navigation + date ranges ─────────────────────────────
  const navigateCal = (delta) => {
    const d = new Date(currentDate);
    if (viewMode === 'week') d.setDate(d.getDate() + delta * 7);
    else d.setMonth(d.getMonth() + delta);
    setCurrentDate(d);
  };

  const weekDays = useMemo(() => { const s = startOfWeek(currentDate); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }, [currentDate]);
  const monthDays = useMemo(() => getMonthDays(currentDate.getFullYear(), currentDate.getMonth()), [currentDate]);

  const calHeaderText = useMemo(() => {
    if (viewMode === 'week') {
      const s = weekDays[0], e = weekDays[6];
      return s.getMonth() === e.getMonth()
        ? `${MONTH_NAMES[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}, ${s.getFullYear()}`
        : `${MONTH_NAMES[s.getMonth()].slice(0,3)} ${s.getDate()} \u2013 ${MONTH_NAMES[e.getMonth()].slice(0,3)} ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }, [viewMode, currentDate, weekDays]);

  // ─── Stats (calendar views) ────────────────────────────────────────
  const calStats = useMemo(() => {
    const pendingSched = allTweets.filter((t) => t.status === 'pending').length;
    const posted = allTweets.filter((t) => t.status === 'completed' || t.status === 'partially_completed').length;
    const pendingReview = reviewItems.filter((i) => i.status === 'pending').length;
    const approvedReview = reviewItems.filter((i) => i.status === 'approved').length;
    const today = new Date(); today.setHours(0,0,0,0);
    let gapDays = 0;
    for (let i = 1; i <= 7; i++) { const key = formatDateKey(addDays(today, i)); if (!itemsByDate[key]?.length) gapDays++; }
    return { pendingSched, posted, pendingReview, approvedReview, gapDays };
  }, [allTweets, reviewItems, itemsByDate]);

  // ─── Drag & drop ──────────────────────────────────────────────────
  const handleDragStart = (e, item) => { dragItemRef.current = item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item._calendarId); };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const handleDrop = async (e, targetDate) => {
    e.preventDefault();
    const item = dragItemRef.current;
    dragItemRef.current = null;
    if (!item) return;
    const orig = new Date(item.scheduled_for || item.suggested_time);
    const newDT = new Date(targetDate);
    newDT.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    if (newDT <= new Date()) { toast.error('Cannot schedule in the past'); return; }
    const iso = newDT.toISOString();
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
      if (item._isReviewItem) { await contentReview.update(item.id, { suggested_time: iso }); toast.success('Review item rescheduled'); }
      else { await schedulingAPI.update(item.id, { scheduled_for: iso, timezone: browserTz }); toast.success('Tweet rescheduled'); }
      await fetchData({ showLoading: false });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to reschedule'); }
  };

  // ─── Actions (shared between list + calendar) ─────────────────────
  const handleCancel = async (itemOrId) => {
    const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
    try {
      if (isTeamScope) {
        const r = await accountAPI.fetchForCurrentAccount(`/api/scheduling/${id}`, { method: 'DELETE' });
        const p = await readJsonSafely(r);
        if (!r.ok) throw new Error(p?.error || 'Failed to cancel');
      } else { await schedulingAPI.cancel(id); }
      toast.success('Scheduled tweet cancelled');
      setSelectedItem(null);
      fetchData({ showLoading: false });
    } catch (error) { toast.error('Failed to cancel scheduled tweet'); }
  };

  const handleRetry = async (itemOrId) => {
    const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
    try {
      if (isTeamScope) {
        const r = await accountAPI.fetchForCurrentAccount('/api/scheduling/retry', { method: 'POST', body: JSON.stringify({ id }) });
        const p = await readJsonSafely(r);
        if (!r.ok) throw new Error(p?.error || 'Failed to retry');
      } else { await schedulingAPI.retry(id); }
      toast.success('Retry queued');
      setSelectedItem(null);
      fetchData({ showLoading: false });
    } catch (error) { toast.error('Failed to retry scheduled tweet'); }
  };

  const handleReschedule = async (item, dateTime) => {
    // Validate the new time is in the future
    const newDT = new Date(dateTime);
    if (isNaN(newDT.getTime())) { toast.error('Invalid date/time'); return; }
    if (newDT <= new Date()) { toast.error('Cannot schedule in the past'); return; }
    // Use browser timezone so the backend interprets the wall-clock time correctly
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
      if (item._isReviewItem) { await contentReview.update(item.id, { suggested_time: dateTime }); }
      else { await schedulingAPI.update(item.id, { scheduled_for: dateTime, timezone: browserTz }); }
      toast.success('Rescheduled successfully');
      setSelectedItem(null);
      fetchData({ showLoading: false });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to reschedule'); }
  };

  const handleApprove = async (item) => {
    try {
      await contentReview.approve(item.id);
      toast.success('Approved & auto-scheduled');
      setSelectedItem(null);
      fetchData({ showLoading: false });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to approve'); }
  };

  const handleReject = async (item) => {
    try {
      await contentReview.reject(item.id);
      toast.success('Item rejected');
      setSelectedItem(null);
      fetchData({ showLoading: false });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to reject'); }
  };

  // ─── Loading / Disconnected states ────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6">
        {/* Skeleton header */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-40 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-48 bg-gray-200 rounded-lg animate-pulse" />
            <div className="h-9 w-9 bg-gray-100 rounded-lg animate-pulse" />
          </div>
        </div>
        {/* Skeleton filters */}
        <div className="flex gap-2">
          {[1,2,3,4].map((i) => (
            <div key={i} className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
        {/* Skeleton table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-gray-100">
              <div className="h-5 w-20 bg-gray-200 rounded-full animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
              <div className="h-8 w-16 bg-gray-100 rounded-lg animate-pulse" />
            </div>
          ))}
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
        <a href="/settings" className="btn btn-primary btn-md">Go to Settings</a>
      </div>
    );
  }

  const emptyStateLabel = normalizeSchedulingFilter(filter);
  const calDays = viewMode === 'week' ? weekDays : monthDays;

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6">
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-blue-600" />
            Scheduling
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage and visualise your scheduled content</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            {VIEW_MODES.map(({ value, label, icon: VIcon }) => (
              <button
                key={value}
                onClick={() => setViewMode(value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5
                  ${viewMode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <VIcon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { fetchErrorCountRef.current = 0; fetchData({ showLoading: false }); }}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* ─── Scheduler info bar (all views) ───────────────────────────── */}
      {schedulerSummary && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
          <span className="font-medium">Scheduler:</span>{' '}
          {schedulerSummary.started ? 'running' : 'stopped'}
          {' \u2013 '}Last tick: {schedulerSummary.lastTickStatus}
          {' \u2013 '}Due now: {schedulerSummary.dueNowCount}
          {schedulerSummary.nextRunText && <>{' \u2013 '}Next run in {schedulerSummary.nextRunText}</>}
        </div>
      )}

      {/* ═══════════ LIST VIEW ═══════════════════════════════════════════ */}
      {viewMode === 'list' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map(({ value, label, icon: Icon, color }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                  filter === value ? ACTIVE_FILTER_CLASSES[color] : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <Icon size={16} />{label}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {scheduledTweets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <CalendarCheck className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">No {emptyStateLabel} tweets</h3>
                <p className="text-gray-500 text-center max-w-sm">
                  {filter === 'pending' ? "You don't have any upcoming scheduled tweets." : `No ${emptyStateLabel} tweets found.`}
                </p>
                {filter === 'pending' && (
                  <a href="/compose" className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <Calendar size={16} />Schedule a Tweet
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
                      const isExternal = Boolean(tweet.is_external_cross_post || tweet.external_read_only);
                      const extLabel = tweet.external_source === 'linkedin-genie' ? 'LinkedIn Genie' : tweet.external_source === 'social-genie' ? 'Threads Genie' : 'External';
                      const tzLabel = isValidTimezone(tweet.timezone) ? normalizeTimezone(tweet.timezone) : null;

                      return (
                        <tr key={tweet.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="max-w-xl">
                              <div className="flex items-center gap-2">
                                <p className="text-sm text-gray-900 line-clamp-2 flex-1" title={tweet.content}>{tweet.content}</p>
                                {isThreadItem(tweet) && (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                                    <Layers size={10} />Thread · {(getThreadParts(tweet)?.length || 0) + 1}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                {isExternal ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
                                    External &middot; {extLabel} cross-post (read-only)
                                  </span>
                                ) : <span>@{tweet.account_username || tweet.twitter_username || 'twitter'}</span>}
                                {tweet.source === 'autopilot' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700 border border-violet-200 uppercase tracking-wider">
                                    Autopilot
                                  </span>
                                )}
                                {tweet.scheduled_by_name && <span>By {tweet.scheduled_by_name}</span>}
                                {mediaCount > 0 && <span>{mediaCount} media</span>}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">{formatDatePart(tweet.scheduled_for, tzLabel)}</span>
                              <span className="text-xs text-gray-500">{formatTimePart(tweet.scheduled_for, tzLabel)}{tzLabel ? ` (${tzLabel})` : ''}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              {getStatusBadge(tweet.status)}
                              {tweet.status === 'failed' && tweet.error_message && (
                                <p className="text-xs text-red-600 max-w-xs truncate" title={tweet.error_message}>{tweet.error_message}</p>
                              )}
                              {['completed', 'partially_completed'].includes(tweet.status) && tweet.posted_at && (
                                <p className="text-xs text-gray-500">Posted {formatTimePart(tweet.posted_at, tzLabel)}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              {isExternal ? (
                                <span className="text-xs text-gray-500 whitespace-nowrap">Managed in {extLabel}</span>
                              ) : ['pending', 'processing'].includes(tweet.status) && (
                                <button onClick={() => handleCancel(tweet.id)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
                                  <Pause size={14} />Cancel
                                </button>
                              )}
                              {!isExternal && tweet.status === 'failed' && (
                                <button onClick={() => handleRetry(tweet.id)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                                  <RotateCcw size={14} />Retry
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
        </>
      )}

      {/* ═══════════ CALENDAR VIEWS (week / month) ═══════════════════════ */}
      {(viewMode === 'week' || viewMode === 'month') && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Scheduled" value={calStats.pendingSched} color="blue" icon={Clock} />
            <StatCard label="Posted" value={calStats.posted} color="green" icon={CheckCircle} />
            <StatCard label="Pending Review" value={calStats.pendingReview} color="purple" icon={Eye} />
            <StatCard label="Approved" value={calStats.approvedReview} color="indigo" icon={CheckCircle} />
            <StatCard
              label="Content Gaps"
              value={`${calStats.gapDays}/7`}
              color={calStats.gapDays >= 5 ? 'red' : calStats.gapDays >= 3 ? 'amber' : 'green'}
              icon={AlertCircle}
              subtitle="next 7 days"
            />
          </div>

          {/* Calendar toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border shadow-sm">
            <div className="flex items-center gap-2">
              <button onClick={() => navigateCal(-1)} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                Today
              </button>
              <span className="text-sm font-semibold text-gray-800 min-w-[180px] text-center">{calHeaderText}</span>
              <button onClick={() => navigateCal(1)} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showReviewItems}
                onChange={(e) => setShowReviewItems(e.target.checked)}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <Layers className="w-3.5 h-3.5" />
              Show review queue
            </label>
          </div>

          {/* Calendar grid */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 bg-gray-50 border-b">
              {DAY_NAMES.map((n) => (
                <div key={n} className="text-center text-xs font-semibold text-gray-500 py-2 border-r last:border-r-0">{n}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calDays.map((date) => {
                const key = formatDateKey(date);
                const items = itemsByDate[key] || [];
                const isCurrentMonth = viewMode === 'week' || date.getMonth() === currentDate.getMonth();
                return (
                  <DayCell
                    key={key} date={date} items={items}
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragStart={handleDragStart}
                    onItemClick={setSelectedItem} isCurrentMonth={isCurrentMonth} viewMode={viewMode}
                  />
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
            <span className="font-medium text-gray-600">Legend:</span>
            {Object.entries(CAL_STATUS).map(([key, cfg]) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />{cfg.label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-amber-200" />Content Gap
            </span>
          </div>
        </>
      )}

      {/* ─── Detail modal (calendar views) ────────────────────────────── */}
      {selectedItem && (
        <DetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onReschedule={handleReschedule}
          onCancel={handleCancel}
          onApprove={handleApprove}
          onReject={handleReject}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
};

export default Scheduling;
