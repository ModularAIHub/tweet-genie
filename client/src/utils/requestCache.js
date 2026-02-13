const responseCache = new Map();
const inflightCache = new Map();

const buildErrorKey = (key) => `${key}::error`;

const normalizeTtl = (ttlMs, fallbackMs) => {
  if (Number.isFinite(ttlMs) && ttlMs > 0) return ttlMs;
  return fallbackMs;
};

export const isPageVisible = () => {
  if (typeof document === 'undefined') return true;
  return !document.hidden;
};

export const createRequestCacheKey = ({ scope = 'default', url = '', params = null, extra = null }) => {
  return `${scope}:${url}:${JSON.stringify(params || {})}:${JSON.stringify(extra || {})}`;
};

export const getCachedValue = (key) => {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
};

export const setCachedValue = (key, value, ttlMs = 30000) => {
  const normalizedTtl = normalizeTtl(ttlMs, 30000);
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + normalizedTtl,
  });
};

export const invalidateCacheKey = (key) => {
  responseCache.delete(key);
  responseCache.delete(buildErrorKey(key));
  inflightCache.delete(key);
};

export const invalidateCacheByPrefix = (prefix) => {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }
  for (const key of inflightCache.keys()) {
    if (key.startsWith(prefix)) {
      inflightCache.delete(key);
    }
  }
};

export const getOrFetchCached = async ({
  key,
  fetcher,
  ttlMs = 30000,
  errorTtlMs = 5000,
  bypass = false,
}) => {
  if (!key || typeof fetcher !== 'function') {
    return fetcher();
  }

  if (!bypass) {
    const cached = getCachedValue(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  }

  if (inflightCache.has(key)) {
    return inflightCache.get(key);
  }

  const requestPromise = Promise.resolve()
    .then(fetcher)
    .then((result) => {
      setCachedValue(key, result, ttlMs);
      return result;
    })
    .catch((error) => {
      // Prevent request storms after failures.
      setCachedValue(buildErrorKey(key), { error: true }, errorTtlMs);
      throw error;
    })
    .finally(() => {
      inflightCache.delete(key);
    });

  inflightCache.set(key, requestPromise);
  return requestPromise;
};

export const hasRecentErrorForKey = (key) => {
  const marker = getCachedValue(buildErrorKey(key));
  return !!marker?.error;
};

