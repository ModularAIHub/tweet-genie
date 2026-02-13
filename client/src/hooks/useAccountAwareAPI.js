import { useAccount } from '../contexts/AccountContext';

// Use the same API base URL as the rest of the app
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

/**
 * Hook to make API calls account-aware
 * This ensures all data fetching uses the currently selected Twitter account
 */
export const useAccountAwareAPI = () => {
  const { selectedAccount, getCurrentAccountId } = useAccount();

  /**
   * Fetch data for the currently selected account
   * @param {string} endpoint - API endpoint to fetch from
   * @param {Object} options - Fetch options
   * @returns {Promise} - Fetch promise
   */
  const fetchForCurrentAccount = async (endpoint, options = {}) => {
    const accountId = getCurrentAccountId();
    // Build full URL using API base URL, not window.location.origin
    const url = new URL(endpoint, API_BASE_URL);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add account ID header if we have one (team users)
    if (accountId) {
      headers['X-Selected-Account-Id'] = accountId;
    }

    // Add x-team-id header if selectedAccount has a team_id property
    if (selectedAccount && selectedAccount.team_id) {
      headers['x-team-id'] = selectedAccount.team_id;
    }

    return fetch(url.toString(), {
      credentials: 'include',
      ...options,
      headers,
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
    
    // Include account ID in the data payload only if we have one
    const payload = accountId ? { ...data, account_id: accountId } : data;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Only add account ID header if we have one (team users)
    if (accountId) {
      headers['X-Selected-Account-Id'] = accountId;
    }

    return fetch(endpoint, {
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
  const getAnalytics = async (timeRange = '50d') => {
    const parsedDays = parseInt(String(timeRange).replace(/d$/i, ''), 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 50;
    return fetchForCurrentAccount(`/api/analytics/overview?days=${days}`);
  };

  /**
   * Get scheduled tweets for the currently selected account
   */
  const getScheduledTweets = async () => {
    return fetchForCurrentAccount('/api/scheduling/scheduled');
  };

  /**
   * Get tweet history for the currently selected account
   */
  const getTweetHistory = async (page = 1, limit = 20) => {
    return fetchForCurrentAccount(`/api/tweets/history?page=${page}&limit=${limit}`);
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
