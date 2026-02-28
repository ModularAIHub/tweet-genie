import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { twitter } from '../utils/api';
import { isPageVisible } from '../utils/requestCache';

/**
 * Component to monitor Twitter token expiry and show warnings.
 */
const TwitterTokenStatusV2 = () => {
  const [tokenStatus, setTokenStatus] = useState(null);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkTokenStatus = async () => {
      if (!isPageVisible()) return;

      try {
        const response = await twitter.getTokenStatusCached({ ttlMs: 60000 });
        const data = response?.data || {};
        if (cancelled) return;

        setTokenStatus(data);

        if (!data.connected || data.isOAuth1 || data.postingReady === true) {
          setShowWarning(false);
          toast.dismiss('token-expiring');
          toast.dismiss('token-expired');
          return;
        }

        if (data.minutesUntilExpiry < 30 && data.minutesUntilExpiry > 0) {
          setShowWarning(true);
          toast.error(
            `Your Twitter connection will expire in ${data.minutesUntilExpiry} minutes. Auto-refresh is running.`,
            {
              duration: 10000,
              id: 'token-expiring',
            }
          );
          return;
        }

        if (data.minutesUntilExpiry <= 0) {
          setShowWarning(true);
          toast.error('Your Twitter connection has expired. Please reconnect your Twitter account.', {
            duration: Infinity,
            id: 'token-expired',
          });
          return;
        }

        setShowWarning(false);
        toast.dismiss('token-expiring');
        toast.dismiss('token-expired');
      } catch {
        if (!cancelled) {
          setShowWarning(false);
        }
      }
    };

    checkTokenStatus();
    const interval = setInterval(checkTokenStatus, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!showWarning || !tokenStatus) {
    return null;
  }

  const isExpired = tokenStatus.minutesUntilExpiry <= 0;

  return (
    <div
      className={`fixed top-20 right-4 max-w-md p-4 rounded-lg shadow-lg z-50 ${
        isExpired ? 'bg-red-100 border border-red-400' : 'bg-yellow-100 border border-yellow-400'
      }`}
    >
      <div className="flex items-start gap-3">
        {isExpired ? (
          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
        ) : (
          <RefreshCw className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0 animate-spin" />
        )}
        <div className="flex-1">
          <h4 className={`font-semibold ${isExpired ? 'text-red-900' : 'text-yellow-900'}`}>
            {isExpired ? 'Twitter Connection Expired' : 'Token Expiring Soon'}
          </h4>
          <p className={`text-sm mt-1 ${isExpired ? 'text-red-800' : 'text-yellow-800'}`}>
            {isExpired ? (
              <>
                Your Twitter connection has expired. Please{' '}
                <a href="/settings" className="underline font-semibold">
                  reconnect your Twitter account
                </a>{' '}
                to continue posting.
              </>
            ) : (
              <>
                Your Twitter token will expire in {tokenStatus.minutesUntilExpiry} minutes. The system is attempting
                to refresh it automatically. No action needed.
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowWarning(false)}
          className={`text-sm font-medium ${
            isExpired ? 'text-red-600 hover:text-red-800' : 'text-yellow-600 hover:text-yellow-800'
          }`}
        >
          x
        </button>
      </div>
    </div>
  );
};

export default TwitterTokenStatusV2;
