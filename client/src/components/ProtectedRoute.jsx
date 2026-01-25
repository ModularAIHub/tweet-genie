import React, { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';

export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading, redirectToLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect authenticated users from root to dashboard
  useEffect(() => {
    if (isAuthenticated && !isLoading && location.pathname === '/') {
      console.log('Authenticated user on root path, redirecting to Tweet Genie dashboard');
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isLoading, location.pathname, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Check if we recently redirected to prevent loops
    const hasRedirectedRecently = sessionStorage.getItem('auth_redirect_time');
    const now = Date.now();
    
    if (hasRedirectedRecently && (now - parseInt(hasRedirectedRecently)) < 30000) {
      // Don't redirect again, show error instead
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 font-semibold">Authentication Error</p>
            <p className="mt-2 text-gray-600">Unable to authenticate. Please try again later.</p>
          </div>
        </div>
      );
    }
    
    // Use the centralized redirect logic from AuthContext
    redirectToLogin();
    
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return children;
};
