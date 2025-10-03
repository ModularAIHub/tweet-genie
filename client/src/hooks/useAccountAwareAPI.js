import { useAccount } from '../contexts/AccountContext';

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
    
    if (!accountId) {
      throw new Error('No Twitter account selected');
    }

    // Add account ID to query parameters or headers
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set('account_id', accountId);

    return fetch(url.toString(), {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      }
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
    
    if (!accountId) {
      throw new Error('No Twitter account selected');
    }

    // Include account ID in the data payload
    const payload = {
      ...data,
      account_id: accountId
    };

    return fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(payload),
      ...options
    });
  };

  /**
   * Get analytics for the currently selected account
   */
  const getAnalytics = async (timeRange = '7d') => {
    return fetchForCurrentAccount(`/api/analytics/overview?timeRange=${timeRange}`);
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