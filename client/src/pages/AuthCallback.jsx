import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';

const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { checkAuthStatus } = useAuth();

  useEffect(() => {
    const handleCallback = async () => {
      const token = searchParams.get('token');
      const redirect = searchParams.get('redirect');

      if (token) {
        try {
          // Send token to backend to set httpOnly cookie
          const response = await fetch('/api/auth/callback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ token, redirectUrl: redirect }),
          });

          if (response.ok) {
            // Clear the redirect timestamp to allow future auth checks
            sessionStorage.removeItem('auth_redirect_time');
            
            // Refresh auth status
            await checkAuthStatus();
            
            // Navigate to dashboard or specified redirect
            const redirectUrl = redirect || '/dashboard';
            navigate(redirectUrl, { replace: true });
          } else {
            // If callback failed, redirect to login
            window.location.href = `${import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173'}/login`;
          }
        } catch (error) {
          console.error('Auth callback error:', error);
          window.location.href = `${import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173'}/login`;
        }
      } else {
        // No token, redirect to platform login
        window.location.href = `${import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173'}/login`;
      }
    };

    handleCallback();
  }, [searchParams, navigate, checkAuthStatus]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
