import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../utils/api';
import toast from 'react-hot-toast';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Set up periodic auth checks to handle token refresh
  useEffect(() => {
    if (!isAuthenticated) return;

    // Check auth status every 12 minutes to ensure tokens are fresh
    // (tokens expire at 15 minutes, so this gives buffer for refresh)
    const interval = setInterval(() => {
      console.log('Periodic auth check and refresh...');
      refreshTokenIfNeeded();
    }, 12 * 60 * 1000); // 12 minutes

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Proactive token refresh function
  const refreshTokenIfNeeded = async () => {
    try {
      console.log('Attempting proactive token refresh...');
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        console.log('Token refreshed proactively');
        // Validate the new token
        await checkAuthStatus();
      } else {
        console.log('Proactive refresh failed, will let interceptor handle it');
      }
    } catch (error) {
      console.error('Proactive token refresh error:', error);
      // Don't handle error here, let the axios interceptor handle it
    }
  };

  // Check if we have tokens in the URL (from platform redirect)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const refreshToken = urlParams.get('refreshToken');
    const redirectUrl = urlParams.get('redirect');
    
    if (token) {
      handleAuthCallback(token, refreshToken, redirectUrl);
    }
  }, []);

  const handleAuthCallback = async (token, refreshToken, redirectUrl) => {
    try {
      // Send tokens to backend to set httpOnly cookies
      const response = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ token, refreshToken, redirectUrl }),
      });

      if (response.ok) {
        // Clean URL and redirect to dashboard or original URL
        window.history.replaceState({}, document.title, window.location.pathname);
        await checkAuthStatus();
        
        // Default to dashboard if not already there
        const finalRedirectUrl = redirectUrl || '/dashboard';
        if (window.location.pathname !== finalRedirectUrl && window.location.pathname !== '/dashboard') {
          window.location.href = finalRedirectUrl;
        }
      }
    } catch (error) {
      console.error('Auth callback failed:', error);
      redirectToLogin();
    }
  };

  const checkAuthStatus = async () => {
    try {
      console.log('Checking auth status...');
      // Since we're using httpOnly cookies, just try to validate
      const response = await auth.validate();
      console.log('Auth validation response:', response.data);
      
      if (response.data.success) {
        setUser(response.data.user);
        setIsAuthenticated(true);
        console.log('User authenticated:', response.data.user);
      } else {
        setIsAuthenticated(false);
        setUser(null);
        console.log('User not authenticated - invalid response');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      console.error('Error status:', error.response?.status);
      console.error('Error data:', error.response?.data);
      
      // If it's a 401, the backend middleware should have already attempted
      // token refresh. If we still get 401, it means refresh failed.
      if (error.response?.status === 401) {
        console.log('401 error - authentication failed, will redirect to login');
        setIsAuthenticated(false);
        setUser(null);
        // Note: Don't redirect here, let ProtectedRoute handle it
      } else {
        // For other errors (network, etc), don't immediately redirect
        // The user might still be authenticated
        console.log('Non-401 error during auth check, keeping current state');
      }
    } finally {
      console.log('Auth check completed');
      setIsLoading(false);
    }
  };

  const redirectToLogin = () => {
    const currentUrl = encodeURIComponent(window.location.href);
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173';
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
    
    // Redirect to main platform login page with logout flag
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173';
    window.location.href = `${platformUrl}/login?logout=true`;
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
