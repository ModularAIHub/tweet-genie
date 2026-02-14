import React, { createContext, useContext, useRef, useState, useEffect } from 'react';
import { auth } from '../utils/api';
import toast from 'react-hot-toast';
import { isPageVisible } from '../utils/requestCache';

const AuthContext = createContext();
let hasLoggedMissingAuthProvider = false;

const buildFallbackRedirectToLogin = () => () => {
  if (typeof window === 'undefined') return;
  const currentUrl = encodeURIComponent(window.location.href);
  const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
  window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
};

const AUTH_FALLBACK_CONTEXT = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
  logout: async () => {},
  checkAuthStatus: async () => {},
  redirectToLogin: buildFallbackRedirectToLogin(),
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    if (!hasLoggedMissingAuthProvider) {
      hasLoggedMissingAuthProvider = true;
      console.error('useAuth called outside AuthProvider. Falling back to unauthenticated context.');
    }
    return AUTH_FALLBACK_CONTEXT;
  }
  return context;
};

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
      // Don't handle error here, let the axios interceptor handle it
    }
  };

  // Remove client-side token processing since we use server callback now
  // The server /api/auth/callback endpoint handles token processing and cookie setting

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
      // If it's a 401, the backend middleware should have already attempted
      // token refresh. If we still get 401, it means refresh failed.
      if (error.response?.status === 401) {
        setIsAuthenticated(false);
        setUser(null);
        // Note: Don't redirect here, let ProtectedRoute handle it
      }
    } finally {
      authCheckInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const redirectToLogin = () => {
    // Set timestamp to prevent redirect loops
    const now = Date.now();
    const lastRedirect = sessionStorage.getItem('auth_redirect_time');
    
    // Only limit if it's been less than 2 seconds (to allow immediate correction)
    if (lastRedirect && (now - parseInt(lastRedirect)) < 2000) {
      console.warn('Redirect loop suspected, skipping');
      return;
    }

    sessionStorage.setItem('auth_redirect_time', now.toString());
    const currentUrl = encodeURIComponent(window.location.href);
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
    window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
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
    
    setUser(null);
    setIsAuthenticated(false);
    toast.success('Logged out successfully');
    
    // Redirect to main platform login
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
    const currentUrl = encodeURIComponent(window.location.origin);
    window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
  };

  const value = {
    user,
    isLoading,
    isAuthenticated,
    logout,
    checkAuthStatus,
    redirectToLogin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
