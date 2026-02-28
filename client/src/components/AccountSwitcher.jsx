import React, { useState, useEffect } from 'react';
import { ChevronDown, User, Check, Twitter } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';

const AccountSwitcher = () => {
  const { accounts, selectedAccount, setSelectedAccount: updateSelectedAccount, loading } = useAccount();
  const [isOpen, setIsOpen] = useState(false);

  const handleAccountSelect = (account) => {
    updateSelectedAccount(account);
    setIsOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 bg-gray-100 rounded-lg animate-pulse">
        <div className="w-8 h-8 bg-gray-300 rounded-full"></div>
        <div className="w-24 h-4 bg-gray-300 rounded"></div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 bg-gray-100 rounded-lg text-gray-500">
        <User className="h-5 w-5" />
        <span className="text-sm">No Twitter accounts</span>
      </div>
    );
  }

  if (accounts.length === 1) {
    // Show single account without dropdown
    const account = accounts[0];
    const displayName = account.account_display_name || account.display_name || account.nickname || 'Account';
    const username = account.account_username || account.username || '';
    return (
      <div className="flex items-center space-x-3 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200">
        <div className="relative">
          <img 
            src={account.profile_image_url || '/default-avatar.png'} 
            alt={displayName}
            className="w-8 h-8 rounded-full"
          />
          <Twitter className="absolute -bottom-1 -right-1 h-4 w-4 text-blue-400 bg-white rounded-full p-0.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {displayName}
          </p>
          <p className="text-xs text-gray-500 truncate">
            @{username}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-3 w-full px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
      >
        <div className="relative">
          <img 
            src={selectedAccount?.profile_image_url || '/default-avatar.png'} 
            alt={selectedAccount?.account_display_name || 'Account'}
            className="w-8 h-8 rounded-full"
          />
          <Twitter className="absolute -bottom-1 -right-1 h-4 w-4 text-blue-400 bg-white rounded-full p-0.5" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-gray-900 truncate">
            {selectedAccount?.account_display_name || selectedAccount?.nickname || 'Select Account'}
          </p>
          <p className="text-xs text-gray-500 truncate">
            @{selectedAccount?.account_username || 'No account selected'}
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          <div className="py-1">
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => handleAccountSelect(account)}
                className="flex items-center space-x-3 w-full px-3 py-2 hover:bg-gray-50 text-left transition-colors"
              >
                <div className="relative">
                  <img 
                    src={account.profile_image_url || '/default-avatar.png'} 
                    alt={account.account_display_name}
                    className="w-8 h-8 rounded-full"
                  />
                  <Twitter className="absolute -bottom-1 -right-1 h-4 w-4 text-blue-400 bg-white rounded-full p-0.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {account.account_display_name || account.nickname}
                  </p>
                  <div className="flex items-center space-x-2">
                    <p className="text-xs text-gray-500 truncate">
                      @{account.account_username}
                    </p>
                  </div>
                </div>
                {selectedAccount?.id === account.id && (
                  <Check className="h-4 w-4 text-blue-600" />
                )}
              </button>
            ))}
          </div>
          
          <div className="border-t border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-500">
              {accounts.length} of 8 team accounts connected
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountSwitcher;
