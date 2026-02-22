import React, { useEffect, useMemo, useRef, useState } from 'react';
import Masonry from 'react-masonry-css';
import Collapsible from '../components/Collapsible';
import RichTextTextarea from '../components/RichTextTextarea';
import { Switch } from '@headlessui/react';
import { ai, tweets, scheduling } from '../utils/api';
import { loadDraft, saveDraft, clearDraft } from '../utils/draftStorage';
import dayjs from 'dayjs';
import moment from 'moment-timezone';
import { Lock } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasProPlanAccess } from '../utils/planAccess';
import { getSuiteGenieProUpgradeUrl } from '../utils/upgradeUrl';

const BULK_GENERATION_SEED_KEY = 'bulkGenerationSeed';
const BULK_GENERATION_DRAFT_KEY = 'bulkGenerationDraft';
const BULK_GENERATION_DRAFT_VERSION = 1;
const BULK_GENERATION_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BULK_PROMPTS = 30;
const MAX_SCHEDULING_WINDOW_DAYS = 15;
const RECOMMENDED_SCHEDULING_WINDOW_DAYS = 14;
const PROMPT_LIMIT_WARNING = `Only the first ${MAX_BULK_PROMPTS} prompts will be used.`;

const splitStrategyPromptInstruction = (rawPrompt = '') => {
  const normalized = String(rawPrompt || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { prompt: '', instruction: '', hasInstruction: false };
  }

  const instructionMatch = normalized.match(/\bInstruction:\s*/i);
  if (!instructionMatch || typeof instructionMatch.index !== 'number') {
    return { prompt: normalized, instruction: '', hasInstruction: false };
  }

  const promptPart = normalized.slice(0, instructionMatch.index).replace(/\s+/g, ' ').trim();
  const instructionPart = normalized
    .slice(instructionMatch.index + instructionMatch[0].length)
    .replace(/\s+/g, ' ')
    .trim();

  return {
    prompt: promptPart || normalized.replace(/\s+/g, ' ').trim(),
    instruction: instructionPart,
    hasInstruction: Boolean(instructionPart),
  };
};

const buildBulkGenerationRequestPrompt = (rawPrompt, isThread) => {
  const parsed = splitStrategyPromptInstruction(rawPrompt);
  if (!parsed.hasInstruction) {
    return rawPrompt;
  }

  const lines = [
    isThread
      ? 'Create ONE complete X (Twitter) thread from the strategy prompt below.'
      : 'Create ONE complete X (Twitter) tweet from the strategy prompt below.',
    'Return only the final content.',
    'Do not add prefaces like "Here is", "Okay", or labels.',
    'Do not leave the output unfinished or end mid-example.',
    isThread
      ? 'Thread format: 3-5 tweets separated by --- and each tweet under 280 characters.'
      : 'Keep the tweet under 260 characters.',
    `Strategy prompt: ${parsed.prompt}`,
    `Execution instruction: ${parsed.instruction}`,
  ];

  return lines.join('\n');
};

const sanitizeDraftString = (value, maxLength = 2000) =>
  String(value || '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);

const normalizeBulkDraftManualPromptItems = (items = [], maxCount = MAX_BULK_PROMPTS) => {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => ({
      id: index,
      prompt: sanitizeDraftString(item?.prompt, 1200),
      isThread: Boolean(item?.isThread),
    }))
    .filter((item) => item.prompt.length > 0)
    .slice(0, maxCount)
    .map((item, index) => ({ ...item, id: index }));
};

const serializeBulkOutputsForDraft = (outputs = {}) => {
  if (!outputs || typeof outputs !== 'object') return {};

  return Object.entries(outputs).reduce((acc, [key, value]) => {
    if (!value || typeof value !== 'object' || value.loading) return acc;

    const isThread = Boolean(value.isThread);
    const threadParts = isThread
      ? (Array.isArray(value.threadParts)
          ? value.threadParts.map((part) => sanitizeDraftString(part, 1000)).filter(Boolean)
          : [])
      : [];
    const text = isThread
      ? (threadParts.length > 0 ? threadParts.join('---') : sanitizeDraftString(value.text, 5000))
      : sanitizeDraftString(value.text, 1200);

    if (!text && !value.error) return acc;

    acc[String(key)] = {
      id: Number.isFinite(Number(value.id)) ? Number(value.id) : Number(key),
      prompt: sanitizeDraftString(value.prompt, 1200),
      isThread,
      text,
      threadParts: isThread ? threadParts : undefined,
      error: value.error ? sanitizeDraftString(value.error, 500) : null,
    };

    return acc;
  }, {});
};

const restoreBulkOutputsFromDraft = (rawOutputs = {}) => {
  if (!rawOutputs || typeof rawOutputs !== 'object' || Array.isArray(rawOutputs)) {
    return {};
  }

  return Object.entries(rawOutputs).reduce((acc, [key, value], fallbackIndex) => {
    if (!value || typeof value !== 'object') return acc;

    const isThread = Boolean(value.isThread);
    let threadParts = [];
    if (isThread) {
      threadParts = Array.isArray(value.threadParts)
        ? value.threadParts.map((part) => sanitizeDraftString(part, 1000)).filter(Boolean)
        : splitGeneratedThreadParts(value.text || '');
      if (threadParts.length === 0) {
        const fallbackText = sanitizeDraftString(value.text, 5000);
        if (fallbackText) threadParts = [fallbackText];
      }
    }

    const text = isThread
      ? (threadParts.length > 0 ? threadParts.join('---') : sanitizeDraftString(value.text, 5000))
      : sanitizeDraftString(value.text, 1200);
    const error = value.error ? sanitizeDraftString(value.error, 500) : null;

    if (!text && !error) return acc;

    const numericId = Number.isFinite(Number(value.id)) ? Number(value.id) : fallbackIndex;
    acc[String(key)] = {
      id: numericId,
      prompt: sanitizeDraftString(value.prompt, 1200),
      isThread,
      text,
      threadParts: isThread ? threadParts : undefined,
      images: Array(isThread ? Math.max(threadParts.length, 1) : 1).fill(null),
      loading: false,
      error,
      appeared: true,
    };
    return acc;
  }, {});
};

const serializeSeededPromptItemsForDraft = (items = []) => {
  if (!Array.isArray(items)) return [];

  return items
    .slice(0, MAX_BULK_PROMPTS)
    .map((item) => ({
      sourceType: typeof item?.sourceType === 'string' ? item.sourceType : 'seeded_strategy',
      prompt: sanitizeDraftString(item?.prompt, 1200),
      isThread: Boolean(item?.isThread),
      category: sanitizeDraftString(item?.category, 120) || 'general',
      idea: sanitizeDraftString(item?.idea, 600),
      instruction: sanitizeDraftString(item?.instruction, 500),
      recommendedFormat: sanitizeDraftString(item?.recommendedFormat, 40) || (item?.isThread ? 'thread' : 'single_tweet'),
      goal: sanitizeDraftString(item?.goal, 160),
      hashtagsHint: sanitizeDraftString(item?.hashtagsHint, 160),
      legacyPromptText: sanitizeDraftString(item?.prompt || item?.legacyPromptText, 1200),
      strategyPrompt: item?.strategyPrompt
        ? {
            strategyId: item.strategyPrompt.strategyId ?? null,
            promptId: item.strategyPrompt.promptId ?? null,
            idea: sanitizeDraftString(item.strategyPrompt.idea, 600),
            instruction: sanitizeDraftString(item.strategyPrompt.instruction, 500),
            category: sanitizeDraftString(item.strategyPrompt.category, 120),
            recommendedFormat: sanitizeDraftString(item.strategyPrompt.recommendedFormat, 40),
            goal: sanitizeDraftString(item.strategyPrompt.goal, 160),
            hashtagsHint: sanitizeDraftString(item.strategyPrompt.hashtagsHint, 160),
            extraContext: sanitizeDraftString(item.strategyPrompt.extraContext, 2000),
          }
        : null,
    }))
    .filter((item) => item.idea || item.prompt);
};

const hasMeaningfulBulkDraft = ({ prompts, promptList, seededPromptItems, outputs, discarded }) => {
  const outputCount = outputs && typeof outputs === 'object' ? Object.keys(outputs).length : 0;
  return Boolean(
    String(prompts || '').trim() ||
      (Array.isArray(promptList) && promptList.length > 0) ||
      (Array.isArray(seededPromptItems) && seededPromptItems.length > 0) ||
      outputCount > 0 ||
      (Array.isArray(discarded) && discarded.length > 0)
  );
};

const splitGeneratedThreadParts = (content = '', preferredParts) => {
  if (Array.isArray(preferredParts) && preferredParts.length > 0) {
    return preferredParts.map((part) => String(part || '').trim()).filter(Boolean);
  }

  const safeContent = String(content || '').trim();
  if (!safeContent) return [];

  // Method 1: Split by '---' (primary separator)
  if (safeContent.includes('---')) {
    return safeContent.split('---').map((t) => t.trim()).filter(Boolean);
  }

  // Method 2: numbered patterns (1., 2., etc.)
  if (safeContent.match(/^\d+\./m)) {
    return safeContent.split(/(?=^\d+\.)/m).map((t) => t.trim()).filter(Boolean);
  }

  // Method 3: double newline
  if (safeContent.includes('\n\n')) {
    return safeContent.split('\n\n').map((t) => t.trim()).filter(Boolean);
  }

  // Method 4: intelligent sentence split for long content
  if (safeContent.length > 280) {
    const sentences = safeContent.split(/[.!?]+\s+/).filter((s) => s.trim());
    const threadParts = [];
    let currentPart = '';

    for (const sentence of sentences) {
      if ((currentPart + sentence).length > 250 && currentPart) {
        threadParts.push(currentPart.trim());
        currentPart = sentence;
      } else {
        currentPart += (currentPart ? '. ' : '') + sentence;
      }
    }
    if (currentPart) threadParts.push(currentPart.trim());
    return threadParts.filter(Boolean);
  }

  return [safeContent];
};

const normalizeStructuredSeededItem = (item, index, strategyIdFromSeed = null) => {
  const safeString = (value, maxLength = 500) =>
    String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

  const idea = safeString(item?.idea || '', 600);
  const instruction = safeString(item?.instruction || '', 500);
  const recommendedFormat = safeString(item?.recommendedFormat || item?.recommended_format || '', 40).toLowerCase() || 'single_tweet';
  const category = safeString(item?.category || 'general', 120) || 'general';
  const goal = safeString(item?.goal || '', 160);
  const hashtagsHint = safeString(item?.hashtagsHint || item?.hashtags_hint || '', 160);
  const extraContext = safeString(item?.extraContext || item?.extra_context || '', 2000);
  const legacyPromptText = safeString(item?.legacyPromptText || item?.prompt || '', 1200);

  if (!idea || idea.length < 5) return null;

  return {
    id: `seed-${index}`,
    sourceType: 'seeded_strategy',
    prompt: legacyPromptText || (instruction ? `${idea} Instruction: ${instruction}` : idea),
    isThread: Boolean(item?.isThread) || recommendedFormat === 'thread',
    category,
    idea,
    instruction,
    recommendedFormat,
    goal,
    hashtagsHint,
    strategyPrompt: {
      strategyId: item?.strategyId ?? strategyIdFromSeed ?? null,
      promptId: item?.promptId ?? item?.id ?? null,
      idea,
      instruction,
      category,
      recommendedFormat,
      goal,
      hashtagsHint,
      extraContext,
    },
  };
};

const normalizeLegacySeededItem = (item, index) => {
  const rawPrompt = typeof item?.prompt === 'string' ? item.prompt : '';
  const parsed = splitStrategyPromptInstruction(rawPrompt);
  const category = typeof item?.category === 'string' ? item.category.trim() || 'general' : 'general';

  if (!parsed.prompt || parsed.prompt.length < 3) return null;

  return {
    id: `seed-${index}`,
    sourceType: 'seeded_legacy',
    prompt: rawPrompt.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    isThread: Boolean(item?.isThread),
    category,
    idea: parsed.prompt,
    instruction: parsed.instruction,
    recommendedFormat: Boolean(item?.isThread) ? 'thread' : 'single_tweet',
    goal: '',
    hashtagsHint: '',
    strategyPrompt: {
      strategyId: item?.strategyId ?? null,
      promptId: item?.id ?? null,
      idea: parsed.prompt,
      instruction: parsed.instruction,
      category,
      recommendedFormat: Boolean(item?.isThread) ? 'thread' : 'single_tweet',
      goal: '',
      hashtagsHint: '',
      extraContext: '',
    },
  };
};

const BulkGeneration = () => {
  const { user } = useAuth();
  const hasProAccess = hasProPlanAccess(user);
  const upgradeUrl = getSuiteGenieProUpgradeUrl();
  const location = useLocation();
  const hasAppliedSeedRef = useRef(false);
  const appliedStrategySeedThisMountRef = useRef(false);
  const hasHydratedBulkDraftRef = useRef(false);
  const hasSkippedBulkDraftAutosaveRef = useRef(false);
  const outputSectionRef = useRef(null);
  const [prompts, setPrompts] = useState('');
  const [promptList, setPromptList] = useState([]); // manual prompts only [{ prompt, isThread }]
  const [seededPromptItems, setSeededPromptItems] = useState([]); // structured strategy-seeded prompts
  // outputs: { [idx]: { ...result, loading, error } }
  const [outputs, setOutputs] = useState({});
  const [discarded, setDiscarded] = useState([]); // array of idx
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [frequency, setFrequency] = useState('daily');
  const [startDate, setStartDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [postsPerDay, setPostsPerDay] = useState(1);
  const [dailyTimes, setDailyTimes] = useState(['09:00']);
  const [daysOfWeek, setDaysOfWeek] = useState([]); // for custom
  const [schedulingStatus, setSchedulingStatus] = useState('idle');
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreditInfo, setShowCreditInfo] = useState(true);
  const [seedMessage, setSeedMessage] = useState('');
  const outputCount = Object.keys(outputs).length;
  const combinedPromptItems = useMemo(
    () => [...seededPromptItems, ...promptList].slice(0, MAX_BULK_PROMPTS),
    [seededPromptItems, promptList]
  );

  const frequencyOptions = [
    { value: 'daily', label: 'Daily posting' },
    { value: 'thrice_weekly', label: 'Thrice a week' },
    { value: 'four_times_weekly', label: 'Four times a week' },
    { value: 'custom', label: 'Custom days' },
  ];

  useEffect(() => {
    if (hasAppliedSeedRef.current) return;

    const seedFromState = location?.state?.bulkGenerationSeed;
    let parsedSeed = seedFromState || null;

    if (!parsedSeed) {
      try {
        const rawSeed = localStorage.getItem(BULK_GENERATION_SEED_KEY);
        parsedSeed = rawSeed ? JSON.parse(rawSeed) : null;
      } catch {
        parsedSeed = null;
      }
    }

    if (!parsedSeed || !Array.isArray(parsedSeed.items) || parsedSeed.items.length === 0) {
      hasAppliedSeedRef.current = true;
      return;
    }

    const normalizedItems = parsedSeed.items
      .map((item, index) => {
        const isV2 = parsedSeed?.version === 2 || item?.idea || item?.promptId || item?.legacyPromptText;
        return isV2
          ? normalizeStructuredSeededItem(item, index, parsedSeed?.strategyId ?? null)
          : normalizeLegacySeededItem(item, index);
      })
      .filter(Boolean)
      .slice(0, MAX_BULK_PROMPTS);

    if (normalizedItems.length > 0) {
      appliedStrategySeedThisMountRef.current = true;
      setSeededPromptItems(normalizedItems);
      setPrompts('');
      setPromptList([]);
      const wasTrimmed = parsedSeed.items.length > normalizedItems.length;
      setSeedMessage(
        `Loaded ${normalizedItems.length} strategy prompt${normalizedItems.length === 1 ? '' : 's'} from Strategy Builder.${wasTrimmed ? ` Capped to ${MAX_BULK_PROMPTS}.` : ''}`
      );
    }

    localStorage.removeItem(BULK_GENERATION_SEED_KEY);
    hasAppliedSeedRef.current = true;
  }, [location?.state]);

  useEffect(() => {
    if (!hasAppliedSeedRef.current || hasHydratedBulkDraftRef.current) return;

    hasHydratedBulkDraftRef.current = true;

    if (appliedStrategySeedThisMountRef.current) {
      return;
    }

    const loaded = loadDraft(BULK_GENERATION_DRAFT_KEY, {
      version: BULK_GENERATION_DRAFT_VERSION,
      ttlMs: BULK_GENERATION_DRAFT_TTL_MS,
    });

    const draft = loaded?.data;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      return;
    }

    let restoredSeeded = [];
    if (Array.isArray(draft.seededPromptItems)) {
      restoredSeeded = draft.seededPromptItems
        .map((item, index) => {
          const preferred = item?.strategyPrompt && typeof item.strategyPrompt === 'object'
            ? {
                ...item,
                ...item.strategyPrompt,
                isThread: item?.isThread,
                legacyPromptText: item?.legacyPromptText || item?.prompt,
              }
            : item;

          return normalizeStructuredSeededItem(preferred, index, item?.strategyPrompt?.strategyId ?? item?.strategyId ?? null)
            || normalizeLegacySeededItem(item, index);
        })
        .filter(Boolean)
        .slice(0, MAX_BULK_PROMPTS);
    }

    const remainingSlots = Math.max(0, MAX_BULK_PROMPTS - restoredSeeded.length);
    let restoredManualPromptList = normalizeBulkDraftManualPromptItems(draft.promptList, remainingSlots);

    if (restoredManualPromptList.length === 0 && typeof draft.prompts === 'string') {
      const fallbackLines = draft.prompts
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, remainingSlots);
      restoredManualPromptList = fallbackLines.map((prompt, index) => ({
        id: index,
        prompt,
        isThread: false,
      }));
    }

    const restoredPromptsText = restoredManualPromptList.map((item) => item.prompt).join('\n');
    const restoredOutputs = restoreBulkOutputsFromDraft(draft.outputs);
    const restoredDiscarded = Array.isArray(draft.discarded)
      ? draft.discarded.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
      : [];

    setSeededPromptItems(restoredSeeded);
    setPromptList(restoredManualPromptList);
    setPrompts(restoredPromptsText);
    setOutputs(restoredOutputs);
    setDiscarded(restoredDiscarded);

    if (typeof draft.frequency === 'string' && frequencyOptions.some((opt) => opt.value === draft.frequency)) {
      setFrequency(draft.frequency);
    }
    if (typeof draft.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) {
      setStartDate(draft.startDate);
    }
    if (typeof draft.timeOfDay === 'string' && /^\d{2}:\d{2}$/.test(draft.timeOfDay)) {
      setTimeOfDay(draft.timeOfDay);
    }
    if (Number.isInteger(draft.postsPerDay) && draft.postsPerDay >= 1 && draft.postsPerDay <= 5) {
      setPostsPerDay(draft.postsPerDay);
    }
    if (Array.isArray(draft.dailyTimes) && draft.dailyTimes.length > 0) {
      const restoredDailyTimes = draft.dailyTimes
        .map((time) => (typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : null))
        .filter(Boolean)
        .slice(0, 5);
      if (restoredDailyTimes.length > 0) {
        setDailyTimes(restoredDailyTimes);
      }
    }
    if (Array.isArray(draft.daysOfWeek)) {
      setDaysOfWeek(
        draft.daysOfWeek
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      );
    }

    setSeedMessage((prev) => prev || 'Restored your bulk generation draft.');
  }, [location?.state, frequencyOptions]);

  useEffect(() => {
    if (outputCount > 0 && outputSectionRef.current) {
      outputSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [outputCount]);

  useEffect(() => {
    if (!hasHydratedBulkDraftRef.current) return;

    if (!hasSkippedBulkDraftAutosaveRef.current) {
      hasSkippedBulkDraftAutosaveRef.current = true;
      return;
    }

    const promptListForDraft = normalizeBulkDraftManualPromptItems(
      promptList,
      Math.max(0, MAX_BULK_PROMPTS - seededPromptItems.length)
    );
    const promptsTextForDraft = promptListForDraft.map((item) => item.prompt).join('\n');
    const draftPayload = {
      prompts: promptsTextForDraft,
      promptList: promptListForDraft.map((item) => ({
        prompt: item.prompt,
        isThread: Boolean(item.isThread),
      })),
      seededPromptItems: serializeSeededPromptItemsForDraft(seededPromptItems),
      outputs: serializeBulkOutputsForDraft(outputs),
      discarded: Array.isArray(discarded)
        ? discarded.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
        : [],
      frequency,
      startDate,
      timeOfDay,
      postsPerDay,
      dailyTimes: Array.isArray(dailyTimes) ? dailyTimes.map((time) => String(time || '').slice(0, 5)) : [],
      daysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek.map((day) => Number(day)).filter(Number.isInteger) : [],
    };

    const timeoutId = setTimeout(() => {
      if (!hasMeaningfulBulkDraft(draftPayload)) {
        clearDraft(BULK_GENERATION_DRAFT_KEY);
        return;
      }

      saveDraft(BULK_GENERATION_DRAFT_KEY, draftPayload, { version: BULK_GENERATION_DRAFT_VERSION });
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    prompts,
    promptList,
    seededPromptItems,
    outputs,
    discarded,
    frequency,
    startDate,
    timeOfDay,
    postsPerDay,
    dailyTimes,
    daysOfWeek,
  ]);

  // Handle posts per day change
  const handlePostsPerDayChange = (count) => {
    setPostsPerDay(count);
    const newTimes = Array(count).fill(null).map((_, i) => 
      dailyTimes[i] || `${String(9 + i * 3).padStart(2, '0')}:00`
    );
    setDailyTimes(newTimes);
  };

  // Handle individual time change
  const handleTimeChange = (index, time) => {
    const newTimes = [...dailyTimes];
    newTimes[index] = time;
    setDailyTimes(newTimes);
  };

  // Discard a generated output by idx
  const handleDiscard = (idx) => {
    setDiscarded(prev => [...prev, idx]);
  };

  // Schedule all non-discarded outputs
  const handleScheduleAll = () => {
    setShowScheduleModal(true);
  };

  // Helper to convert File to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Schedule each output using the same logic as Compose
  const handleSchedule = async () => {
    setSchedulingStatus('scheduling');
    try {
      const toSchedule = Object.keys(outputs)
        .filter(idx => !discarded.includes(Number(idx)))
        .map(idx => outputs[idx]);
      if (toSchedule.length === 0) {
        setSchedulingStatus('error');
        alert('No tweets/threads to schedule.');
        return;
      }
      if (toSchedule.length > MAX_BULK_PROMPTS) {
        setSchedulingStatus('error');
        alert(`You can schedule up to ${MAX_BULK_PROMPTS} prompts at a time.`);
        return;
      }
      const timezone = moment.tz.guess();
      // Calculate scheduled times for each item based on frequency, startDate, dailyTimes, daysOfWeek
      let scheduledTimes = [];
      let current = dayjs(startDate);
      if (frequency === 'daily') {
        for (let i = 0; i < toSchedule.length; i++) {
          const dayOffset = Math.floor(i / postsPerDay);
          const timeIndex = i % postsPerDay;
          const [hour, minute] = dailyTimes[timeIndex].split(':').map(Number);
          scheduledTimes.push(current.add(dayOffset, 'day').hour(hour).minute(minute).second(0).format());
        }
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        let idx = 0;
        let week = 0;
        while (scheduledTimes.length < toSchedule.length) {
          for (const d of days) {
            for (let timeIndex = 0; timeIndex < postsPerDay && scheduledTimes.length < toSchedule.length; timeIndex++) {
              const [hour, minute] = dailyTimes[timeIndex].split(':').map(Number);
              scheduledTimes.push(dayjs(startDate).add(week, 'week').day(d).hour(hour).minute(minute).second(0).format());
            }
          }
          week++;
        }
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek) && daysOfWeek.length > 0) {
        let idx = 0;
        let week = 0;
        while (scheduledTimes.length < toSchedule.length) {
          for (const d of daysOfWeek) {
            for (let timeIndex = 0; timeIndex < postsPerDay && scheduledTimes.length < toSchedule.length; timeIndex++) {
              const [hour, minute] = dailyTimes[timeIndex].split(':').map(Number);
              scheduledTimes.push(dayjs(startDate).add(week, 'week').day(d).hour(hour).minute(minute).second(0).format());
            }
          }
          week++;
        }
      } else {
        // fallback: use first time for all posts
        const [hour, minute] = dailyTimes[0].split(':').map(Number);
        for (let i = 0; i < toSchedule.length; i++) {
          scheduledTimes.push(current.add(i, 'day').hour(hour).minute(minute).second(0).format());
        }
      }

      const maxSchedulingTime = dayjs().add(MAX_SCHEDULING_WINDOW_DAYS, 'day');
      const exceedsWindow = scheduledTimes.some((time) => dayjs(time).isAfter(maxSchedulingTime));
      if (exceedsWindow) {
        setSchedulingStatus('error');
        alert(`Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead. For best results, plan up to ${RECOMMENDED_SCHEDULING_WINDOW_DAYS} days and then revisit strategy.`);
        return;
      }

      // Prepare items for bulk scheduling
      const items = [];
      const mediaMap = {};
      
      for (let i = 0; i < toSchedule.length; i++) {
        const item = toSchedule[i];
        let media = [];
        if (item.isThread && Array.isArray(item.threadParts)) {
          // For threads, collect images for each part (only non-null images)
          for (let j = 0; j < item.threadParts.length; j++) {
            if (item.images && item.images[j]) {
              const img = item.images[j];
              // Handle array of images (multiple images per tweet)
              if (Array.isArray(img)) {
                for (const file of img) {
                  if (file instanceof File) {
                    // eslint-disable-next-line no-await-in-loop
                    media.push(await fileToBase64(file));
                  } else if (typeof file === 'string') {
                    media.push(file);
                  }
                }
              } else if (img instanceof File) {
                // eslint-disable-next-line no-await-in-loop
                media.push(await fileToBase64(img));
              } else if (typeof img === 'string') {
                media.push(img);
              }
            }
          }
        } else {
          // Single tweet - handle array of images
          if (item.images && item.images[0]) {
            const imgs = item.images[0];
            if (Array.isArray(imgs)) {
              for (const img of imgs) {
                if (img instanceof File) {
                  // eslint-disable-next-line no-await-in-loop
                  media.push(await fileToBase64(img));
                } else if (typeof img === 'string') {
                  media.push(img);
                }
              }
            } else if (imgs instanceof File) {
              // eslint-disable-next-line no-await-in-loop
              media.push(await fileToBase64(imgs));
            } else if (typeof imgs === 'string') {
              media.push(imgs);
            }
          }
        }
        
        items.push({
          text: item.isThread ? item.threadParts.join('---') : item.text,
          isThread: item.isThread,
          threadParts: item.isThread ? item.threadParts : null
        });
        
        if (media.length > 0) {
          mediaMap[i] = media;
        }
      }

      // Use bulk scheduling API
      // Get selected account info from localStorage
      let teamId = null;
      let accountId = null;
      const selectedAccountRaw = localStorage.getItem('selectedTwitterAccount');
      if (selectedAccountRaw) {
        try {
          const selectedAccount = JSON.parse(selectedAccountRaw);
          accountId = selectedAccount.id || selectedAccount.account_id || null;
          // Try to get teamId from account or from session storage
          teamId = selectedAccount.team_id || sessionStorage.getItem('currentTeamId') || null;
        } catch (e) {
          accountId = null;
          teamId = null;
        }
      } else {
        // fallback: try sessionStorage
        teamId = sessionStorage.getItem('currentTeamId') || null;
      }
      const bulkPayload = {
        items,
        frequency,
        startDate,
        postsPerDay,
        dailyTimes,
        daysOfWeek,
        images: mediaMap,
        timezone,
        teamId,
        accountId
      };

      try {
        const result = await scheduling.bulk(bulkPayload);
        setSchedulingStatus('success');
        setShowScheduleModal(false);
        alert(`Successfully scheduled ${result.data.scheduled.length} tweets/threads.`);
      } catch (err) {
        setSchedulingStatus('error');
        const details = err?.response?.data?.details;
        const errorMsg = err?.response?.data?.error || err.message;
        alert('Failed to schedule.' + (details ? ('\n' + details.join('\n')) : '') + '\n' + errorMsg);
      }
    } catch (err) {
      setSchedulingStatus('error');
      const details = err?.response?.data?.details;
      const errorMsg = err?.response?.data?.error || err.message;
      alert('Failed to schedule.' + (details ? ('\n' + details.join('\n')) : '') + '\n' + errorMsg);
    }
  };

  // Handle prompt input (one per line)
  // When textarea changes, update promptList
  const handlePromptsChange = (e) => {
    const rawValue = e.target.value.replace(/\r\n/g, '\n');
    const lines = rawValue.split('\n').map((p) => p.trim()).filter(Boolean);
    const remainingSlots = Math.max(0, MAX_BULK_PROMPTS - seededPromptItems.length);
    const cappedLines = lines.slice(0, remainingSlots);
    setPrompts(rawValue);
    if (lines.length > remainingSlots) {
      setError(PROMPT_LIMIT_WARNING);
    } else {
      setError((prev) => (prev === PROMPT_LIMIT_WARNING ? '' : prev));
    }
    setPromptList((prev) =>
      cappedLines.map((prompt, idx) => ({
        prompt,
        isThread: prev[idx]?.isThread ?? false,
        id: idx,
      }))
    );
  };

  const handlePromptThreadToggle = (idx, isThread) => {
    setPromptList((list) => list.map((item, i) => (i === idx ? { ...item, isThread } : item)));
  };

  const handleSeededPromptThreadToggle = (idx, isThread) => {
    setSeededPromptItems((list) =>
      list.map((item, i) => {
        if (i !== idx) return item;
        return {
          ...item,
          isThread,
          strategyPrompt: item.strategyPrompt
            ? {
                ...item.strategyPrompt,
                recommendedFormat: isThread ? 'thread' : 'single_tweet',
              }
            : item.strategyPrompt,
        };
      })
    );
  };

  const handleSeededPromptRemove = (idx) => {
    setSeededPromptItems((list) => list.filter((_, i) => i !== idx).map((item, nextIdx) => ({
      ...item,
      id: `seed-${nextIdx}`,
    })));
    setError((prev) => (prev === PROMPT_LIMIT_WARNING ? '' : prev));
  };

  const handlePromptRemove = (idx) => {
    setPromptList((list) => {
      const next = list
        .filter((_, i) => i !== idx)
        .map((item, index) => ({ ...item, id: index }));
      setPrompts(next.map((item) => item.prompt).join('\n'));
      return next;
    });
    setError((prev) => (prev === PROMPT_LIMIT_WARNING ? '' : prev));
  };

  // Call backend for bulk generation directly (no queue)
  const toggleThread = (idx) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[idx]) {
      const output = updated[idx];
      const newIsThread = !output.isThread;
      
      if (newIsThread && !output.threadParts) {
        // Converting from single tweet to thread - try to split the content
        let threadParts = [];
        const content = output.text;
        
        // Try multiple split methods
        if (content.includes('---')) {
          threadParts = content.split('---').map(t => t.trim()).filter(Boolean);
        } else if (content.match(/^\d+\./m)) {
          threadParts = content.split(/(?=^\d+\.)/m).map(t => t.trim()).filter(Boolean);
        } else if (content.includes('\n\n')) {
          threadParts = content.split('\n\n').map(t => t.trim()).filter(Boolean);
        } else if (content.length > 280) {
          // Split long content intelligently
          const sentences = content.split(/[.!?]+\s+/).filter(s => s.trim());
          let currentPart = '';
          
          for (const sentence of sentences) {
            if ((currentPart + sentence).length > 250 && currentPart) {
              threadParts.push(currentPart.trim());
              currentPart = sentence;
            } else {
              currentPart += (currentPart ? '. ' : '') + sentence;
            }
          }
          if (currentPart) threadParts.push(currentPart.trim());
        } else {
          threadParts = [content];
        }

        updated[idx] = { 
          ...output, 
          isThread: true, 
          threadParts: threadParts,
          images: Array(threadParts.length).fill(null)
        };
      } else if (!newIsThread && output.threadParts) {
        // Converting from thread to single tweet - use first part
        updated[idx] = { 
          ...output, 
          isThread: false, 
          text: output.threadParts[0] || output.text,
          threadParts: undefined,
          images: [output.images ? output.images[0] : null]
        };
      } else {
        updated[idx] = { ...output, isThread: newIsThread };
      }
    }
    return updated;
  });
  setPromptList((prev) => prev.map((p, i) => i === idx ? { ...p, isThread: !p.isThread } : p));
};

const updateText = (idx, value) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[idx]) {
      updated[idx] = { ...updated[idx], text: value };
    }
    return updated;
  });
};

const handleImageUpload = (outputIdx, partIdx, files) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[outputIdx]) {
      const newImages = [...(updated[outputIdx].images || [])];
      // Convert FileList to array and support multiple images (up to 4)
      const fileArray = Array.from(files).slice(0, 4);
      newImages[partIdx] = fileArray.length > 0 ? fileArray : null;
      updated[outputIdx] = { ...updated[outputIdx], images: newImages };
    }
    return updated;
  });
};

const removeImage = (outputIdx, partIdx, imageIdx) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[outputIdx] && updated[outputIdx].images[partIdx]) {
      const newImagesForPart = [...updated[outputIdx].images[partIdx]];
      newImagesForPart.splice(imageIdx, 1);
      const newImages = [...updated[outputIdx].images];
      newImages[partIdx] = newImagesForPart.length > 0 ? newImagesForPart : null;
      updated[outputIdx] = { ...updated[outputIdx], images: newImages };
    }
    return updated;
  });
};
const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setOutputs({});
    try {
      if (combinedPromptItems.length === 0) {
        setError('Add at least one prompt to generate.');
        return;
      }
      if (combinedPromptItems.length > MAX_BULK_PROMPTS) {
        setError(`Bulk generation is limited to ${MAX_BULK_PROMPTS} prompts.`);
        return;
      }
      const newOutputs = {};
      for (let idx = 0; idx < combinedPromptItems.length; idx++) {
        const promptItem = combinedPromptItems[idx];
        const { prompt, isThread } = promptItem;
        setOutputs(prev => ({ ...prev, [idx]: { loading: true, prompt } }));
        try {
          const isSeededStrategyPrompt = Boolean(
            typeof promptItem?.sourceType === 'string' &&
              promptItem.sourceType.startsWith('seeded') &&
              promptItem?.strategyPrompt?.idea
          );

          const requestPayload = isSeededStrategyPrompt
            ? {
                prompt: promptItem.prompt || promptItem.idea || '',
                isThread,
                generationMode: 'strategy_prompt',
                strategyPrompt: {
                  ...promptItem.strategyPrompt,
                  recommendedFormat: isThread ? 'thread' : (promptItem.strategyPrompt?.recommendedFormat || 'single_tweet'),
                },
                clientSource: 'bulk',
              }
            : {
                prompt: buildBulkGenerationRequestPrompt(prompt, isThread),
                isThread,
                clientSource: 'bulk',
              };

          const res = await ai.generate(requestPayload);
          const data = res.data;
          if (isThread) {
            let threadParts = splitGeneratedThreadParts(data.content, data.threadParts);
            if (threadParts.length === 0) {
              threadParts = [data.content.trim()];
            }

            newOutputs[idx] = {
              prompt: promptItem.idea || prompt,
              text: (Array.isArray(data.threadParts) && data.threadParts.length > 0)
                ? data.threadParts.join('---')
                : data.content,
              isThread: true,
              threadParts: threadParts,
              images: Array(threadParts.length).fill(null),
              id: idx,
              loading: false,
              error: null,
              appeared: true,
            };
          } else {
            let tweetText = data.content.split('---')[0].trim();
            if (tweetText.length > 280) tweetText = tweetText.slice(0, 280);
            newOutputs[idx] = {
              prompt: promptItem.idea || prompt,
              text: tweetText,
              isThread: false,
              threadParts: undefined,
              images: [null],
              id: idx,
              loading: false,
              error: null,
              appeared: true,
            };
          }
          setOutputs(prev => ({ ...prev, [idx]: newOutputs[idx] }));
        } catch (err) {
          newOutputs[idx] = {
            prompt: promptItem.idea || prompt,
            loading: false,
            error: err?.response?.data?.error || 'Failed to generate.',
          };
          setOutputs(prev => ({ ...prev, [idx]: newOutputs[idx] }));
        }
      }
      setPrompts('');
      setPromptList([]);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to generate tweets/threads.');
    } finally {
      setLoading(false);
    }
  };

  if (!hasProAccess) {
    return (
      <div className="max-w-5xl mx-auto py-8 px-4 min-h-[70vh] space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <Lock className="h-6 w-6 text-amber-700 mt-0.5" />
            <div>
              <h1 className="text-2xl font-bold text-amber-900">Bulk Generation is a Pro feature</h1>
              <p className="mt-2 text-sm text-amber-800">
                You can access this page on Free, but generating bulk tweets and threads requires Pro.
                Upgrade to unlock up to {MAX_BULK_PROMPTS} prompts per run, scheduling, and faster content planning.
              </p>
              <a href={upgradeUrl} className="btn btn-primary mt-4 inline-flex items-center">
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">What you will unlock</h2>
          <ul className="mt-3 text-sm text-gray-700 space-y-2">
            <li>Generate tweets and threads from multiple prompts in one run.</li>
            <li>Schedule generated content in bulk with posting cadence control.</li>
            <li>Reuse prompts from Strategy Builder to plan content faster.</li>
          </ul>
        </div>
      </div>
    );
  }


  return (
    <div className="max-w-7xl mx-auto py-8 px-4 min-h-[80vh]">
      {/* Gradient header */}
      <div className="rounded-xl bg-gradient-to-r from-blue-700 via-blue-500 to-blue-300 p-1 mb-8 shadow-lg">
        <div className="bg-white rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2 md:mb-0 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2h2M12 12v6m0 0l-3-3m3 3l3-3m-6-6V6a2 2 0 012-2h2a2 2 0 012 2v2" /></svg>
            Bulk Tweet & Thread Generation
          </h1>
          {showCreditInfo && (
            <div className="relative bg-blue-50 border border-blue-300 rounded-lg px-5 py-3 flex items-center gap-3 shadow-sm mt-4 md:mt-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" /></svg>
              <span className="text-blue-900 text-sm font-medium">
                <b>How credits are deducted:</b> Each generated tweet or thread costs <b>1 credit</b>. (A thread, no matter how many tweets, is 1 credit. Images do not cost extra.)
              </span>
              <button onClick={() => setShowCreditInfo(false)} className="ml-3 text-blue-400 hover:text-blue-700 text-lg font-bold focus:outline-none">&times;</button>
            </div>
          )}
        </div>
      </div>
      {seedMessage && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {seedMessage}
        </div>
      )}
      <div className="mb-8 bg-blue-50 rounded-2xl shadow-2xl p-10 border border-blue-100">
        <div className="relative mb-6">
          <textarea
            className="peer w-full border-2 border-blue-200 bg-white rounded-xl p-4 min-h-[180px] text-base focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition shadow-sm placeholder-transparent resize-vertical"
            style={{ fontSize: '1.1rem', transition: 'border 0.2s, box-shadow 0.2s' }}
            value={prompts}
            onChange={handlePromptsChange}
            placeholder="Enter one prompt per line..."
            disabled={loading}
            id="bulk-prompts"
            aria-label="Prompts (one per line)"
          />
          <label htmlFor="bulk-prompts" className="absolute left-4 top-3 text-blue-500 text-base font-medium pointer-events-none transition-all duration-200 peer-focus:-top-5 peer-focus:text-sm peer-focus:text-blue-700 peer-placeholder-shown:top-3 peer-placeholder-shown:text-base peer-placeholder-shown:text-blue-400 bg-blue-50 px-1 rounded">
            {seededPromptItems.length > 0 ? 'Add manual prompts (optional, one per line)' : 'Prompts (one per line)'}
          </label>
          <div className="absolute right-4 bottom-3 text-xs text-blue-400 select-none">
            {Math.min(combinedPromptItems.length, MAX_BULK_PROMPTS)}/{MAX_BULK_PROMPTS} prompts
          </div>
        </div>
        {seededPromptItems.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-sm font-semibold text-blue-900">Strategy Builder prompts</div>
            <div className="space-y-2">
              {seededPromptItems.map((item, idx) => (
                <div
                  key={item.id || `seeded-${idx}`}
                  className="rounded-xl border border-blue-200 bg-white/90 px-4 py-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                          {item.category || 'general'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${item.isThread ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                          {item.isThread ? 'Thread' : 'Single Tweet'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-800 leading-relaxed">{item.idea || item.prompt}</div>
                      {item.instruction && (
                        <div className="mt-1 text-xs text-gray-500">
                          <span className="font-medium text-gray-600">Instruction:</span> {item.instruction}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.isThread}
                          onChange={(e) => handleSeededPromptThreadToggle(idx, e.target.checked)}
                          disabled={loading}
                          className="form-checkbox h-4 w-4 text-fuchsia-600 transition"
                        />
                        <span className="ml-2 text-xs text-gray-600">Thread</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleSeededPromptRemove(idx)}
                        disabled={loading}
                        className="h-6 w-6 rounded-full border border-red-300 bg-white text-sm font-bold leading-none text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Remove strategy prompt"
                        aria-label={`Remove strategy prompt ${idx + 1}`}
                      >
                        -
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Seeded prompts come from Strategy Builder. You can toggle thread format or remove any prompt before generating.
            </div>
          </div>
        )}
        <div className="text-xs text-blue-500 mb-2">Tip: Paste or type multiple prompts, one per line. Each line will generate a tweet or thread. You can edit or discard results after generation.</div>
        <div className="text-xs text-blue-600 mb-2">Use <b>Space</b> for normal typing and press <b>Enter</b> for a new prompt line.</div>
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Limit: up to {MAX_BULK_PROMPTS} prompts per run. Recommendation: plan bulk content for up to {RECOMMENDED_SCHEDULING_WINDOW_DAYS} days, then revisit your strategy before generating the next batch.
        </div>
        {promptList.length > 0 && (
          <div className="mt-4 space-y-2">
            {seededPromptItems.length > 0 && (
              <div className="text-sm font-semibold text-blue-900">Manual prompts</div>
            )}
            {promptList.map((p, idx) => (
              <div key={p.id} className="flex items-center justify-between bg-gradient-to-r from-blue-100 to-blue-200 rounded-xl px-4 py-2 border border-blue-200 shadow-sm">
                <span className="text-sm text-gray-700 flex-1 truncate">{p.prompt}</span>
                <div className="flex items-center ml-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.isThread}
                      onChange={(e) => handlePromptThreadToggle(idx, e.target.checked)}
                      disabled={loading}
                      className="form-checkbox h-4 w-4 text-fuchsia-600 transition"
                    />
                    <span className="ml-2 text-xs text-gray-600">Thread</span>
                  </label>
                  {!p.isThread && <span className="ml-2 text-xs text-blue-500">Single Tweet</span>}
                  <button
                    type="button"
                    onClick={() => handlePromptRemove(idx)}
                    disabled={loading}
                    className="ml-3 h-6 w-6 rounded-full border border-red-300 bg-white text-sm font-bold leading-none text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Remove prompt"
                    aria-label={`Remove prompt ${idx + 1}`}
                  >
                    -
                  </button>
                </div>
              </div>
            ))}
            <div className="text-xs text-gray-500 mt-2">By default, all prompts generate single tweets. Toggle <b>Thread</b> for any prompt to generate a thread instead.</div>
          </div>
        )}
        <button
          className="mt-6 bg-gradient-to-r from-blue-600 to-blue-400 text-white px-10 py-3 text-lg font-semibold rounded-xl shadow-lg hover:from-blue-700 hover:to-blue-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={handleGenerate}
          disabled={loading || combinedPromptItems.length === 0}
        >
          {loading ? (
            <span className="flex items-center gap-2"><span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span> Generating...</span>
          ) : 'Generate Tweets/Threads'}
        </button>
        {error && <div className="mt-4 text-red-600 font-medium">{error}</div>}
      </div>
      <div ref={outputSectionRef}>
  {outputCount > 0 && (
        <>
          {/* Scheduling Modal UI */}
          {showScheduleModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
              <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full relative">
                <button className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl" onClick={() => setShowScheduleModal(false)}>&times;</button>
                <h2 className="text-2xl font-bold mb-4">Schedule Your Generated Content</h2>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Frequency:</label>
                  <select className="border rounded px-3 py-2 w-full" value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {frequencyOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Start Date:</label>
                  <input
                    type="date"
                    className="border rounded px-3 py-2 w-full"
                    value={startDate}
                    min={dayjs().format('YYYY-MM-DD')}
                    max={dayjs().add(MAX_SCHEDULING_WINDOW_DAYS, 'day').format('YYYY-MM-DD')}
                    onChange={e => setStartDate(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-amber-700">
                    Hard limit: {MAX_SCHEDULING_WINDOW_DAYS} days ahead. Best practice: schedule up to {RECOMMENDED_SCHEDULING_WINDOW_DAYS} days, review strategy, then generate next batch.
                  </p>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Posts per Day:</label>
                  <select className="border rounded px-3 py-2 w-full" value={postsPerDay} onChange={e => handlePostsPerDayChange(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map(num => (
                      <option key={num} value={num}>{num} post{num > 1 ? 's' : ''} per day</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Posting Times:</label>
                  <div className="space-y-2">
                    {dailyTimes.map((time, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 min-w-[60px]">Time {index + 1}:</span>
                        <input 
                          type="time" 
                          className="border rounded px-3 py-2 flex-1" 
                          value={time} 
                          onChange={e => handleTimeChange(index, e.target.value)} 
                        />
                      </div>
                    ))}
                  </div>
                </div>
                {frequency === 'custom' && (
                  <div className="mb-4">
                    <label className="block font-semibold mb-1">Days of Week:</label>
                    <div className="flex gap-2">
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                        <label key={i} className="flex items-center gap-1">
                          <input type="checkbox" checked={daysOfWeek.includes(i)} onChange={e => {
                            setDaysOfWeek(prev => e.target.checked ? [...prev, i] : prev.filter(x => x !== i));
                          }} />
                          <span>{d}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* Optionally, allow image upload for each output if needed */}
                <button className="btn btn-primary px-6 py-2 mt-4" onClick={handleSchedule} disabled={schedulingStatus === 'scheduling'}>
                  {schedulingStatus === 'scheduling' ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </div>
          )}
          <>
            {/* Progress bar and count */}
            <div className="flex items-center mb-4">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden mr-4">
                <div
                  className="h-2 bg-blue-500 transition-all duration-500"
                  style={{ width: `${(Object.values(outputs).filter(o => o.loading === false).length / (outputCount || 1)) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600 font-medium">
                {Object.values(outputs).filter(o => o.loading === false).length} of {outputCount} generated
              </span>
              {loading && <span className="ml-3 animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full"></span>}
            </div>
            {/* Schedule All button */}
            <div className="flex justify-end mb-2">
                <button
                  className="btn btn-success px-5 py-2 rounded font-semibold shadow"
                  onClick={handleScheduleAll}
                  disabled={outputCount === 0 || Object.keys(outputs).filter(idx => !discarded.includes(Number(idx))).length === 0}
                >
                  Schedule All
                </button>
            </div>
            <Masonry
              breakpointCols={{ default: 2, 900: 1 }}
              className="flex w-full gap-4 min-h-[60vh]"
              columnClassName="masonry-column"
            >
              {Object.keys(outputs)
                .sort((a, b) => Number(a) - Number(b))
                .filter(idx => !discarded.includes(Number(idx)))
                .map((idx) => {
                  const output = outputs[idx];
                  return (
                    <div key={idx} className={`mb-4 transition-all duration-500 ${output.appeared ? 'animate-fadein' : ''}`}>
                      {output.loading ? (
                        <div className="bg-gray-100 rounded-lg p-6 border flex flex-col items-center justify-center min-h-[120px] animate-pulse">
                          <div className="w-2/3 h-4 bg-gray-300 rounded mb-2"></div>
                          <div className="w-1/2 h-3 bg-gray-200 rounded mb-1"></div>
                          <div className="w-1/3 h-3 bg-gray-200 rounded"></div>
                          <span className="mt-4 text-xs text-gray-400">Generating...</span>
                        </div>
                      ) : output.error ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 font-medium">
                          Error: {output.error}
                        </div>
                      ) : (
                        <Collapsible
                          key={`generated-output-${idx}-${output.isThread ? 'thread' : 'single'}`}
                          title={
                            <span>
                              <span className={`px-3 py-1 rounded-full text-xs font-semibold mr-3 transition-colors ${output.isThread ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {output.isThread ? 'Thread' : 'Single Tweet'}
                              </span>
                              <span className="text-gray-500 text-xs italic">Prompt: {output.prompt}</span>
                            </span>
                          }
                          defaultOpen
                        >
                          {output.isThread ? (
                            <div className="grid grid-cols-1 gap-4 mb-2">
                              {output.threadParts?.map((part, tIdx) => (
                                <div key={tIdx} className="mb-2 bg-gray-50 rounded p-3 border flex flex-col">
                                  <RichTextTextarea
                                    className="w-full border rounded p-2 mb-1 min-h-[90px] max-h-[300px] text-base focus:ring-2 focus:ring-purple-400 focus:border-purple-400 transition overflow-auto"
                                    value={part}
                                    onChange={(nextValue) => {
                                      setOutputs(prev => ({
                                        ...prev,
                                        [idx]: {
                                          ...prev[idx],
                                          threadParts: prev[idx].threadParts.map((tp, j) =>
                                            j === tIdx ? nextValue : tp
                                          ),
                                          text: prev[idx].threadParts
                                            .map((tp, j) => (j === tIdx ? nextValue : tp))
                                            .join('---'),
                                        }
                                      }));
                                    }}
                                    rows={4}
                                  />
                                  <div className="flex flex-col space-y-2 mt-1">
                                    <div className="flex items-center space-x-2">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={e => handleImageUpload(Number(idx), tIdx, e.target.files)}
                                        disabled={loading}
                                        className="text-sm"
                                      />
                                      <span className="text-xs text-gray-500">
                                        {output.images[tIdx] && Array.isArray(output.images[tIdx]) 
                                          ? `${output.images[tIdx].length} image${output.images[tIdx].length > 1 ? 's' : ''}`
                                          : 'No images'}
                                      </span>
                                    </div>
                                    {output.images[tIdx] && Array.isArray(output.images[tIdx]) && (
                                      <div className="flex flex-wrap gap-2">
                                        {output.images[tIdx].map((img, imgIdx) => (
                                          <div key={imgIdx} className="relative group">
                                            <img
                                              src={URL.createObjectURL(img)}
                                              alt={`preview ${imgIdx + 1}`}
                                              className="h-20 w-20 object-cover rounded border cursor-pointer hover:opacity-75 transition"
                                              onClick={() => setImageModal({ open: true, src: URL.createObjectURL(img) })}
                                            />
                                            <button
                                              onClick={() => removeImage(Number(idx), tIdx, imgIdx)}
                                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                                            >
                                              x
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-start gap-2 p-2">
                              <RichTextTextarea
                                className="border rounded px-3 py-3 text-base max-w-full min-w-0 min-h-[90px] max-h-[300px] focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition overflow-auto"
                                style={{ width: '100%', fontSize: '1.05rem' }}
                                value={output.text}
                                onChange={(nextValue) => updateText(Number(idx), nextValue)}
                                rows={Math.max(4, output.text.split('\n').length)}
                              />
                              <div className="flex flex-col space-y-2 mt-1">
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={e => handleImageUpload(Number(idx), 0, e.target.files)}
                                    disabled={loading}
                                    className="text-sm"
                                  />
                                  <span className="text-xs text-gray-500">
                                    {output.images[0] && Array.isArray(output.images[0]) 
                                      ? `${output.images[0].length} image${output.images[0].length > 1 ? 's' : ''}`
                                      : 'No images'}
                                  </span>
                                </div>
                                {output.images[0] && Array.isArray(output.images[0]) && (
                                  <div className="flex flex-wrap gap-2">
                                    {output.images[0].map((img, imgIdx) => (
                                      <div key={imgIdx} className="relative group">
                                        <img
                                          src={URL.createObjectURL(img)}
                                          alt={`preview ${imgIdx + 1}`}
                                          className="h-20 w-20 object-cover rounded border cursor-pointer hover:opacity-75 transition"
                                          onClick={() => setImageModal({ open: true, src: URL.createObjectURL(img) })}
                                        />
                                        <button
                                          onClick={() => removeImage(Number(idx), 0, imgIdx)}
                                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                                        >
                                          x
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Collapsible>
                      )}
                      {/* Discard button */}
                      <div className="flex justify-end mt-2">
                        <button
                          className="btn btn-danger px-3 py-1 rounded text-xs font-semibold"
                          onClick={() => handleDiscard(Number(idx))}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
            </Masonry>
            {/* Image Modal for full preview */}
            {imageModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70" onClick={() => setImageModal({ open: false, src: null })}>
                <div className="relative max-w-3xl w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
                  <img src={imageModal.src} alt="Full preview" className="max-h-[80vh] max-w-full rounded shadow-lg border-4 border-white" />
                  <button className="mt-4 px-6 py-2 bg-white text-black rounded shadow font-semibold" onClick={() => setImageModal({ open: false, src: null })}>Close</button>
                </div>
              </div>
            )}
          </>
        </>
      )}
      </div>
      
    </div>
  );
};

export default BulkGeneration;
