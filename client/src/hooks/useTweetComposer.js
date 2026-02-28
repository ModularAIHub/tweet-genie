import { useState, useEffect, useRef } from 'react';
import { tweets, twitter, ai, imageGeneration, scheduling, media } from '../utils/api';
import { loadDraft, saveDraft, clearDraft } from '../utils/draftStorage';
import { 
  sanitizeUserInput, 
  sanitizeAIContent, 
  validateTweetContent, 
  sanitizeImagePrompt,
  validateFileUpload 
} from '../utils/sanitization';
import toast from 'react-hot-toast';

// â”€â”€ Character limit constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const DEFAULT_CHAR_LIMIT = 280;
export const PREMIUM_CHAR_LIMIT = 2000;

// Utility function to calculate base64 image size in bytes
const getBase64Size = (base64String) => {
  const base64Data = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
  return (base64Data.length * 3) / 4;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_CROSSPOST_MEDIA_ITEMS = 4;
const MAX_CROSSPOST_MEDIA_TOTAL_BYTES = 6 * 1024 * 1024;
const COMPOSE_DRAFT_STORAGE_KEY = 'tweetComposerDraft';
const COMPOSE_DRAFT_VERSION = 1;
const COMPOSE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ALLOWED_AI_STYLES = ['casual', 'professional', 'humorous', 'inspirational', 'informative'];
const ACCOUNT_SCOPE_CHANGED_EVENT = 'suitegenie:account-scope-changed';
const TEAM_CONTEXT_STORAGE_KEY = 'activeTeamContext';

// Use a generous ceiling for draft restore â€” actual limit enforced by setters at runtime
const DRAFT_RESTORE_MAX_CHARS = PREMIUM_CHAR_LIMIT;

const normalizeComposeDraftTweets = (tweets = []) => {
  if (!Array.isArray(tweets) || tweets.length === 0) return [''];
  const cleaned = tweets
    .map((tweet) => String(tweet || ''))
    .map((tweet) => (tweet === '---' ? tweet : tweet.slice(0, DRAFT_RESTORE_MAX_CHARS)))
    .slice(0, 10);

  return cleaned.length > 0 ? cleaned : [''];
};

const hasMeaningfulComposeDraft = (draft = {}) => {
  const threadTweets = Array.isArray(draft.threadTweets) ? draft.threadTweets : [];
  const hasThreadText = threadTweets.some((tweet) => {
    const value = String(tweet || '').trim();
    return value && value !== '---';
  });

  return Boolean(
    String(draft.content || '').trim() ||
      hasThreadText ||
      Boolean(draft.isThread) ||
      String(draft.scheduledFor || '').trim() ||
      String(draft.aiPrompt || '').trim() ||
      String(draft.imagePrompt || '').trim() ||
      Boolean(draft.showAIPrompt) ||
      Boolean(draft.showImagePrompt)
  );
};

const getCachedSelectedTwitterAccount = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  const raw = localStorage.getItem('selectedTwitterAccount');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;

    const teamContextRaw = localStorage.getItem('activeTeamContext');
    if (teamContextRaw) {
      try {
        const teamContext = JSON.parse(teamContextRaw);
        const hasTeamMembershipContext = Boolean(teamContext?.team_id || teamContext?.teamId);
        const accountTeamId = parsed?.team_id || parsed?.teamId || null;
        if (hasTeamMembershipContext && !accountTeamId) {
          return null;
        }
      } catch {
        // Ignore malformed team context and continue with cached account.
      }
    }

    return parsed;
  } catch {
    return null;
  }
};

const normalizeCachedTwitterAccount = (account = null) => {
  if (!account?.id) return null;

  const teamId = account?.team_id || account?.teamId || null;
  return {
    ...account,
    id: account.id,
    team_id: teamId,
    username: account.username || account.account_username || null,
    display_name: account.display_name || account.account_display_name || null,
    account_username: account.account_username || account.username || null,
    account_display_name: account.account_display_name || account.display_name || null,
  };
};

const hasActiveTeamContext = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  const raw = localStorage.getItem(TEAM_CONTEXT_STORAGE_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.team_id || parsed?.teamId);
  } catch {
    return false;
  }
};

const normalizeIdeaPrompt = (prompt) =>
  prompt
    .replace(/^question\s*tweet\s*:\s*/i, '')
    .replace(/^tweet\s*idea\s*:\s*/i, '')
    .replace(/^idea\s*:\s*/i, '')
    .replace(/^prompt\s*:\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

const parseStrategyPromptDetails = (prompt = '') => {
  const raw = String(prompt || '').replace(/\r\n/g, '\n').trim();
  if (!raw) {
    return { idea: '', instruction: '' };
  }

  const instructionMatch = raw.match(/\bInstruction:\s*/i);
  if (!instructionMatch || typeof instructionMatch.index !== 'number') {
    return { idea: normalizeIdeaPrompt(raw), instruction: '' };
  }

  const ideaPart = raw.slice(0, instructionMatch.index).replace(/\s+/g, ' ').trim();
  const instructionPart = raw
    .slice(instructionMatch.index + instructionMatch[0].length)
    .replace(/\s+/g, ' ')
    .trim();

  return {
    idea: normalizeIdeaPrompt(ideaPart || raw),
    instruction: instructionPart,
  };
};

// â”€â”€ charLimit-aware AI prompt builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const buildSingleTweetAIPrompt = (rawPrompt, charLimit = DEFAULT_CHAR_LIMIT) => {
  const { idea, instruction } = parseStrategyPromptDetails(rawPrompt);
  const safeIdea = idea || normalizeIdeaPrompt(String(rawPrompt || ''));

  // Leave ~20 char headroom so the LLM doesn't trim mid-word right at the boundary
  const safeLimit = Math.max(240, charLimit - 20);

  const promptLines = [
    'Create ONE original, complete tweet for X (Twitter) inspired by the idea below.',
    'Return only the final tweet text.',
    'No labels, no quotes, no preface (for example: no "Here is", no "Okay").',
    'Use a fresh hook and wording (do not copy the idea text directly).',
    `Keep it under ${safeLimit} characters.`,
    'Do not end mid-sentence or with an unfinished example.',
    `Idea: ${safeIdea}`,
  ];

  if (instruction) {
    promptLines.push(`Extra instruction: ${instruction}`);
  }

  return promptLines.join('\n');
};

const normalizePromptComparisonText = (value = '') =>
  String(value || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

const sanitizeStrategyPromptContext = (context = {}) => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null;
  }

  const normalizeText = (value, maxLength = 500) =>
    sanitizeUserInput(String(value || '').trim(), {
      maxLength,
      encodeHTML: false,
      preserveSpacing: true,
    }).replace(/\s+/g, ' ').trim();

  const normalized = {
    strategyId: context.strategyId ?? null,
    promptId: context.promptId ?? context.id ?? null,
    idea: normalizeText(context.idea, 600),
    instruction: normalizeText(context.instruction, 500),
    category: normalizeText(context.category, 120),
    recommendedFormat: normalizeText(context.recommendedFormat, 40).toLowerCase() || 'single_tweet',
    goal: normalizeText(context.goal, 160),
    hashtagsHint: normalizeText(context.hashtagsHint, 160),
    extraContext: normalizeText(context.extraContext, 2000),
  };

  if (!normalized.idea || normalized.idea.length < 5) {
    return null;
  }

  return normalized;
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const useTweetComposer = () => {
  const cachedAccount = normalizeCachedTwitterAccount(getCachedSelectedTwitterAccount());
  const [isComposeDraftHydrated, setIsComposeDraftHydrated] = useState(false);
  const hasSkippedComposeDraftAutosaveRef = useRef(false);
  const lastTokenStatusToastAtRef = useRef(0);
  const lastTokenStatusCheckAtRef = useRef(0);

  // â”€â”€ Character limit state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [charLimit, setCharLimit] = useState(DEFAULT_CHAR_LIMIT);
  const [xLongPostEnabled, setXLongPostEnabled] = useState(false);

  // State
  const [content, setContentState] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [twitterAccounts, setTwitterAccounts] = useState(() => (cachedAccount ? [cachedAccount] : []));
  const [isLoadingTwitterAccounts, setIsLoadingTwitterAccounts] = useState(() => !cachedAccount);
  const [threadTweets, setThreadTweetsState] = useState(['']);
  const [threadImages, setThreadImages] = useState([]);
  const [isThread, setIsThread] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAiPromptState] = useState('');
  const [strategyPromptContext, setStrategyPromptContextState] = useState(null);
  const [strategyPromptSeedText, setStrategyPromptSeedTextState] = useState('');
  const [aiStyle, setAiStyle] = useState('casual');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imagePrompt, setImagePromptState] = useState('');
  const [imageStyle, setImageStyle] = useState('natural');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [scheduledTweets, setScheduledTweets] = useState([]);
  const [isLoadingScheduled, setIsLoadingScheduled] = useState(false);

  // â”€â”€ Fetch posting preferences for the selected account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchPostingPreferences = async () => {
    try {
      const res = await fetch('/api/twitter/posting-preferences', {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      const enabled = Boolean(data.x_long_post_enabled);
      const limit = enabled ? (Number(data.x_char_limit) || PREMIUM_CHAR_LIMIT) : DEFAULT_CHAR_LIMIT;
      setXLongPostEnabled(enabled);
      setCharLimit(limit);
    } catch {
      // Non-critical â€” fall back to 280
    }
  };

  const buildCrossPostMediaPayload = async (images = []) => {
    const sourceImages = Array.isArray(images) ? images : [];
    const payload = [];
    let totalBytes = 0;

    for (const img of sourceImages) {
      if (payload.length >= MAX_CROSSPOST_MEDIA_ITEMS) break;

      let dataUrl = '';
      if (img?.isAIGenerated && typeof img?.preview === 'string' && img.preview.startsWith('data:image/')) {
        dataUrl = img.preview;
      } else if (img?.file) {
        const encoded = await fileToBase64(img.file);
        dataUrl = typeof encoded === 'string' ? encoded : '';
      } else if (typeof img?.preview === 'string' && img.preview.startsWith('data:image/')) {
        dataUrl = img.preview;
      }

      if (!dataUrl || !dataUrl.startsWith('data:image/')) continue;

      const nextBytes = getBase64Size(dataUrl);
      if (!Number.isFinite(nextBytes) || nextBytes <= 0) continue;
      if (totalBytes + nextBytes > MAX_CROSSPOST_MEDIA_TOTAL_BYTES) break;

      payload.push(dataUrl);
      totalBytes += nextBytes;
    }

    return payload;
  };

    // Helper to determine the effective char limit depending on thread mode
    const getEffectiveCharLimit = () => (isThread ? DEFAULT_CHAR_LIMIT : Math.max(charLimit, DEFAULT_CHAR_LIMIT));

    // â”€â”€ Sanitized setters â€” all respect effective char limit for single tweets
    const setContent = (value) => {
      const ceiling = getEffectiveCharLimit();
      let cleaned = value.length > ceiling ? value.substring(0, ceiling) : value;
      // Remove em-dash and en-dash characters from user input
      cleaned = cleaned.replace(/[â€”â€“]/g, '');
      setContentState(cleaned);
    };

  const setAiPrompt = (value) => {
    const cleaned = value.length > 2000 ? value.substring(0, 2000) : value;
    setAiPromptState(cleaned);
  };

  const setStrategyPromptContext = (value) => {
    setStrategyPromptContextState(sanitizeStrategyPromptContext(value));
  };

  const clearStrategyPromptContext = () => {
    setStrategyPromptContextState(null);
    setStrategyPromptSeedTextState('');
  };

  const setStrategyPromptSeedText = (value) => {
    setStrategyPromptSeedTextState(String(value || '').slice(0, 4000));
  };

  const setImagePrompt = (value) => {
    const cleaned = value.length > 1000 ? value.substring(0, 1000) : value;
    setImagePromptState(cleaned);
  };

  const setThreadTweets = (tweets) => {
    const ceiling = DEFAULT_CHAR_LIMIT;
    const cleanedTweets = tweets.map((tweet) =>
      tweet === '---'
        ? tweet
        : (() => {
            let t = tweet.length > ceiling ? tweet.substring(0, ceiling) : tweet;
            return t.replace(/[â€”â€“]/g, '');
          })()
    );
    setThreadTweetsState(cleanedTweets);

    setThreadImages((prev) => {
      const newImages = [...prev];
      while (newImages.length < cleanedTweets.length) {
        newImages.push([]);
      }
      return newImages.slice(0, cleanedTweets.length);
    });
  };

  // Initialize
  useEffect(() => {
    fetchTwitterAccounts();
    fetchPostingPreferences();

    return () => {
      selectedImages.forEach((img) => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      threadImages.forEach((tweetImages) => {
        tweetImages.forEach((img) => {
          if (img.preview && img.preview.startsWith('blob:')) {
            URL.revokeObjectURL(img.preview);
          }
        });
      });
    };
  }, []);

  useEffect(() => {
    const handleScopeChanged = () => {
      fetchTwitterAccounts();
    };

    window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleScopeChanged);
    return () => {
      window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleScopeChanged);
    };
  }, []);

  useEffect(() => {
    const runSilentTokenCheck = () => {
      checkTwitterPostingTokenStatus({ silent: true }).catch(() => {});
    };

    runSilentTokenCheck();

    const handleFocus = () => {
      runSilentTokenCheck();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runSilentTokenCheck();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const loaded = loadDraft(COMPOSE_DRAFT_STORAGE_KEY, {
      version: COMPOSE_DRAFT_VERSION,
      ttlMs: COMPOSE_DRAFT_TTL_MS,
    });

    const draft = loaded?.data;
    if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
      if (typeof draft.content === 'string') {
        setContentState(draft.content); // use raw setter here â€” charLimit not fetched yet
      }

      const restoredThreadTweets = normalizeComposeDraftTweets(draft.threadTweets);
      setThreadTweetsState(restoredThreadTweets);
      setThreadImages(Array(restoredThreadTweets.length).fill([]));

      if (typeof draft.isThread === 'boolean') {
        setIsThread(draft.isThread);
      }

      if (typeof draft.scheduledFor === 'string') {
        setScheduledFor(draft.scheduledFor.slice(0, 64));
      }

      if (typeof draft.showAIPrompt === 'boolean') {
        setShowAIPrompt(draft.showAIPrompt);
      }

      if (typeof draft.aiPrompt === 'string') {
        setAiPrompt(draft.aiPrompt);
      }

      if (draft.strategyPromptContext) {
        setStrategyPromptContext(draft.strategyPromptContext);
      }

      if (typeof draft.strategyPromptSeedText === 'string') {
        setStrategyPromptSeedText(draft.strategyPromptSeedText);
      }

      if (typeof draft.aiStyle === 'string' && ALLOWED_AI_STYLES.includes(draft.aiStyle)) {
        setAiStyle(draft.aiStyle);
      }

      if (typeof draft.showImagePrompt === 'boolean') {
        setShowImagePrompt(draft.showImagePrompt);
      }

      if (typeof draft.imagePrompt === 'string') {
        setImagePrompt(draft.imagePrompt);
      }

      if (typeof draft.imageStyle === 'string' && draft.imageStyle.trim()) {
        setImageStyle(draft.imageStyle.trim().slice(0, 40));
      }
    }

    setIsComposeDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!isComposeDraftHydrated) return;

    if (!hasSkippedComposeDraftAutosaveRef.current) {
      hasSkippedComposeDraftAutosaveRef.current = true;
      return;
    }

    const draftPayload = {
      content: String(content || ''),
      threadTweets: normalizeComposeDraftTweets(threadTweets),
      isThread: Boolean(isThread),
      scheduledFor: String(scheduledFor || '').slice(0, 64),
      showAIPrompt: Boolean(showAIPrompt),
      aiPrompt: String(aiPrompt || '').slice(0, 2000),
      strategyPromptContext: strategyPromptContext ? sanitizeStrategyPromptContext(strategyPromptContext) : null,
      strategyPromptSeedText: String(strategyPromptSeedText || '').slice(0, 4000),
      aiStyle: ALLOWED_AI_STYLES.includes(aiStyle) ? aiStyle : 'casual',
      showImagePrompt: Boolean(showImagePrompt),
      imagePrompt: String(imagePrompt || '').slice(0, 1000),
      imageStyle: String(imageStyle || 'natural').slice(0, 40),
    };

    const timeoutId = setTimeout(() => {
      if (!hasMeaningfulComposeDraft(draftPayload)) {
        clearDraft(COMPOSE_DRAFT_STORAGE_KEY);
        return;
      }

      saveDraft(COMPOSE_DRAFT_STORAGE_KEY, draftPayload, { version: COMPOSE_DRAFT_VERSION });
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    isComposeDraftHydrated,
    content,
    threadTweets,
    isThread,
    scheduledFor,
    showAIPrompt,
    aiPrompt,
    strategyPromptContext,
    strategyPromptSeedText,
    aiStyle,
    showImagePrompt,
    imagePrompt,
    imageStyle,
  ]);

  // Computed values
  const characterCount = isThread
    ? threadTweets.reduce((total, tweet) => total + tweet.length, 0)
    : content.length;

  // Effective char limit: threads always use DEFAULT_CHAR_LIMIT, single tweets use user's charLimit (min DEFAULT_CHAR_LIMIT)
  const effectiveCharLimit = isThread ? DEFAULT_CHAR_LIMIT : Math.max(charLimit, DEFAULT_CHAR_LIMIT);

  const persistSelectedTwitterAccount = (accounts) => {
    if (!Array.isArray(accounts) || accounts.length === 0) {
      localStorage.removeItem('selectedTwitterAccount');
      return;
    }

    const saved = getCachedSelectedTwitterAccount();
    const preferred = saved ? accounts.find((acc) => acc.id === saved.id) : null;
    const selected = preferred || accounts[0];

    localStorage.setItem(
      'selectedTwitterAccount',
      JSON.stringify({
        id: selected.id,
        username: selected.account_username || selected.username,
        display_name: selected.account_display_name || selected.display_name,
        team_id: selected.team_id || selected.teamId || null,
      })
    );
  };

  // API Functions
  const fetchTwitterAccounts = async () => {
    const cachedSelection = normalizeCachedTwitterAccount(getCachedSelectedTwitterAccount());
    let personalAccounts = [];
    let mergedAccounts = [];

    try {
      if (twitterAccounts.length === 0) {
        setIsLoadingTwitterAccounts(true);
      }

      try {
        const personalRes = await twitter.getStatus({ _skipAccountScope: true });
        personalAccounts = Array.isArray(personalRes?.data?.accounts) ? personalRes.data.accounts : [];
        mergedAccounts = hasActiveTeamContext() ? [] : [...personalAccounts];

        if (personalAccounts.length > 0) {
          if (!hasActiveTeamContext()) {
            setTwitterAccounts(personalAccounts);
            persistSelectedTwitterAccount(personalAccounts);
            setIsLoadingTwitterAccounts(false);
          }
        }
      } catch (personalError) {
        console.error('Error fetching personal Twitter accounts:', personalError);
      }

      try {
        const teamRes = await twitter.getTeamAccounts({ _skipAccountScope: true });
        const responseTeamId = teamRes?.data?.team_id || teamRes?.data?.teamId || null;
        const rawTeamAccounts = Array.isArray(teamRes?.data?.accounts) ? teamRes.data.accounts : [];
        const teamAccounts = rawTeamAccounts.map((account) => ({
          ...account,
          team_id: account?.team_id || account?.teamId || responseTeamId || null,
        }));
        mergedAccounts = hasActiveTeamContext() ? teamAccounts : [...personalAccounts, ...teamAccounts];
      } catch (teamError) {
        console.warn('Team Twitter accounts unavailable:', teamError?.response?.status || teamError?.message || teamError);
        mergedAccounts = hasActiveTeamContext() ? [] : [...personalAccounts];
      }

      setTwitterAccounts(mergedAccounts);

      if (mergedAccounts.length > 0) {
        persistSelectedTwitterAccount(mergedAccounts);
      } else if (cachedSelection) {
        setTwitterAccounts([cachedSelection]);
      } else {
        localStorage.removeItem('selectedTwitterAccount');
      }
    } catch (error) {
      console.error('Error fetching Twitter accounts:', error);
      if (cachedSelection) {
        setTwitterAccounts([cachedSelection]);
      } else {
        setTwitterAccounts([]);
        localStorage.removeItem('selectedTwitterAccount');
      }
    } finally {
      setIsLoadingTwitterAccounts(false);
    }
  };

  const fetchScheduledTweets = async () => {
    try {
      setIsLoadingScheduled(true);
      const response = await scheduling.list();
      const tweets = response.data?.scheduled_tweets || [];
      setScheduledTweets(Array.isArray(tweets) ? tweets : []);
    } catch (error) {
      console.error('Error fetching scheduled tweets:', error);
      setScheduledTweets([]);
    } finally {
      setIsLoadingScheduled(false);
    }
  };

  const checkTwitterPostingTokenStatus = async ({ silent = true, force = false } = {}) => {
    const now = Date.now();
    if (!force && now - lastTokenStatusCheckAtRef.current < 15_000) {
      return { ok: true, skipped: true };
    }

    lastTokenStatusCheckAtRef.current = now;

    try {
      const response = await twitter.getTokenStatus();
      const status = response?.data || {};

      if (status?.requiresTeamAccountSelection) {
        return { ok: true, status };
      }

      const unusable = status?.postingReady === false || status?.connected === false;
      if (unusable) {
        if (!silent || now - lastTokenStatusToastAtRef.current > 20_000) {
          lastTokenStatusToastAtRef.current = now;
          const message =
            status?.mediaReady === false
              ? 'Twitter media permissions are not usable right now. Please reconnect your account before posting images.'
              : status?.isExpired
                ? 'Twitter token expired and auto-refresh could not restore posting. Please reconnect your account before posting.'
                : 'Twitter connection is not usable right now. Please reconnect your account.';
          toast.error(message, { duration: 5000 });
        }

        return { ok: false, status };
      }

      if (!silent && status?.needsRefresh) {
        toast('Twitter token is expiring soon. We will try to refresh it automatically.', { icon: 'â„¹ï¸' });
      }

      return { ok: true, status };
    } catch (error) {
      if (!silent) {
        console.warn('Twitter token preflight check failed:', error);
      }
      return { ok: true, error };
    }
  };

  // Handlers
  const handleImageUpload = (event) => {
    const files = Array.from(event.target.files);
    const validFiles = [];

    for (const file of files) {
      const validation = validateFileUpload(file);

      if (!validation.isValid) {
        validation.errors.forEach((error) => toast.error(error));
        continue;
      }

      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) => toast.info(warning, { icon: 'âš ï¸' }));
      }

      const isValidType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
      const isValidSize = file.size <= MAX_IMAGE_SIZE;

      if (!isValidType) {
        toast.error(`${file.name} is not a valid image type`);
        continue;
      }
      if (!isValidSize) {
        toast.error(`${file.name} is too large (max 5MB)`);
        continue;
      }

      validFiles.push(file);
    }

    if (selectedImages.length + validFiles.length > 4) {
      toast.error('Maximum 4 images allowed per tweet');
      return;
    }

    const newImages = validFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9),
    }));

    setSelectedImages((prev) => [...prev, ...newImages]);
  };

  const handleImageRemove = (index) => {
    const imageToRemove = selectedImages[index];
    if (imageToRemove.preview && imageToRemove.preview.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.preview);
    }
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const normalizeCrossPostInput = (crossPostInput = false) => {
    if (crossPostInput && typeof crossPostInput === 'object' && !Array.isArray(crossPostInput)) {
      const rawIds =
        crossPostInput.crossPostTargetAccountIds &&
        typeof crossPostInput.crossPostTargetAccountIds === 'object' &&
        !Array.isArray(crossPostInput.crossPostTargetAccountIds)
          ? crossPostInput.crossPostTargetAccountIds
          : {};
      const rawLabels =
        crossPostInput.crossPostTargetAccountLabels &&
        typeof crossPostInput.crossPostTargetAccountLabels === 'object' &&
        !Array.isArray(crossPostInput.crossPostTargetAccountLabels)
          ? crossPostInput.crossPostTargetAccountLabels
          : {};

      const normalizedIds = {};
      const normalizedLabels = {};
      ['linkedin', 'threads', 'twitter'].forEach((platform) => {
        const idValue = rawIds[platform];
        const labelValue = rawLabels[platform];
        const normalizedId = idValue === undefined || idValue === null ? '' : String(idValue).trim();
        const normalizedLabel = labelValue === undefined || labelValue === null ? '' : String(labelValue).trim();
        if (normalizedId) normalizedIds[platform] = normalizedId;
        if (normalizedLabel) normalizedLabels[platform] = normalizedLabel;
      });

      return {
        linkedin: Boolean(crossPostInput.linkedin),
        threads: Boolean(crossPostInput.threads),
        twitter: Boolean(crossPostInput.twitter),
        optimizeCrossPost: crossPostInput.optimizeCrossPost !== false,
        crossPostTargetAccountIds: normalizedIds,
        crossPostTargetAccountLabels: normalizedLabels,
      };
    }

    return {
      linkedin: Boolean(crossPostInput),
      threads: false,
      twitter: false,
      optimizeCrossPost: true,
      crossPostTargetAccountIds: {},
      crossPostTargetAccountLabels: {},
    };
  };

  const handlePost = async (crossPostInput = false) => {
    const normalizedCrossPost = normalizeCrossPostInput(crossPostInput);
    const hasAnyCrossPostTarget =
      normalizedCrossPost.linkedin || normalizedCrossPost.threads || normalizedCrossPost.twitter;

    if (isThread) {
      const validTweets = threadTweets.filter((tweet) => tweet.trim().length > 0 && tweet !== '---');
      for (let i = 0; i < validTweets.length; i++) {
        const validation = validateTweetContent(validTweets[i]);
        if (!validation.isValid) {
          toast.error(`Tweet ${i + 1}: ${validation.errors.join(', ')}`);
          return;
        }
        if (validation.warnings.length > 0) {
          validation.warnings.forEach((warning) => toast.info(`Tweet ${i + 1}: ${warning}`, { icon: 'âš ï¸' }));
        }
      }
      if (validTweets.length === 0 && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    } else {
      const validation = validateTweetContent(content);
      if (!validation.isValid) {
        toast.error(validation.errors.join(', '));
        return;
      }
      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) => toast.info(warning, { icon: 'âš ï¸' }));
      }
      if (!content.trim() && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    }

    const tokenPreflight = await checkTwitterPostingTokenStatus({ silent: false, force: true });
    if (!tokenPreflight.ok) {
      setTimeout(() => {
        window.location.href = '/settings';
      }, 1000);
      return;
    }

    setIsPosting(true);
    try {
      const crossPostMediaPayload = hasAnyCrossPostTarget
        ? await buildCrossPostMediaPayload(isThread ? (threadImages[0] || []) : selectedImages)
        : [];
      const crossPostRequestFields = {
        ...(normalizedCrossPost.linkedin && { postToLinkedin: true }),
        ...(hasAnyCrossPostTarget && {
          crossPostTargets: {
            linkedin: normalizedCrossPost.linkedin,
            threads: normalizedCrossPost.threads,
            twitter: normalizedCrossPost.twitter,
          },
          ...(Object.keys(normalizedCrossPost.crossPostTargetAccountIds || {}).length > 0 && {
            crossPostTargetAccountIds: normalizedCrossPost.crossPostTargetAccountIds,
          }),
          ...(Object.keys(normalizedCrossPost.crossPostTargetAccountLabels || {}).length > 0 && {
            crossPostTargetAccountLabels: normalizedCrossPost.crossPostTargetAccountLabels,
          }),
          optimizeCrossPost: normalizedCrossPost.optimizeCrossPost,
        }),
        ...(crossPostMediaPayload.length > 0 && { crossPostMedia: crossPostMediaPayload }),
      };

      const showPostResultToast = ({ response, isThreadPost, validTweetsCount = 1 }) => {
        const baseSuccessMessage = isThreadPost
          ? `Thread with ${validTweetsCount} tweets posted successfully!`
          : 'Tweet posted successfully!';

        const crossPost = response?.data?.crossPost;
        if (crossPost && typeof crossPost === 'object') {
          const selectedPlatforms = [];
          if (normalizedCrossPost.linkedin) {
            selectedPlatforms.push({ label: 'LinkedIn', result: crossPost.linkedin || null });
          }
          if (normalizedCrossPost.threads) {
            selectedPlatforms.push({ label: 'Threads', result: crossPost.threads || null });
          }
          if (normalizedCrossPost.twitter) {
            selectedPlatforms.push({ label: 'X', result: crossPost.twitter || null });
          }

          if (selectedPlatforms.length === 0) {
            toast.success(baseSuccessMessage);
            return;
          }

          const successful = [];
          const issues = [];
          let mediaFallbackShown = false;

          for (const platform of selectedPlatforms) {
            const status = String(platform?.result?.status || '').trim();
            if (status === 'posted') {
              successful.push(platform.label);
              if (platform?.result?.mediaDetected && platform?.result?.mediaStatus === 'text_only_phase1') {
                mediaFallbackShown = true;
              }
              continue;
            }

            const statusMessages = {
                not_connected: `${platform.label} not connected â€” post was created on X.`,
                target_not_found: `${platform.label} target account not found â€” post was created on X.`,
                permission_revoked: `${platform.label} target permission denied â€” post was created on X.`,
                missing_target_route: `${platform.label} target selection missing â€” post was created on X.`,
                timeout: `${platform.label} cross-post timed out â€” post was created on X.`,
              skipped_not_configured: `${platform.label} cross-post is not configured yet.`,
              skipped: `${platform.label} cross-post was skipped.`,
              failed: `${platform.label} cross-post failed â€” post was created on X.`,
              disabled: null,
              '': null,
              null: null,
            };

            const issue =
              statusMessages[status] ??
              `${platform.label} cross-post did not complete (${status}). Post was created on X.`;
            if (issue) issues.push(issue);
          }

          if (successful.length > 0 && issues.length === 0) {
            toast.success(
              `${baseSuccessMessage.replace(/!$/, '')} & cross-posted to ${successful.join(' + ')}!`
            );
          } else {
            toast.success(baseSuccessMessage);
            issues.forEach((message) => toast(message, { icon: 'âš ï¸' }));
          }

          if (mediaFallbackShown) {
            toast('Images were posted to X only. Cross-posts used text-only content (Phase 1).', {
              icon: 'â„¹ï¸',
            });
          }
          return;
        }

        const linkedinStatus = response?.data?.linkedin;
        if (normalizedCrossPost.linkedin && linkedinStatus === 'posted') {
          toast.success(
            isThreadPost
              ? 'Thread posted & cross-posted to LinkedIn! âœ“'
              : 'Tweet posted & cross-posted to LinkedIn! âœ“'
          );
        } else if (normalizedCrossPost.linkedin && linkedinStatus === 'failed') {
          toast.success(baseSuccessMessage);
          toast.error('LinkedIn cross-post failed â€” post was created on X.');
        } else if (normalizedCrossPost.linkedin && linkedinStatus === 'not_connected') {
          toast.success(baseSuccessMessage);
          toast.error('LinkedIn not connected â€” post was created on X only.');
        } else {
          toast.success(baseSuccessMessage);
        }
      };

      let mediaIds = [];
      if (selectedImages.length > 0) {
        const mediaFiles = [];
        for (const img of selectedImages) {
          if (img.isAIGenerated && img.preview.startsWith('data:')) {
            mediaFiles.push(img.preview);
          } else if (img.file) {
            const base64 = await fileToBase64(img.file);
            mediaFiles.push(base64);
          }
        }
        if (mediaFiles.length > 0) {
          const uploadRes = await media.upload(mediaFiles);
          if (uploadRes.data && uploadRes.data.mediaIds) {
            mediaIds = uploadRes.data.mediaIds;
          } else {
            throw new Error('Failed to upload images to Twitter');
          }
        }
      }

      let threadMedia = [];
      if (isThread) {
        for (let i = 0; i < threadTweets.length; i++) {
          const tweet = threadTweets[i];
          if (tweet.trim().length > 0 && tweet !== '---') {
            const tweetImages = threadImages[i] || [];
            if (tweetImages.length > 0) {
              const tweetMediaFiles = [];
              for (const img of tweetImages) {
                if (img.isAIGenerated && img.preview.startsWith('data:')) {
                  tweetMediaFiles.push(img.preview);
                } else if (img.file) {
                  const base64 = await fileToBase64(img.file);
                  tweetMediaFiles.push(base64);
                }
              }
              if (tweetMediaFiles.length > 0) {
                const uploadRes = await media.upload(tweetMediaFiles);
                if (uploadRes.data && uploadRes.data.mediaIds) {
                  threadMedia.push(uploadRes.data.mediaIds);
                } else {
                  throw new Error('Failed to upload thread images to Twitter');
                }
              } else {
                threadMedia.push([]);
              }
            } else {
              threadMedia.push([]);
            }
          }
        }
      }

      if (isThread) {
        const validTweets = threadTweets.filter((tweet) => tweet.trim().length > 0 && tweet !== '---');
        const response = await tweets.create({
          thread: validTweets,
          threadMedia,
          media: mediaIds.length > 0 ? mediaIds : undefined,
          ...crossPostRequestFields,
        });
        showPostResultToast({ response, isThreadPost: true, validTweetsCount: validTweets.length });
        setThreadTweets(['']);
        setThreadImages([]);
        setIsThread(false);
      } else {
        const response = await tweets.create({
          content: content.trim(),
          media: mediaIds.length > 0 ? mediaIds : undefined,
          ...crossPostRequestFields,
        });
        showPostResultToast({ response, isThreadPost: false });
        setContent('');
      }

      selectedImages.forEach((img) => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      setSelectedImages([]);

      threadImages.forEach((tweetImages) => {
        tweetImages.forEach((img) => {
          if (img.preview && img.preview.startsWith('blob:')) {
            URL.revokeObjectURL(img.preview);
          }
        });
      });
      clearDraft(COMPOSE_DRAFT_STORAGE_KEY);
    } catch (error) {
      console.error('Post tweet error:', error);

      if (error.response?.data?.code === 'TWITTER_RATE_LIMIT') {
        toast.error(
          'â° Twitter rate limit reached. Please try again in 15-30 minutes. Your credits have been refunded.',
          { duration: 8000 }
        );
        return;
      }

      if (error.response?.data?.code === 'TWITTER_TOKEN_EXPIRED') {
        toast.error('Twitter authentication expired. Please reconnect your account.');
        window.location.href = '/settings';
        return;
      }

      if (error.response?.data?.code === 'TWITTER_PERMISSIONS_ERROR') {
        toast.error('Twitter permissions expired. Please reconnect your Twitter account.', {
          duration: 6000,
        });
        setTimeout(() => {
          window.location.href = '/settings';
        }, 2000);
        return;
      }

      const errorMessage = error.response?.data?.error || 'Failed to post tweet';
      toast.error(errorMessage);
    } finally {
      setIsPosting(false);
    }
  };

  const handleSchedule = async (dateString, timezone, crossPostInput = false) => {
    const normalizedCrossPost = normalizeCrossPostInput(crossPostInput);
    const hasAnyCrossPostTarget =
      normalizedCrossPost.linkedin || normalizedCrossPost.threads || normalizedCrossPost.twitter;

    if (isThread) {
      const validTweets = threadTweets.filter((tweet) => tweet.trim().length > 0 && tweet !== '---');
      if (validTweets.length === 0) {
        toast.error('Please enter some content for the thread');
        return;
      }
    } else {
      if (!content.trim() && selectedImages.length === 0) {
        toast.error('Please enter some content or add images');
        return;
      }
    }
    if (!dateString) {
      toast.error('Please select a date and time');
      return;
    }

    setIsScheduling(true);
    try {
      const crossPostMediaPayload = hasAnyCrossPostTarget
        ? await buildCrossPostMediaPayload(isThread ? (threadImages[0] || []) : selectedImages)
        : [];
      let mediaIds = [];
      let threadMedia = [];

      if (isThread) {
        for (let i = 0; i < threadTweets.length; i++) {
          const tweet = threadTweets[i];
          if (tweet.trim().length > 0 && tweet !== '---') {
            const tweetImages = threadImages[i] || [];
            if (tweetImages.length > 0) {
              const tweetMediaFiles = [];
              for (const img of tweetImages) {
                if (img.isAIGenerated && img.preview.startsWith('data:')) {
                  tweetMediaFiles.push(img.preview);
                } else if (img.file) {
                  const base64 = await fileToBase64(img.file);
                  tweetMediaFiles.push(base64);
                }
              }
              if (tweetMediaFiles.length > 0) {
                const uploadRes = await media.upload(tweetMediaFiles);
                if (uploadRes.data && uploadRes.data.mediaIds) {
                  threadMedia.push(uploadRes.data.mediaIds);
                } else {
                  throw new Error('Failed to upload thread images to Twitter');
                }
              } else {
                threadMedia.push([]);
              }
            } else {
              threadMedia.push([]);
            }
          }
        }
      } else {
        if (selectedImages.length > 0) {
          const mediaFiles = [];
          for (const img of selectedImages) {
            if (img.isAIGenerated && img.preview.startsWith('data:')) {
              mediaFiles.push(img.preview);
            } else if (img.file) {
              const base64 = await fileToBase64(img.file);
              mediaFiles.push(base64);
            }
          }
          if (mediaFiles.length > 0) {
            const uploadRes = await media.upload(mediaFiles);
            if (uploadRes.data && uploadRes.data.mediaIds) {
              mediaIds = uploadRes.data.mediaIds;
            } else {
              throw new Error('Failed to upload images to Twitter');
            }
          }
        }
      }

      if (isThread) {
        const validTweets = threadTweets.filter((tweet) => tweet.trim().length > 0 && tweet !== '---');
        await scheduling.create({
          thread: validTweets,
          threadMedia,
          ...(normalizedCrossPost.linkedin && { postToLinkedin: true }),
          ...(hasAnyCrossPostTarget && {
            crossPostTargets: {
              linkedin: normalizedCrossPost.linkedin,
              threads: normalizedCrossPost.threads,
              twitter: normalizedCrossPost.twitter,
            },
            ...(Object.keys(normalizedCrossPost.crossPostTargetAccountIds || {}).length > 0 && {
              crossPostTargetAccountIds: normalizedCrossPost.crossPostTargetAccountIds,
            }),
            ...(Object.keys(normalizedCrossPost.crossPostTargetAccountLabels || {}).length > 0 && {
              crossPostTargetAccountLabels: normalizedCrossPost.crossPostTargetAccountLabels,
            }),
            optimizeCrossPost: normalizedCrossPost.optimizeCrossPost,
            ...(crossPostMediaPayload.length > 0 && {
              crossPostMedia: crossPostMediaPayload,
            }),
          }),
          scheduled_for: dateString,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (hasAnyCrossPostTarget) {
          const labels = [
            normalizedCrossPost.linkedin ? 'LinkedIn' : null,
            normalizedCrossPost.threads ? 'Threads' : null,
            normalizedCrossPost.twitter ? 'X' : null,
          ].filter(Boolean);
          toast.success(`Thread scheduled. Cross-post to ${labels.join(' + ')} will run at publish time.`);
        } else {
          toast.success('Thread scheduled successfully!');
        }
        setThreadTweets(['']);
        setThreadImages([]);
        setIsThread(false);
      } else {
        await scheduling.create({
          content: content.trim(),
          media: mediaIds.length > 0 ? mediaIds : undefined,
          ...(normalizedCrossPost.linkedin && { postToLinkedin: true }),
          ...(hasAnyCrossPostTarget && {
            crossPostTargets: {
              linkedin: normalizedCrossPost.linkedin,
              threads: normalizedCrossPost.threads,
              twitter: normalizedCrossPost.twitter,
            },
            ...(Object.keys(normalizedCrossPost.crossPostTargetAccountIds || {}).length > 0 && {
              crossPostTargetAccountIds: normalizedCrossPost.crossPostTargetAccountIds,
            }),
            ...(Object.keys(normalizedCrossPost.crossPostTargetAccountLabels || {}).length > 0 && {
              crossPostTargetAccountLabels: normalizedCrossPost.crossPostTargetAccountLabels,
            }),
            optimizeCrossPost: normalizedCrossPost.optimizeCrossPost,
            ...(crossPostMediaPayload.length > 0 && {
              crossPostMedia: crossPostMediaPayload,
            }),
          }),
          scheduled_for: dateString,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (hasAnyCrossPostTarget) {
          const labels = [
            normalizedCrossPost.linkedin ? 'LinkedIn' : null,
            normalizedCrossPost.threads ? 'Threads' : null,
            normalizedCrossPost.twitter ? 'X' : null,
          ].filter(Boolean);
          toast.success(
            `Tweet scheduled. Cross-post to ${labels.join(' + ')} will run at publish time.`
          );
        } else {
          toast.success('Tweet scheduled successfully!');
        }
        setContent('');
      }

      setScheduledFor('');
      selectedImages.forEach((img) => {
        if (img.preview && img.preview.startsWith('blob:')) {
          URL.revokeObjectURL(img.preview);
        }
      });
      setSelectedImages([]);
      clearDraft(COMPOSE_DRAFT_STORAGE_KEY);
      fetchScheduledTweets();
    } catch (error) {
      console.error('Schedule tweet error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to schedule tweet';
      toast.error(errorMessage);
    } finally {
      setIsScheduling(false);
    }
  };

  // â”€â”€ AI Generation â€” uses charLimit throughout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAIGenerate = async (promptOverride = null) => {
    const promptSource = typeof promptOverride === 'string' ? promptOverride : aiPrompt;
    let sanitizedPrompt = sanitizeUserInput(promptSource.trim(), {
      maxLength: 2000,
      encodeHTML: false,
    });

    if (!sanitizedPrompt) {
      toast.error('Please enter a valid prompt');
      return;
    }

    let aiRequestPrompt = sanitizedPrompt;
    let aiRequestIsThread = isThread;
    const normalizedCurrentPrompt = normalizePromptComparisonText(sanitizedPrompt);
    const normalizedSeedPrompt = normalizePromptComparisonText(strategyPromptSeedText);
    const canUseStrategyMode = Boolean(
      strategyPromptContext &&
        strategyPromptContext.idea &&
        normalizedCurrentPrompt &&
        normalizedCurrentPrompt === normalizedSeedPrompt
    );

    if (!isThread) {
      // Pass effective char limit so the LLM instruction matches the user's actual limit
      aiRequestPrompt = buildSingleTweetAIPrompt(sanitizedPrompt, getEffectiveCharLimit());
      aiRequestIsThread = false;
    }

    setIsGenerating(true);
    try {
      const aiPayload = canUseStrategyMode
        ? {
            prompt: sanitizedPrompt,
            style: aiStyle,
            isThread: aiRequestIsThread,
            generationMode: 'strategy_prompt',
            strategyPrompt: {
              ...strategyPromptContext,
              recommendedFormat: strategyPromptContext.recommendedFormat || 'single_tweet',
            },
            clientSource: 'compose',
          }
        : {
            prompt: aiRequestPrompt,
            style: aiStyle,
            isThread: aiRequestIsThread,
          };

      const response = await ai.generate(aiPayload);

      if (response.data && response.data.content) {
        const sanitizedContent = sanitizeAIContent(response.data.content, {
          maxLength: 5000,
          preserveFormatting: true,
        });

        if (!sanitizedContent || sanitizedContent.length < 10) {
          toast.error('Generated content was too short or invalid after sanitization');
          return;
        }

        if (isThread) {
          const aiTweets = splitIntoTweets(sanitizedContent, DEFAULT_CHAR_LIMIT);
          setThreadTweets(aiTweets.length > 0 ? aiTweets : [sanitizedContent]);
        } else {
          let tweet = sanitizedContent.replace(/---/g, '').replace(/^['"]+|['"]+$/g, '').trim();
          // Respect the user's effective char limit
          if (tweet.length > getEffectiveCharLimit()) tweet = tweet.substring(0, getEffectiveCharLimit());
          setContent(tweet);
        }

        setShowAIPrompt(false);
        setAiPrompt('');
        clearStrategyPromptContext();

        if (response.data.creditsUsed && response.data.threadCount) {
          toast.success(
            `Content generated successfully! Used ${response.data.creditsUsed} credits for ${response.data.threadCount} thread(s).`
          );
        } else {
          toast.success('Content generated successfully!');
        }
      } else {
        toast.error('Failed to generate content');
      }
    } catch (error) {
      console.error('AI generation error:', error);

      if (error.response?.status === 402) {
        const errorData = error.response.data;
        const threadCount = Number(errorData.threadCount || errorData.estimatedThreads || 1);
        const creditsRequired = errorData.creditsRequired ?? errorData.required ?? 0;
        const creditsAvailable = errorData.creditsAvailable ?? errorData.available ?? 0;

        if (threadCount > 1) {
          toast.error(
            `Insufficient credits: Need ${creditsRequired} credits for ${threadCount} threads. Available: ${creditsAvailable}`
          );
        } else {
          toast.error(
            `Insufficient credits: Need ${creditsRequired} credits. Available: ${creditsAvailable}`
          );
        }
      } else {
        toast.error('Failed to generate content');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // â”€â”€ Tweet splitter â€” charLimit-aware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const splitIntoTweets = (content, limit = DEFAULT_CHAR_LIMIT) => {
    const charLimit = Math.max(limit, DEFAULT_CHAR_LIMIT);

    if (content.includes('---')) {
      const tweets = content
        .split('---')
        .map((tweet) => tweet.trim())
        .filter((tweet) => tweet.length > 0);
      return tweets;
    }

    let sections = content.split(/\n\n+/).filter((s) => s.trim().length > 0);

    if (sections.length === 1) {
      sections = content.split(/\n/).filter((s) => s.trim().length > 0);
    }

    if (sections.length === 1) {
      sections = content.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    }

    const tweetParts = [];
    let currentTweet = '';

    sections.forEach((section) => {
      const trimmed = section.trim();

      if (trimmed.length > charLimit) {
        if (currentTweet.trim()) {
          tweetParts.push(currentTweet.trim());
          currentTweet = '';
        }

        const words = trimmed.split(' ');
        words.forEach((word) => {
          if (currentTweet.length + word.length + 1 <= charLimit) {
            currentTweet += (currentTweet ? ' ' : '') + word;
          } else {
            if (currentTweet.trim()) tweetParts.push(currentTweet.trim());
            currentTweet = word;
          }
        });
      } else {
        const separator =
          currentTweet && !currentTweet.endsWith('.') && !currentTweet.endsWith('!') && !currentTweet.endsWith('?')
            ? '. '
            : currentTweet
            ? ' '
            : '';

        if (currentTweet.length + separator.length + trimmed.length <= charLimit) {
          currentTweet += separator + trimmed;
        } else {
          if (currentTweet.trim()) tweetParts.push(currentTweet.trim());
          currentTweet = trimmed;
        }
      }
    });

    if (currentTweet.trim()) {
      tweetParts.push(currentTweet.trim());
    }

    if (tweetParts.length === 0 && content.trim()) {
      tweetParts.push(content.trim().substring(0, charLimit));
    }

    return tweetParts;
  };

  const handleImageGenerate = async () => {
    const sanitizedPrompt = sanitizeImagePrompt(imagePrompt.trim());

    if (!sanitizedPrompt) {
      toast.error('Please enter a valid image description');
      return;
    }

    if (sanitizedPrompt.includes('[FILTERED]')) {
      toast.error('Some content was filtered from your prompt for safety reasons');
      // Abort: do not call image generation with a filtered prompt
      return;
    }

    setIsGeneratingImage(true);
    try {
      const response = await imageGeneration.generate(sanitizedPrompt, imageStyle);

      if (response.data && response.data.success && response.data.imageUrl) {
        const imageSize = getBase64Size(response.data.imageUrl);

        if (imageSize > MAX_IMAGE_SIZE) {
          toast.error(
            `Generated image is too large (${(imageSize / (1024 * 1024)).toFixed(1)}MB). Max allowed is 5MB. Please try a different prompt.`
          );
          return;
        }

        const newImage = {
          file: null,
          preview: response.data.imageUrl,
          id: Math.random().toString(36).substr(2, 9),
          isAIGenerated: true,
          prompt: sanitizedPrompt,
          provider: response.data.provider || 'AI',
        };

        setSelectedImages((prev) => [...prev, newImage]);
        setShowImagePrompt(false);
        setImagePrompt('');
        toast.success('Image generated successfully!');
      } else {
        toast.error('Failed to generate image - invalid response');
      }
    } catch (error) {
      console.error('Image generation error:', error);

      if (error.code === 'ECONNABORTED') {
        toast.error('Image generation timed out. Please try again.');
      } else if (error.response?.status === 413) {
        toast.error('Generated image is too large. Please try again.');
      } else if (error.response?.status === 500) {
        toast.error('Server error during image generation. Please try again.');
      } else {
        toast.error(`Failed to generate image: ${error.message}`);
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleCancelScheduled = async (tweetId) => {
    try {
      await scheduling.cancel(tweetId);
      toast.success('Scheduled tweet cancelled');
      fetchScheduledTweets();
    } catch (error) {
      console.error('Cancel scheduled tweet error:', error);
      toast.error('Failed to cancel scheduled tweet');
    }
  };

  const handleThreadTweetChange = (index, value) => {
    const ceiling = DEFAULT_CHAR_LIMIT;
    const sanitizedValue =
      value === '---'
        ? value
        : sanitizeUserInput(value, {
            maxLength: ceiling,
            encodeHTML: false,
          });
    const newTweets = [...threadTweets];
    newTweets[index] = sanitizedValue;
    setThreadTweets(newTweets);
  };

  const handleThreadImageUpload = (threadIndex, event) => {
    const files = Array.from(event.target.files);
    const validFiles = [];

    for (const file of files) {
      const validation = validateFileUpload(file);

      if (!validation.isValid) {
        validation.errors.forEach((error) => toast.error(error));
        continue;
      }

      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) => toast.info(warning, { icon: 'âš ï¸' }));
      }

      const isValidType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
      const isValidSize = file.size <= MAX_IMAGE_SIZE;

      if (!isValidType) {
        toast.error(`${file.name} is not a valid image type`);
        continue;
      }
      if (!isValidSize) {
        toast.error(`${file.name} is too large (max 5MB)`);
        continue;
      }

      validFiles.push(file);
    }

    const currentImagesForThread = threadImages[threadIndex] || [];
    if (currentImagesForThread.length + validFiles.length > 4) {
      toast.error('Maximum 4 images allowed per tweet');
      return;
    }

    const newImages = validFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9),
    }));

    setThreadImages((prev) => {
      const updated = [...prev];
      if (!updated[threadIndex]) {
        updated[threadIndex] = [];
      }
      updated[threadIndex] = [...updated[threadIndex], ...newImages];
      return updated;
    });

    event.target.value = '';
  };

  const handleThreadImageRemove = (threadIndex, imageIndex) => {
    setThreadImages((prev) => {
      const updated = [...prev];
      if (updated[threadIndex]) {
        const imageToRemove = updated[threadIndex][imageIndex];
        if (imageToRemove.preview && imageToRemove.preview.startsWith('blob:')) {
          URL.revokeObjectURL(imageToRemove.preview);
        }
        updated[threadIndex] = updated[threadIndex].filter((_, i) => i !== imageIndex);
      }
      return updated;
    });
  };

  const handleAddTweet = () => {
    if (threadTweets.length < 10) {
      setThreadTweets([...threadTweets, '']);
    }
  };

  const handleRemoveTweet = (index) => {
    if (threadTweets.length > 1) {
      if (threadImages[index]) {
        threadImages[index].forEach((img) => {
          if (img.preview && img.preview.startsWith('blob:')) {
            URL.revokeObjectURL(img.preview);
          }
        });
      }
      setThreadTweets(threadTweets.filter((_, i) => i !== index));
      setThreadImages((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleAIButtonClick = () => {
    setShowAIPrompt(!showAIPrompt);
    if (showImagePrompt) setShowImagePrompt(false);
  };

  const handleImageButtonClick = () => {
    setShowImagePrompt(!showImagePrompt);
    if (showAIPrompt) setShowAIPrompt(false);
  };

  return {
    // State
    content,
    setContent,
    isPosting,
    isScheduling,
    scheduledFor,
    setScheduledFor,
    twitterAccounts,
    isLoadingTwitterAccounts,
    threadTweets,
    threadImages,
    isThread,
    setIsThread,
    showAIPrompt,
    aiPrompt,
    setAiPrompt,
    strategyPromptContext,
    setStrategyPromptContext,
    clearStrategyPromptContext,
    strategyPromptSeedText,
    setStrategyPromptSeedText,
    aiStyle,
    setAiStyle,
    isGenerating,
    showImagePrompt,
    imagePrompt,
    setImagePrompt,
    imageStyle,
    setImageStyle,
    isGeneratingImage,
    selectedImages,
    isUploadingImages,
    scheduledTweets,
    isLoadingScheduled,
    characterCount,
    // â”€â”€ New exports â”€â”€
    charLimit,
    effectiveCharLimit,
    xLongPostEnabled,
    fetchPostingPreferences,

    // Handlers
    handleImageUpload,
    handleImageRemove,
    handlePost,
    handleSchedule,
    handleAIGenerate,
    handleImageGenerate,
    handleCancelScheduled,
    handleThreadTweetChange,
    handleThreadImageUpload,
    handleThreadImageRemove,
    handleAddTweet,
    handleRemoveTweet,
    handleAIButtonClick,
    handleImageButtonClick,
    fetchScheduledTweets,
  };
};
