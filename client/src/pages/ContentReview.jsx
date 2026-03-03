import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Calendar,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Edit3,
  Trash2,
  Send,
  Filter,
  Loader2,
  AlertCircle,
  CheckSquare,
  Zap,
  Eye,
  BookOpen,
  Layers,
} from 'lucide-react';

// ─── Thread helpers ────────────────────────────────────────────────────
function getThreadParts(content) {
  if (!content) return null;
  const parts = content.split(/---+/).map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}
function isThread(content) {
  return !!getThreadParts(content);
}
import api from '../utils/api';

const STATUS_CONFIG = {
  pending: { label: 'Pending Review', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, dotColor: 'bg-amber-400' },
  approved: { label: 'Approved', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle, dotColor: 'bg-emerald-400' },
  rejected: { label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-200', icon: XCircle, dotColor: 'bg-red-400' },
  scheduled: { label: 'Scheduled', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Calendar, dotColor: 'bg-blue-400' },
};

const CATEGORY_COLORS = {
  educational: 'bg-violet-50 text-violet-700 border-violet-200',
  engagement: 'bg-orange-50 text-orange-700 border-orange-200',
  storytelling: 'bg-pink-50 text-pink-700 border-pink-200',
  tips: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  promotional: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inspirational: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

// ─── Skeleton Components ───────────────────────────────────────────────
function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
          <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
          <div className="h-8 w-12 bg-gray-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-5 w-20 bg-gray-200 rounded-full animate-pulse" />
        <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse" />
        <div className="ml-auto h-4 w-28 bg-gray-100 rounded animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-5/6 bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <div className="h-8 w-20 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-8 w-20 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-8 w-20 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

export default function ContentReview() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, scheduled: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [error, setError] = useState(null);
  const [expandedReasons, setExpandedReasons] = useState(new Set());

  // Use ref to avoid dependency loop (fetchStrategies sets selectedStrategy but also depends on it)
  const selectedStrategyRef = useRef(selectedStrategy);
  selectedStrategyRef.current = selectedStrategy;

  // ─── Fetch Data (parallelized, no dependency loops) ──────────────────
  const fetchQueue = useCallback(async (strategyId, statusFilter) => {
    try {
      const params = new URLSearchParams();
      const f = statusFilter ?? filter;
      const sid = strategyId ?? selectedStrategyRef.current;
      if (f && f !== 'all') params.set('status', f);
      if (sid) params.set('strategy_id', sid);
      params.set('order_by', 'suggested_time');

      const res = await api.get(`/api/content-review?${params.toString()}`);
      setItems(res.data.items || []);
    } catch (err) {
      console.error('Failed to fetch queue:', err);
      setError('Failed to load content queue');
    }
  }, [filter]);

  const fetchStats = useCallback(async (strategyId) => {
    try {
      const params = new URLSearchParams();
      const sid = strategyId ?? selectedStrategyRef.current;
      if (sid) params.set('strategy_id', sid);
      const qs = params.toString();
      const res = await api.get(`/api/content-review/stats${qs ? '?' + qs : ''}`);
      setStats(res.data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await api.get('/api/strategy/list');
      const list = res.data.strategies || res.data || [];
      const normalized = Array.isArray(list) ? list : [];
      setStrategies(normalized);
      // Auto-select first active strategy so Generate button works immediately
      if (normalized.length > 0 && !selectedStrategyRef.current) {
        const active = normalized.find((s) => s.status === 'active') || normalized[0];
        setSelectedStrategy(active.id);
      }
      return normalized;
    } catch (err) {
      console.error('Failed to fetch strategies:', err);
      return [];
    }
  }, []); // No selectedStrategy dep — uses ref instead

  // Single parallelized initial load
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        // Fire all requests in parallel — no strategy filter initially
        await Promise.all([
          fetchStrategies(),
          fetchStats(null),
          fetchQueue(null, filter),
        ]);
      } catch (err) {
        console.error('Init failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch queue when filter or strategy changes (after initial load)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchQueue();
    fetchStats();
  }, [filter, selectedStrategy]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Actions ─────────────────────────────────────────────────────────
  const setItemLoading = (id, isLoading) => {
    setActionLoading((prev) => ({ ...prev, [id]: isLoading }));
  };

  const refreshData = () => Promise.all([fetchQueue(), fetchStats()]);

  const handleApprove = async (id) => {
    setItemLoading(id, true);
    try {
      await api.post(`/api/content-review/${id}/approve`);
      await refreshData();
    } catch (err) {
      setError('Failed to approve item');
    } finally {
      setItemLoading(id, false);
    }
  };

  const handleReject = async (id) => {
    setItemLoading(id, true);
    try {
      await api.post(`/api/content-review/${id}/reject`);
      await refreshData();
    } catch (err) {
      setError('Failed to reject item');
    } finally {
      setItemLoading(id, false);
    }
  };

  const handleSchedule = async (id) => {
    setItemLoading(id, true);
    try {
      await api.post(`/api/content-review/${id}/schedule`);
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to schedule item');
    } finally {
      setItemLoading(id, false);
    }
  };

  const handleDelete = async (id) => {
    setItemLoading(id, true);
    try {
      await api.delete(`/api/content-review/${id}`);
      await refreshData();
    } catch (err) {
      setError('Failed to delete item');
    } finally {
      setItemLoading(id, false);
    }
  };

  const handleSaveEdit = async (id) => {
    setItemLoading(id, true);
    try {
      await api.patch(`/api/content-review/${id}`, { content: editContent });
      setEditingId(null);
      setEditContent('');
      await fetchQueue();
    } catch (err) {
      setError('Failed to save edit');
    } finally {
      setItemLoading(id, false);
    }
  };

  const handleBatchApprove = async () => {
    if (selectedItems.size === 0) return;
    setGenerating(true);
    try {
      await api.post('/api/content-review/batch-approve', {
        item_ids: Array.from(selectedItems),
      });
      setSelectedItems(new Set());
      await refreshData();
    } catch (err) {
      setError('Failed to batch approve');
    } finally {
      setGenerating(false);
    }
  };

  const handleBatchSchedule = async () => {
    if (selectedItems.size === 0) return;
    setGenerating(true);
    try {
      await api.post('/api/content-review/batch-schedule', {
        item_ids: Array.from(selectedItems),
      });
      setSelectedItems(new Set());
      await refreshData();
    } catch (err) {
      setError('Failed to batch schedule');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedStrategy) {
      setError('Please select a strategy first');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      await api.post('/api/content-review/generate', {
        strategy_id: selectedStrategy,
      });
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate content');
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const pendingIds = items.filter((i) => i.status === 'pending').map((i) => i.id);
    setSelectedItems(new Set(pendingIds));
  };

  const clearSelection = () => setSelectedItems(new Set());

  const toggleReason = (id) => {
    setExpandedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Format helpers ──────────────────────────────────────────────────
  const formatDate = (dateStr) => {
    if (!dateStr) return 'No time set';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const charCount = (text) => (text || '').length;

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-sm">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            Content Queue
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 ml-12">
            Review, edit, and schedule AI-generated tweets
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating || !selectedStrategy}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          Generate Week's Content
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm shadow-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-lg transition-colors">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats cards */}
      {loading ? (
        <StatsSkeleton />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: 'pending', label: 'Pending', icon: Clock, gradFrom: 'from-amber-500', gradTo: 'to-orange-500', bg: 'bg-amber-50', ring: 'ring-amber-200' },
            { key: 'approved', label: 'Approved', icon: CheckCircle, gradFrom: 'from-emerald-500', gradTo: 'to-green-500', bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
            { key: 'scheduled', label: 'Scheduled', icon: Calendar, gradFrom: 'from-blue-500', gradTo: 'to-indigo-500', bg: 'bg-blue-50', ring: 'ring-blue-200' },
            { key: 'rejected', label: 'Rejected', icon: XCircle, gradFrom: 'from-red-400', gradTo: 'to-rose-500', bg: 'bg-red-50', ring: 'ring-red-200' },
          ].map(({ key, label, icon: Icon, gradFrom, gradTo, bg, ring }) => {
            const isActive = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`relative overflow-hidden group text-left p-4 rounded-xl border transition-all duration-200 ${
                  isActive
                    ? `${bg} border-transparent ring-2 ${ring} shadow-sm`
                    : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={`p-1.5 rounded-lg bg-gradient-to-br ${gradFrom} ${gradTo} shadow-sm`}>
                    <Icon className="w-3.5 h-3.5 text-white" />
                  </div>
                  {isActive && (
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  )}
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold text-gray-900">{stats[key] || 0}</div>
                  <div className="text-xs text-gray-500 font-medium">{label}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar: Strategy selector + filters + batch actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Strategy selector */}
          <div className="flex items-center gap-2 min-w-0">
            <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <select
              value={selectedStrategy || ''}
              onChange={(e) => setSelectedStrategy(e.target.value || null)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-colors min-w-0 max-w-[200px]"
            >
              <option value="">All strategies</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.niche || 'Strategy'} — {s.status}
                </option>
              ))}
            </select>
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 hidden sm:block" />

          {/* Filter pills */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setFilter('all')}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                filter === 'all'
                  ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              All
            </button>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all hidden sm:inline-flex items-center gap-1.5 ${
                  filter === key
                    ? `${cfg.color} border shadow-sm`
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
                {cfg.label.replace(' Review', '')}
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Batch actions */}
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-1.5 border border-blue-200">
              <span className="text-xs font-semibold text-blue-700">{selectedItems.size} selected</span>
              <button
                onClick={handleBatchApprove}
                disabled={generating}
                className="text-xs font-medium px-2.5 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={handleBatchSchedule}
                disabled={generating}
                className="text-xs font-medium px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Schedule
              </button>
              <button onClick={clearSelection} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                Clear
              </button>
            </div>
          )}

          {filter === 'pending' && items.length > 0 && selectedItems.size === 0 && (
            <button onClick={selectAll} className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors">
              <CheckSquare className="w-3.5 h-3.5" /> Select all
            </button>
          )}

          <button
            onClick={() => refreshData()}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="w-16 h-16 mx-auto mb-5 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No content yet</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6">
            Generate AI-crafted tweets for your strategy. We'll create a week's worth of content tailored to your audience.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedStrategy}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
          >
            <Zap className="w-4 h-4" />
            Generate Week's Content
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
            const StatusIcon = statusCfg.icon;
            const isEditing = editingId === item.id;
            const isLoading = actionLoading[item.id];
            const isSelected = selectedItems.has(item.id);
            const isReasonExpanded = expandedReasons.has(item.id);

            return (
              <div
                key={item.id}
                className={`group bg-white rounded-xl border transition-all duration-200 ${
                  isSelected
                    ? 'border-blue-400 ring-2 ring-blue-100 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className="p-5">
                  {/* Top row: checkbox + status + category + time */}
                  <div className="flex items-center gap-2.5 mb-3">
                    {item.status === 'pending' && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    )}

                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border ${statusCfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusCfg.label}
                    </span>

                    {item.source === 'autopilot' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 uppercase tracking-wider">
                        Autopilot
                      </span>
                    )}

                    {isThread(item.content) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                        <Layers className="w-3 h-3" />
                        Thread · {getThreadParts(item.content).length} parts
                      </span>
                    )}

                    {item.category && (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${CATEGORY_COLORS[item.category] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {item.category}
                      </span>
                    )}

                    <span className="text-xs text-gray-400 flex items-center gap-1.5 ml-auto">
                      <Calendar className="w-3 h-3" />
                      {formatDate(item.suggested_time)}
                    </span>
                  </div>

                  {/* Content */}
                  {isEditing ? (
                    <div className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-colors bg-white"
                        rows={isThread(editContent) ? 8 : 4}
                        autoFocus
                      />
                      <div className="flex items-center justify-between">
                        {isThread(editContent) ? (
                          <span className="text-xs font-medium text-purple-600">
                            Thread · {getThreadParts(editContent).length} parts (separate with ---)
                          </span>
                        ) : (
                          <span className={`text-xs font-medium ${charCount(editContent) > 280 ? 'text-red-500' : charCount(editContent) > 250 ? 'text-amber-500' : 'text-gray-400'}`}>
                            {charCount(editContent)}/280
                          </span>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditingId(null); setEditContent(''); }}
                            className="text-xs font-medium px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(item.id)}
                            disabled={isLoading || charCount(editContent) === 0 || (!isThread(editContent) && charCount(editContent) > 280)}
                            className="text-xs font-medium px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save changes'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const threadParts = getThreadParts(item.content);
                      if (threadParts) {
                        return (
                          <div className="space-y-2">
                            {threadParts.map((part, i) => (
                              <div key={i} className={`text-sm text-gray-800 leading-relaxed pl-3 border-l-2 ${
                                i === 0 ? 'border-blue-400' : 'border-purple-300'
                              } py-1`}>
                                <span className={`text-[10px] font-bold ${i === 0 ? 'text-blue-600' : 'text-purple-600'} block mb-0.5`}>
                                  {i + 1}/{threadParts.length}
                                </span>
                                <p className="whitespace-pre-wrap">{part}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return (
                        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed pl-0.5">
                          {item.content}
                        </p>
                      );
                    })()
                  )}

                  {/* Source prompt attribution */}
                  {item.source_prompt_text && (
                    <div className="mt-3 flex items-start gap-2 p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-400 block mb-0.5">From prompt</span>
                        <p className="text-xs text-indigo-700 line-clamp-2 leading-relaxed">{item.source_prompt_text}</p>
                        {item.source_prompt_category && (
                          <span className="inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 capitalize">
                            {item.source_prompt_category}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Reason (collapsible) */}
                  {item.reason && (
                    <div className="mt-3">
                      <button
                        onClick={() => toggleReason(item.id)}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors"
                      >
                        {isReasonExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        <Eye className="w-3 h-3" />
                        Why this tweet?
                      </button>
                      {isReasonExpanded && (
                        <p className="text-xs text-gray-500 mt-2 pl-4 border-l-2 border-blue-200 bg-blue-50/50 rounded-r-lg py-2 pr-3">
                          {item.reason}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Action bar */}
                {(item.status === 'pending' || item.status === 'approved') && !isEditing && (
                  <div className="flex items-center gap-1.5 px-5 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-xl">
                    {item.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(item.id)}
                          disabled={isLoading}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                        >
                          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(item.id)}
                          disabled={isLoading}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                        >
                          <XCircle className="w-3 h-3" /> Reject
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleSchedule(item.id)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Schedule
                    </button>

                    <div className="flex-1" />

                    <button
                      onClick={() => {
                        setEditingId(item.id);
                        setEditContent(item.content);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
