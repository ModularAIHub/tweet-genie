import { useAccount } from '../contexts/AccountContext';
import { createRequestCacheKey, getOrFetchCached } from '../utils/requestCache';

// Use the same API base URL as the rest of the app
const resolveApiBaseUrl = () => {
  const envBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';
  if (/^https?:\/\//i.test(envBaseUrl)) {
    return envBaseUrl;
  }

  if (typeof window !== 'undefined') {
    return new URL(envBaseUrl, window.location.origin).toString();
  }

  return 'http://localhost:3002';
};

const API_BASE_URL = resolveApiBaseUrl();
const buildRequestUrl = (endpoint) => new URL(endpoint, API_BASE_URL).toString();
const buildHeadersLike = (headers = {}) => {
  const normalized = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  return {
    get: (name) => normalized[String(name || '').toLowerCase()] || null,
  };
};

const toCachedFetchResponse = ({ ok, status, statusText, payload, headers, rawText }) => ({
  ok,
  status,
  statusText: statusText || '',
  headers: buildHeadersLike(headers),
  data: payload,
  json: async () => payload,
  text: async () =>
    typeof rawText === 'string' ? rawText : JSON.stringify(payload === undefined ? {} : payload),
});

const resolveTeamScope = ({ selectedAccount, activeTeamId, isTeamMode }) => {
  const selectedAccountTeamId = selectedAccount?.team_id || selectedAccount?.teamId || null;
  const hasExplicitPersonalSelection = Boolean(selectedAccount) && !selectedAccountTeamId;
  const effectiveTeamId = hasExplicitPersonalSelection
    ? null
    : selectedAccountTeamId || activeTeamId || null;

  return {
    effectiveTeamId,
    isTeamScope: Boolean(isTeamMode && effectiveTeamId),
  };
};

/**
 * Hook to make API calls account-aware
 * This ensures all data fetching uses the currently selected Twitter account
 */
export const useAccountAwareAPI = () => {
  const { selectedAccount, getCurrentAccountId, isTeamMode, activeTeamId } = useAccount();

  /**
   * Fetch data for the currently selected account
   * @param {string} endpoint - API endpoint to fetch from
   * @param {Object} options - Fetch options
   * @returns {Promise} - Fetch promise
   */
  const fetchForCurrentAccount = async (endpoint, options = {}) => {
    const accountId = getCurrentAccountId();
    const { effectiveTeamId, isTeamScope } = resolveTeamScope({
      selectedAccount,
      activeTeamId,
      isTeamMode,
    });
    const url = buildRequestUrl(endpoint);
    const { cacheTtlMs = 0, bypassCache = false, ...requestOptions } = options;
    const method = (requestOptions.method || 'GET').toUpperCase();

    const headers = {
      'Content-Type': 'application/json',
      ...requestOptions.headers,
    };

    // Team account headers are intentionally omitted in personal mode.
    if (isTeamScope && accountId) {
      headers['X-Selected-Account-Id'] = accountId;
    }

    if (isTeamScope) {
      headers['x-team-id'] = effectiveTeamId;
    }

    const requestConfig = {
      credentials: 'include',
      ...requestOptions,
      headers,
    };

    if (method !== 'GET' || cacheTtlMs <= 0) {
      return fetch(url, requestConfig);
    }

    const cacheKey = createRequestCacheKey({
      scope: 'accountAwareFetch',
      url,
      params: {
        accountId: isTeamScope ? accountId : null,
        teamId: isTeamScope ? effectiveTeamId : null,
      },
    });

    return getOrFetchCached({
      key: cacheKey,
      ttlMs: cacheTtlMs,
      bypass: bypassCache,
      fetcher: async () => {
        const response = await fetch(url, requestConfig);
        const contentType = response.headers.get('content-type') || 'application/json';
        const rawText = await response.text();
        let payload = {};

        if (contentType.includes('application/json')) {
          try {
            payload = rawText ? JSON.parse(rawText) : {};
          } catch {
            payload = {};
          }
        } else {
          payload = rawText ? { raw: rawText } : {};
        }

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText || '',
          headers: {
            'content-type': contentType,
          },
          payload,
          rawText,
        };
      },
    }).then((cachedResult) => {
      if (cachedResult && typeof cachedResult.ok === 'boolean') {
        return toCachedFetchResponse(cachedResult);
      }
      return cachedResult;
    });
  };

  /**
   * Post data for the currently selected account
   * @param {string} endpoint - API endpoint to post to
   * @param {Object} data - Data to post
   * @param {Object} options - Fetch options
   * @returns {Promise} - Fetch promise
   */
  const postForCurrentAccount = async (endpoint, data = {}, options = {}) => {
    const accountId = getCurrentAccountId();
    const { effectiveTeamId, isTeamScope } = resolveTeamScope({
      selectedAccount,
      activeTeamId,
      isTeamMode,
    });
    
    // Include account_id only in team mode.
    const payload = isTeamScope && accountId ? { ...data, account_id: accountId } : data;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (isTeamScope && accountId) {
      headers['X-Selected-Account-Id'] = accountId;
    }
    if (isTeamScope) {
      headers['x-team-id'] = effectiveTeamId;
    }

    return fetch(buildRequestUrl(endpoint), {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
      ...options
    });
  };

  /**
   * Get analytics for the currently selected account
   */
  const parseTimeRangeDays = (timeRange = '50d') => {
    const parsedDays = Number.parseInt(String(timeRange).replace(/d$/i, ''), 10);
    return Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 50;
  };

  const getAnalytics = async (timeRange = '50d') => {
    const days = parseTimeRangeDays(timeRange);
    return fetchForCurrentAccount(`/api/analytics/overview?days=${days}`, { cacheTtlMs: 20000 });
  };

  /**
   * Get engagement analytics for the currently selected account
   */
  const getEngagementAnalytics = async (timeRange = '50d') => {
    const days = parseTimeRangeDays(timeRange);
    return fetchForCurrentAccount(`/api/analytics/engagement?days=${days}`, { cacheTtlMs: 20000 });
  };

  /**
   * Get audience analytics for the currently selected account
   */
  const getAudienceAnalytics = async (timeRange = '50d') => {
    const days = parseTimeRangeDays(timeRange);
    return fetchForCurrentAccount(`/api/analytics/audience?days=${days}`, { cacheTtlMs: 20000 });
  };

  /**
   * Get scheduled tweets for the currently selected account
   */
  const getScheduledTweets = async () => {
    return fetchForCurrentAccount('/api/scheduling/scheduled', { cacheTtlMs: 15000 });
  };

  /**
   * Get tweet history for the currently selected account
   */
  const getTweetHistory = async (page = 1, limit = 20) => {
    return fetchForCurrentAccount(`/api/tweets/history?page=${page}&limit=${limit}`, { cacheTtlMs: 15000 });
  };

  /**
   * Post a tweet using the currently selected account
   */
  const postTweet = async (tweetData) => {
    return postForCurrentAccount('/api/tweets/post', tweetData);
  };

  /**
   * Schedule a tweet using the currently selected account
   */
  const scheduleTweet = async (tweetData) => {
    return postForCurrentAccount('/api/scheduling/schedule', tweetData);
  };

  return {
    selectedAccount,
    accountId: getCurrentAccountId(),
    
    // Raw methods
    fetchForCurrentAccount,
    postForCurrentAccount,
    
    // Specific API methods
    getAnalytics,
    getEngagementAnalytics,
    getAudienceAnalytics,
    getScheduledTweets,
    getTweetHistory,
    postTweet,
    scheduleTweet,
    
    // Helper methods
    hasSelectedAccount: () => !!getCurrentAccountId(),
    getCurrentAccountInfo: () => selectedAccount,
  };
};

export default useAccountAwareAPI;
