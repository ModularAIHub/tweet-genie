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

  // Check if we have a token in the URL (from platform redirect)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const redirectUrl = urlParams.get('redirect');
    
    if (token) {
      handleAuthCallback(token, redirectUrl);
    }
  }, []);

  const handleAuthCallback = async (token, redirectUrl) => {
    try {
      // Send token to backend to set httpOnly cookie
      const response = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ token, redirectUrl }),
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
      // Since we're using httpOnly cookies, just try to validate
      const response = await auth.validate();
      
      if (response.data.success) {
        setUser(response.data.user);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
      setUser(null);
      
      // If it's a 401 and we're on a protected page, redirect to login
      if (error.response?.status === 401 && window.location.pathname !== '/') {
        redirectToLogin();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const redirectToLogin = () => {
    const currentUrl = encodeURIComponent(window.location.href);
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:3000';
    window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
  };

  const logout = async () => {
    try {
      // Call backend logout to clear cookie
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    setUser(null);
    setIsAuthenticated(false);
    toast.success('Logged out successfully');
    
    // Redirect to main platform
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:3000';
    window.location.href = `${platformUrl}/login`;
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
