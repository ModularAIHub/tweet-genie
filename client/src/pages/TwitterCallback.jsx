import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { twitter } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const TwitterCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
      return;
    }

    handleTwitterCallback();
  }, [isAuthenticated, navigate]);

  const handleTwitterCallback = async () => {
    try {
      const oauthToken = searchParams.get('oauth_token');
      const oauthVerifier = searchParams.get('oauth_verifier');
      
      if (!oauthToken || !oauthVerifier) {
        toast.error('Invalid Twitter callback parameters');
        navigate('/settings');
        return;
      }

      // Get the oauth_token_secret from sessionStorage
      // (This would typically be stored during the initial auth request)
      const oauthTokenSecret = sessionStorage.getItem('oauth_token_secret');
      
      if (!oauthTokenSecret) {
        toast.error('Missing Twitter authentication data');
        navigate('/settings');
        return;
      }

      // Connect the Twitter account
      const response = await twitter.connect({
        oauth_token: oauthToken,
        oauth_token_secret: oauthTokenSecret,
        oauth_verifier: oauthVerifier
      });

      if (response.data.success) {
        toast.success('Twitter account connected successfully!');
        // Clean up
        sessionStorage.removeItem('oauth_token_secret');
        navigate('/settings');
      } else {
        toast.error('Failed to connect Twitter account');
        navigate('/settings');
      }

    } catch (error) {
      console.error('Twitter callback error:', error);
      toast.error(error.response?.data?.error || 'Failed to connect Twitter account');
      navigate('/settings');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <LoadingSpinner size="xl" />
        <h2 className="mt-4 text-xl font-semibold text-gray-900">
          Connecting Twitter Account
        </h2>
        <p className="mt-2 text-gray-600">
          Please wait while we connect your Twitter account...
        </p>
      </div>
    </div>
  );
};

export default TwitterCallback;
