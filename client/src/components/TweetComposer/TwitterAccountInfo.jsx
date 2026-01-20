import React from 'react';
import { useAccount } from '../../contexts/AccountContext';

const TwitterAccountInfo = ({ twitterAccounts }) => {
  const { selectedAccount } = useAccount();
  
  // Use selected account from context if available, otherwise fall back to first account
  const accountToDisplay = selectedAccount || (twitterAccounts && twitterAccounts[0]);
  
  if (!accountToDisplay) return null;

  // Handle both team account format (account_username) and personal account format (username)
  const username = accountToDisplay.account_username || accountToDisplay.username;
  const displayName = accountToDisplay.account_display_name || accountToDisplay.display_name;

  return (
    <div className="card mb-6">
      <div className="flex items-center space-x-3">
        <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-blue-600 font-medium text-sm">
            {displayName?.[0]?.toUpperCase() || username?.[0]?.toUpperCase()}
          </span>
        </div>
        <div>
          <h3 className="font-medium text-gray-900">
            Posting as @{username}
          </h3>
          <p className="text-sm text-gray-600">
            {displayName || username}
          </p>
        </div>
      </div>
    </div>
  );
};

export default TwitterAccountInfo;
