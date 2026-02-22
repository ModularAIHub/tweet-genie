const trimText = (value = '', maxLength = 5000) => String(value || '').trim().slice(0, maxLength);

const collapseExcessBlankLines = (text = '') =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeThreadParts = (thread = []) =>
  (Array.isArray(thread) ? thread : [])
    .map((part) => trimText(part, 1000))
    .filter(Boolean);

export const detectCrossPostMedia = ({ media = [], threadMedia = [] } = {}) => {
  const hasSingleMedia = Array.isArray(media) && media.length > 0;
  const hasThreadMedia =
    Array.isArray(threadMedia) &&
    threadMedia.some((items) => Array.isArray(items) ? items.length > 0 : Boolean(items));

  return hasSingleMedia || hasThreadMedia;
};

export const buildCrossPostPayloads = ({
  content = '',
  thread = [],
  optimizeCrossPost = true,
} = {}) => {
  const normalizedOptimize = optimizeCrossPost !== false;
  const threadParts = normalizeThreadParts(thread);
  const isThread = threadParts.length > 1;
  const singleContent = trimText(content, 5000);

  const clean = (value) => {
    const raw = trimText(value, 5000);
    return normalizedOptimize ? collapseExcessBlankLines(raw) : raw;
  };

  const flattenLinkedInThread = () => {
    const joined = threadParts.join('\n\n');
    return clean(joined);
  };

  const threadsSingleContent = isThread ? clean(threadParts.join('\n\n')) : clean(singleContent);
  const threadsThreadParts = normalizedOptimize
    ? threadParts.map((part) => clean(part))
    : [...threadParts];

  return {
    source: {
      isThread,
      content: clean(singleContent),
      threadParts: normalizedOptimize ? threadParts.map((part) => clean(part)) : threadParts,
    },
    linkedin: {
      content: isThread ? flattenLinkedInThread() : clean(singleContent),
      postMode: 'single',
    },
    threads: isThread
      ? {
          postMode: 'thread',
          content: threadsSingleContent,
          threadParts: threadsThreadParts,
        }
      : {
          postMode: 'single',
          content: threadsSingleContent,
          threadParts: [],
        },
  };
};

