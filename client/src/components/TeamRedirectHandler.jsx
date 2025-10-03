import React, { useEffect } from 'react';
import { toast } from 'react-toastify';
import { useAccount } from '../contexts/AccountContext';

const TeamRedirectHandler = () => {
  const { refreshAccounts } = useAccount();
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const username = urlParams.get('username');
    if ((success === 'twitter_connected' || success === 'team') && username) {
      toast.success(`🎉 Twitter account @${username} connected successfully!`);
      refreshAccounts();
      // Remove query params to prevent reload loop
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [refreshAccounts]);
  return null;
};

export default TeamRedirectHandler;
