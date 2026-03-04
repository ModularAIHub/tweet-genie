import React, { useRef, useState, useEffect, useMemo } from 'react';
import { auth } from '../utils/api';
import toast from 'react-hot-toast';
import { isPageVisible, clearAllCaches } from '../utils/requestCache';
import AuthContext from './AuthContext';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const initialAuthCheckDoneRef = useRef(false);
  const authCheckInFlightRef = useRef(false);

  // Get API base URL from environment
  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';

  // Check authentication status on mount
  useEffect(() => {
    // Don't check auth if we're on the secure-login callback page
    // (the page will set cookies and redirect)
    const currentPath = window.location.pathname;
    if (currentPath.includes('/secure-login') || currentPath.includes('/auth/callback')) {
      console.log('Skipping auth check on callback page');
      return;
    }

    if (initialAuthCheckDoneRef.current) {
      return;
    }
    initialAuthCheckDoneRef.current = true;
    checkAuthStatus();
  }, []);

  // Set up periodic auth checks to handle token refresh
  useEffect(() => {
    if (!isAuthenticated) return;

    // Check auth status every 14 minutes to ensure tokens are fresh
    // (tokens expire at 15 minutes, so this gives 1 minute buffer for refresh)
    const interval = setInterval(() => {
      if (!isPageVisible()) return;
      refreshTokenIfNeeded();
    }, 14 * 60 * 1000); // 14 minutes

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Proactive token refresh function
  const refreshTokenIfNeeded = async () => {
    try {
      // Fetch CSRF token
      let csrfToken = null;
      try {
        const csrfRes = await fetch(`${apiBaseUrl}/api/csrf-token`, { credentials: 'include' });
        const data = await csrfRes.json();
        csrfToken = data.csrfToken;
      } catch (err) {
        console.error('Failed to fetch CSRF token for proactive refresh:', err);
      }
      const response = await fetch(`${apiBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
      });

      if (response.ok) {
        // Validate the new token
        await checkAuthStatus({ silent: true });
      }
    } catch (error) {
      console.error('Proactive token refresh error:', error);
    }
  };

  const checkAuthStatus = async ({ silent = false } = {}) => {
    if (authCheckInFlightRef.current) {
      return;
    }
    authCheckInFlightRef.current = true;
    try {
      const response = await auth.validateCached({ ttlMs: 15000, bypass: !silent });

      if (response.data.success) {
        setUser(response.data.user);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    } catch (error) {
      if (error.response?.status === 401) {
        setIsAuthenticated(false);
        setUser(null);
      }
    } finally {
      authCheckInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const redirectToLogin = () => {
    const now = Date.now();
    const lastRedirect = sessionStorage.getItem('auth_redirect_time');

    if (lastRedirect && (now - parseInt(lastRedirect)) < 2000) {
      console.warn('Redirect loop suspected, skipping');
      return;
    }

    sessionStorage.setItem('auth_redirect_time', now.toString());
    const currentUrl = encodeURIComponent(window.location.href);
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
    window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
  };

  const clearAllUserData = () => {
    // Fixed keys
    const fixedKeys = [
      'accessToken',
      'selectedTwitterAccount',
      'activeTeamContext',
      'twitter_connect_user',
      'composerPrompt',
      'composerPromptPayload',
      'bulkGenerationSeed',
      'bulkGenerationDraft',
      'tweetComposerDraft',
      'schedulingViewMode',
      'suitegenie_oauth_result',
    ];
    fixedKeys.forEach((k) => localStorage.removeItem(k));

    // Prefixed keys (historyFilters:*, schedulingFilter:*, strategyGeneratedPrompts:*)
    const prefixes = ['historyFilters:', 'schedulingFilter:', 'strategyGeneratedPrompts:'];
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Flush in-memory request cache
    clearAllCaches();
  };

  const logout = async () => {
    try {
      // Call Tweet Genie backend logout to clear local cookies
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });

      // Also call Platform logout to clear platform cookies
      const platformUrl = import.meta.env.VITE_PLATFORM_API_URL || 'http://localhost:3000';
      await fetch(`${platformUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(error => {
        console.warn('Platform logout failed:', error);
        // Don't throw error if platform logout fails
      });
    } catch (error) {
      console.error('Logout error:', error);
    }

    // Purge all user-specific data from localStorage & in-memory caches
    clearAllUserData();

    setUser(null);
    setIsAuthenticated(false);
    toast.success('Logged out successfully');

    // Redirect to main platform login
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
    const currentUrl = encodeURIComponent(window.location.origin);
    window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
  };

  const value = useMemo(() => ({
    user,
    isLoading,
    isAuthenticated,
    logout,
    checkAuthStatus,
    redirectToLogin,
  }), [user, isLoading, isAuthenticated]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
