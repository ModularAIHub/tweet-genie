import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { twitter } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { Check, X } from 'lucide-react';

const TwitterCallback = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Connecting your Twitter account...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const oauth_token = searchParams.get('oauth_token');
        const oauth_verifier = searchParams.get('oauth_verifier');
        const denied = searchParams.get('denied');

        if (denied) {
          setStatus('error');
          setMessage('Twitter authorization was denied');
          if (window.opener) {
            window.opener.postMessage({ type: 'TWITTER_AUTH_ERROR', error: 'Authorization denied' }, '*');
          }
          setTimeout(() => window.close(), 2000);
          return;
        }

        if (!oauth_token || !oauth_verifier) {
          setStatus('error');
          setMessage('Invalid Twitter callback parameters');
          if (window.opener) {
            window.opener.postMessage({ type: 'TWITTER_AUTH_ERROR', error: 'Invalid parameters' }, '*');
          }
          setTimeout(() => window.close(), 2000);
          return;
        }

        // Get stored oauth_token_secret from sessionStorage
        const oauth_token_secret = sessionStorage.getItem('oauth_token_secret');
        
        if (!oauth_token_secret) {
          setStatus('error');
          setMessage('Twitter connection failed - missing token secret');
          if (window.opener) {
            window.opener.postMessage({ type: 'TWITTER_AUTH_ERROR', error: 'Missing token secret' }, '*');
          }
          setTimeout(() => window.close(), 2000);
          return;
        }

        // Connect Twitter account
        await twitter.connect({
          oauth_token,
          oauth_token_secret,
          oauth_verifier
        });

        setStatus('success');
        setMessage('Twitter account connected successfully!');
        
        // Notify parent window and close popup
        if (window.opener) {
          window.opener.postMessage({ type: 'TWITTER_AUTH_SUCCESS' }, '*');
        }
        
        // Clean up session storage and close popup window
        sessionStorage.removeItem('oauth_token_secret');
        setTimeout(() => window.close(), 2000);

      } catch (error) {
        console.error('Twitter callback error:', error);
        setStatus('error');
        setMessage('Failed to connect Twitter account');
        
        if (window.opener) {
          window.opener.postMessage({ 
            type: 'TWITTER_AUTH_ERROR', 
            error: error.response?.data?.error || error.message 
          }, '*');
        }
        
        setTimeout(() => window.close(), 3000);
      }
    };

    handleCallback();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="text-center">
          {status === 'processing' && (
            <>
              <LoadingSpinner size="lg" />
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                Connecting Twitter Account
              </h2>
              <p className="mt-2 text-gray-600">{message}</p>
            </>
          )}
          
          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                Success!
              </h2>
              <p className="mt-2 text-gray-600">{message}</p>
              <p className="mt-1 text-sm text-gray-500">This window will close automatically.</p>
            </>
          )}
          
          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <X className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                Connection Failed
              </h2>
              <p className="mt-2 text-gray-600">{message}</p>
              <p className="mt-1 text-sm text-gray-500">This window will close automatically.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TwitterCallback;
