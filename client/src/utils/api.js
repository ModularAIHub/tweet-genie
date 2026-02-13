// Media endpoints
export const media = {
  upload: (mediaArray) => api.post('/api/twitter/upload-media', { media: mediaArray }),
};
import axios from 'axios';
import {
  createRequestCacheKey,
  getOrFetchCached,
  invalidateCacheByPrefix,
} from './requestCache';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for cookies
});

const DEFAULT_CACHE_TTL_MS = Number(import.meta.env.VITE_CLIENT_API_CACHE_TTL_MS || 20000);

const cachedGet = ({ url, params = {}, scope, ttlMs = DEFAULT_CACHE_TTL_MS, bypass = false }) => {
  const cacheKey = createRequestCacheKey({ scope, url, params });
  return getOrFetchCached({
    key: cacheKey,
    ttlMs,
    bypass,
    fetcher: () => api.get(url, { params }),
  });
};

// Request interceptor to attach JWT token and selected account ID
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage (or cookies if you prefer)
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Team scope headers are sent only in team mode.
    const selectedAccount = localStorage.getItem('selectedTwitterAccount');
    if (selectedAccount) {
      try {
        const account = JSON.parse(selectedAccount);
        const hasTeamScope = Boolean(account?.team_id);
        if (hasTeamScope && account?.id) {
          config.headers['X-Selected-Account-Id'] = account.id;
        } else {
          delete config.headers['X-Selected-Account-Id'];
        }

        if (hasTeamScope) {
          config.headers['x-team-id'] = account.team_id;
        } else {
          delete config.headers['x-team-id'];
        }
      } catch (error) {
        console.error('Failed to parse selected account:', error);
        delete config.headers['X-Selected-Account-Id'];
        delete config.headers['x-team-id'];
      }
    } else {
      delete config.headers['X-Selected-Account-Id'];
      delete config.headers['x-team-id'];
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Flag to prevent multiple refresh attempts
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  
  failedQueue = [];
};

// Response interceptor to handle errors and automatic token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Check for Twitter token expiration specifically
    if (error.response?.data?.code === 'TWITTER_TOKEN_EXPIRED') {
      console.error('⚠️ Twitter token expired:', error.response.data);
      const { toast } = await import('react-hot-toast');
      toast.error(
        error.response.data.error || 'Your Twitter connection expired. Please reconnect your Twitter account.',
        { duration: 8000, id: 'twitter-expired' }
      );
      // Don't retry these requests
      return Promise.reject(error);
    }

    // Twitter reconnect-required errors should never trigger platform re-auth redirects.
    if (
      error.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
      error.response?.data?.reconnect === true
    ) {
      console.error('⚠️ Twitter reconnect required:', error.response.data);
      const { toast } = await import('react-hot-toast');
      toast.error(
        error.response.data.error || 'Twitter is disconnected. Please reconnect your Twitter account.',
        { duration: 8000, id: 'twitter-reconnect-required' }
      );
      return Promise.reject(error);
    }

    // Only attempt token refresh for 401 errors on protected routes
    // Exclude auth endpoints, csrf token, and already retried requests
    if (error.response?.status === 401 && 
        !originalRequest._retry && 
        !originalRequest.url.includes('/api/auth/refresh') &&
        !originalRequest.url.includes('/api/auth/login') &&
        !originalRequest.url.includes('/api/csrf-token')) {
      if (isRefreshing) {
        // If refresh is already in progress, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => {
          return api(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        
        // Fetch CSRF token and send in header for refresh
        let csrfToken = null;
        try {
          const csrfRes = await api.get('/api/csrf-token');
          csrfToken = csrfRes.data.csrfToken;
        } catch (err) {
          console.error('Failed to fetch CSRF token for refresh:', err);
        }
        
        // Use tweet-genie's own refresh endpoint instead of platform's
        const refreshResponse = await api.post('/api/auth/refresh', {}, {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
        });

        console.log('Token refreshed successfully');
        isRefreshing = false;
        processQueue(null);

        // Retry the original request
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        processQueue(refreshError, null);

        // Only redirect if we're not already on a callback or login-related page
        const currentPath = window.location.pathname;
        const hasRedirectedRecently = sessionStorage.getItem('auth_redirect_time');
        const now = Date.now();
        
        // Prevent redirect loop - only redirect once every 2 seconds
        if (hasRedirectedRecently && (now - parseInt(hasRedirectedRecently)) < 2000) {
          console.log('Skipping redirect to prevent loop');
          return Promise.reject(refreshError);
        }
        
        if (!currentPath.includes('/auth/callback') && 
            !currentPath.includes('/login') &&
            !currentPath.includes('/secure-login')) {
          console.log('Redirecting to platform for re-authentication');
          sessionStorage.setItem('auth_redirect_time', now.toString());
          const currentUrl = encodeURIComponent(window.location.href);
          const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
          window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
        }

        return Promise.reject(refreshError);
      }
    }

    // Twitter rate limit error (status 429)
    if (error.response?.status === 429 && error.response?.headers) {
      // Twitter sends x-rate-limit-reset header (epoch seconds)
      const resetEpoch = error.response.headers['x-rate-limit-reset'];
      if (resetEpoch) {
        const resetDate = new Date(parseInt(resetEpoch, 10) * 1000);
        const now = new Date();
        const diffMs = resetDate - now;
        const diffMin = Math.ceil(diffMs / 60000);
        const formatted = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const { toast } = await import('react-hot-toast');
        toast.error(`Twitter rate limit exceeded. Try again at ${formatted} (${diffMin} min)`, { duration: 12000, id: 'twitter-rate-limit' });
      } else {
        const { toast } = await import('react-hot-toast');
        toast.error('Twitter rate limit exceeded. Try again later.', { duration: 12000, id: 'twitter-rate-limit' });
      }
      return Promise.reject(error);
    }
    // For other errors, just reject
    return Promise.reject(error);
  }
);

// Auth endpoints
export const auth = {
  validate: () => api.get('/api/auth/validate'),
  validateCached: ({ ttlMs = 15000, bypass = false } = {}) =>
    cachedGet({ url: '/api/auth/validate', scope: 'auth_validate', ttlMs, bypass }),
  refresh: () => api.post('/api/auth/refresh'),
  logout: () => api.post('/api/auth/logout'),
};

// Twitter endpoints
export const twitter = {
  getStatus: () => api.get('/api/twitter/status'),
  getStatusCached: ({ ttlMs = 60000, bypass = false } = {}) =>
    cachedGet({ url: '/api/twitter/status', scope: 'twitter_status', ttlMs, bypass }),
  getTokenStatus: () => api.get('/api/twitter/token-status'),
  getTokenStatusCached: ({ ttlMs = 60000, bypass = false } = {}) =>
    cachedGet({ url: '/api/twitter/token-status', scope: 'twitter_token_status', ttlMs, bypass }),
  getTeamAccounts: () => api.get('/api/twitter/team-accounts'),
  connect: () => api.get('/api/twitter/connect', { params: { popup: 'true' } }),
  connectOAuth1: () => api.get('/api/twitter/connect-oauth1', { params: { popup: 'true' } }),
  disconnect: () => api.post('/api/twitter/disconnect'),
  getProfile: () => api.get('/api/twitter/profile'),
};

// Tweet endpoints
export const tweets = {
  create: (tweetData) => api.post('/api/tweets', tweetData),
  list: (params) => api.get('/api/tweets', { params }),
  delete: (tweetId) => api.delete(`/api/tweets/${tweetId}`),
  generateAI: (prompt) => api.post('/api/tweets/ai-generate', prompt),
  // Bulk save generated tweets/threads as drafts
  bulkSaveDrafts: (items) => api.post('/api/tweets/bulk-save', { items }),
};

// Scheduling endpoints
export const scheduling = {
  create: (scheduleData) => api.post('/api/scheduling', scheduleData),
  bulk: (bulkData) => api.post('/api/scheduling/bulk', bulkData),
  list: (params) => api.get('/api/scheduling', { params }),
  update: (scheduleId, data) => api.put(`/api/scheduling/${scheduleId}`, data),
  cancel: (scheduleId) => api.delete(`/api/scheduling/${scheduleId}`),
};

// Analytics endpoints
export const analytics = {
  getOverview: (params) => api.get('/api/analytics/overview', { params }),
  getOverviewCached: (params, { ttlMs = 20000, bypass = false } = {}) =>
    cachedGet({ url: '/api/analytics/overview', params, scope: 'analytics_overview', ttlMs, bypass }),
  getDetailed: (data) => api.post('/api/analytics/detailed', data),
  sync: () => api.post('/api/analytics/sync'),
  getHashtags: (params) => api.get('/api/analytics/hashtags', { params }),
  getEngagement: (params) => api.get('/api/analytics/engagement', { params }),
  getEngagementCached: (params, { ttlMs = 20000, bypass = false } = {}) =>
    cachedGet({ url: '/api/analytics/engagement', params, scope: 'analytics_engagement', ttlMs, bypass }),
  getAudience: (params) => api.get('/api/analytics/audience', { params }),
  getAudienceCached: (params, { ttlMs = 20000, bypass = false } = {}) =>
    cachedGet({ url: '/api/analytics/audience', params, scope: 'analytics_audience', ttlMs, bypass }),
  refreshTweetMetrics: (tweetId) => api.post(`/api/analytics/tweets/${tweetId}/refresh`),
  invalidateCache: () => invalidateCacheByPrefix('analytics_'),
};

// Dashboard endpoints
export const dashboard = {
  bootstrap: (params) => api.get('/api/dashboard/bootstrap', { params }),
};

// Credits endpoints
export const credits = {
  getBalance: () => api.get('/api/credits/balance'),
  getBalanceCached: ({ ttlMs = 60000, bypass = false } = {}) =>
    cachedGet({ url: '/api/credits/balance', scope: 'credits_balance', ttlMs, bypass }),
  getHistory: (params) => api.get('/api/credits/history', { params }),
  getPricing: () => api.get('/api/credits/pricing'),
};

// AI Providers endpoints
export const providers = {
  list: () => api.get('/api/providers'),
  configure: (provider, data) => api.post(`/api/providers/${provider}`, data),
  remove: (provider) => api.delete(`/api/providers/${provider}`),
  test: (provider) => api.post(`/api/providers/${provider}/test`),
};

// AI endpoints
export const ai = {
  generate: ({ prompt, style = 'casual', isThread = false }) => api.post('/api/ai/generate', { prompt, style, isThread }),
  generateOptions: (prompt, style = 'casual', count = 3) => 
    api.post('/api/ai/generate-options', { prompt, style, count }),
  bulkGenerate: (prompts, options) => api.post('/api/ai/bulk-generate', { prompts, options }),
  // Removed queue-based endpoints for bulk generation
};

// AI Image Generation endpoints
export const imageGeneration = {
  generate: (prompt, style = 'natural') => api.post('/imageGeneration', 
    { prompt, style }, 
    { 
      timeout: 90000, // 90 seconds for image generation
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  ),
};

// Strategy Builder endpoints
export const strategy = {
  getCurrent: () => api.get('/api/strategy/current'),
  getById: (id) => api.get(`/api/strategy/${id}`),
  list: () => api.get('/api/strategy/list'),
  create: (data) => api.post('/api/strategy', data),
  chat: (message, strategyId, currentStep) => api.post('/api/strategy/chat', { message, strategyId, currentStep }),
  generatePrompts: (strategyId) => api.post(`/api/strategy/${strategyId}/generate-prompts`),
  getPrompts: (strategyId, params) => api.get(`/api/strategy/${strategyId}/prompts`, { params }),
  toggleFavorite: (promptId) => api.post(`/api/strategy/prompts/${promptId}/favorite`),
  update: (strategyId, data) => api.patch(`/api/strategy/${strategyId}`, data),
  delete: (strategyId) => api.delete(`/api/strategy/${strategyId}`),
};

export default api;
