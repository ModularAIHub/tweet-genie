import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

// AccountContext.jsx

// Helper to get current account ID
export const getCurrentAccountId = (selectedAccount) => {
  if (!selectedAccount) return null;
  // For team accounts, id is always present
  return selectedAccount.id || selectedAccount.account_id || null;
}

const AccountContext = createContext();

export const useAccount = () => {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
};

export const AccountProvider = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userTeamStatus, setUserTeamStatus] = useState(null);

  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';

  // Load persisted account selection on app start
  useEffect(() => {
    const savedAccount = localStorage.getItem('selectedTwitterAccount');
    if (savedAccount) {
      try {
        const parsed = JSON.parse(savedAccount);
        if (parsed?.id) {
          setSelectedAccount(parsed);
        }
      } catch (error) {
        localStorage.removeItem('selectedTwitterAccount');
      }
    }
  }, []);

  const updateSelectedAccount = async (account) => {
    setSelectedAccount(account);
    if (account) {
      localStorage.setItem(
        'selectedTwitterAccount',
        JSON.stringify({
    id: account.id,
    username: account.account_username || account.username,
    display_name: account.account_display_name || account.display_name,
    team_id: account.team_id || account.teamId || null,
  }),
);

    } else {
      localStorage.removeItem('selectedTwitterAccount');
    }
  };

  // Step 1: Derive team status from the already-authenticated user payload
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!isAuthenticated || !user) {
      setUserTeamStatus(false);
      return;
    }

    const hasTeamMemberships =
      !!(user.team_id || user.teamId) ||
      (Array.isArray(user.teamMemberships) && user.teamMemberships.length > 0);

    setUserTeamStatus(hasTeamMemberships);
  }, [authLoading, isAuthenticated, user]);

  // Step 2: Only fetch accounts after team status is known
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!isAuthenticated || !user) {
      setAccounts([]);
      setSelectedAccount(null);
      setLoading(false);
      return;
    }

    if (userTeamStatus === null) {
      return;
    }

    const fetchAccounts = async () => {
      setLoading(true);
      try {
        let accountsData = [];

        if (userTeamStatus) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const teamResponse = await fetch(`${apiBaseUrl}/api/team/accounts`, {
              credentials: 'include',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (teamResponse.ok) {
              const teamData = await teamResponse.json();
              accountsData = teamData.accounts || teamData.data || [];
            }
          } catch (err) {
            accountsData = [];
          }
        } else {
          accountsData = [];
        }

        setAccounts(accountsData);

        if (accountsData.length > 0) {
          const savedAccount = localStorage.getItem('selectedTwitterAccount');
          let accountToSelect = accountsData[0]; // Default to first
          if (savedAccount) {
            try {
              const parsed = JSON.parse(savedAccount);
              const matchingAccount = accountsData.find((acc) => acc.id === parsed.id);
              if (matchingAccount) {
                accountToSelect = matchingAccount;
              }
            } catch {}
          }
          setSelectedAccount(accountToSelect);

          localStorage.setItem('selectedTwitterAccount', JSON.stringify({
            id: accountToSelect.id,
            username: accountToSelect.account_username,
            display_name: accountToSelect.account_display_name,
            team_id: accountToSelect.team_id || accountToSelect.teamId || null,
          }));
        } else {
          setSelectedAccount(null);
          localStorage.removeItem('selectedTwitterAccount');
        }
      } catch (error) {
        setAccounts([]);
        setSelectedAccount(null);
      } finally {
        setLoading(false);
      }
    };
    fetchAccounts();
  }, [authLoading, isAuthenticated, user, userTeamStatus, apiBaseUrl]);

  // Function to refresh team status (call after connecting Twitter account)
  const refreshTeamStatus = () => {
    setUserTeamStatus(null);
  };

  return (
    <AccountContext.Provider
      value={{
        selectedAccount,
        setSelectedAccount: updateSelectedAccount,
        accounts,
        loading,
        getCurrentAccountId: () => getCurrentAccountId(selectedAccount),
        refreshTeamStatus, // Export this to clear cache when needed
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};
