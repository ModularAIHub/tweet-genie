// Media endpoints
export const media = {
  upload: (mediaArray) => api.post('/api/twitter/upload-media', { media: mediaArray }),
};
import axios from 'axios';

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

// Request interceptor to attach JWT token and selected account ID
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage (or cookies if you prefer)
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Add selected account ID header for team account switching
    const selectedAccount = localStorage.getItem('selectedTwitterAccount');
    if (selectedAccount) {
      try {
        const account = JSON.parse(selectedAccount);
        if (account.id) {
          config.headers['X-Selected-Account-Id'] = account.id;
        }
      } catch (error) {
        console.error('Failed to parse selected account:', error);
      }
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

    // For other errors, just reject
    return Promise.reject(error);
  }
);

// Auth endpoints
export const auth = {
  validate: () => api.get('/api/auth/validate'),
  refresh: () => api.post('/api/auth/refresh'),
  logout: () => api.post('/api/auth/logout'),
};

// Twitter endpoints
export const twitter = {
  getStatus: () => api.get('/api/twitter/status'),
  getTeamAccounts: () => api.get('/api/twitter/team-accounts'),
  connect: () => api.get('/api/twitter/connect'),
  connectOAuth1: () => api.get('/api/twitter/connect-oauth1'),
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
  getDetailed: (data) => api.post('/api/analytics/detailed', data),
  sync: () => api.post('/api/analytics/sync'),
  getHashtags: (params) => api.get('/api/analytics/hashtags', { params }),
  getEngagement: (params) => api.get('/api/analytics/engagement', { params }),
  getAudience: (params) => api.get('/api/analytics/audience', { params }),
};

// Credits endpoints
export const credits = {
  getBalance: () => api.get('/api/credits/balance'),
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

export default api;
