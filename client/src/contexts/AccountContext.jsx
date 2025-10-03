// Helper to get current account ID
export const getCurrentAccountId = (selectedAccount) => {
  if (!selectedAccount) return null;
  // For team accounts, id is always present
  return selectedAccount.id || selectedAccount.account_id || null;
}
import React, { createContext, useContext, useState, useEffect } from 'react';

const AccountContext = createContext();

export const useAccount = () => {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
};

export const AccountProvider = ({ children }) => {
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userTeamStatus, setUserTeamStatus] = useState(null); // null = loading, true = team, false = individual
  const [csrfToken, setCsrfToken] = useState(null);

  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';

  // Load persisted account selection on app start
  useEffect(() => {
    const savedAccount = localStorage.getItem('selectedTwitterAccount');
    if (savedAccount) {
      try {
        const parsed = JSON.parse(savedAccount);
        console.log('Loaded saved account selection:', parsed);
      } catch (error) {
        console.error('Failed to parse saved account:', error);
        localStorage.removeItem('selectedTwitterAccount');
      }
    }
  }, []);

  const updateSelectedAccount = (account) => {
    setSelectedAccount(account);
    if (account) {
      localStorage.setItem(
        'selectedTwitterAccount',
        JSON.stringify({
          id: account.id,
          username: account.username,
          display_name: account.display_name,
        }),
      );
    } else {
      localStorage.removeItem('selectedTwitterAccount');
    }
  // Step 0: Fetch CSRF token on mount
  useEffect(() => {
    const fetchCsrfToken = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/auth/csrf-token`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setCsrfToken(data.csrfToken);
        }
      } catch (err) {
        console.error('Failed to fetch CSRF token:', err);
      }
    };
    fetchCsrfToken();
  }, [apiBaseUrl]);

  // Step 1: Check user's team status on mount
  useEffect(() => {
    const checkUserTeamStatus = async () => {
      try {
        const userResponse = await fetch(`${apiBaseUrl}/api/twitter/user/profile`, {
          credentials: 'include',
        });
        if (userResponse.ok) {
          const userProfile = await userResponse.json();
          const isInTeam = userProfile.team_id || (userProfile.teamMemberships && userProfile.teamMemberships.length > 0);
          console.log('[AccountContext] setUserTeamStatus called with:', isInTeam ? true : false);
          setUserTeamStatus(isInTeam ? true : false);
        } else {
          setUserTeamStatus(false);
        }
      } catch (error) {
        setUserTeamStatus(false);
      }
    };
    checkUserTeamStatus();
  }, [apiBaseUrl]);

  // Step 2: Only fetch accounts after team status is known
  useEffect(() => {
    console.log('[AccountContext] accounts fetch effect running. userTeamStatus:', userTeamStatus);
    if (userTeamStatus === null) return; // Wait for team status
    const fetchAccounts = async () => {
      setLoading(true);
      try {
        let accountsData = [];
        const fetchOptions = {
          credentials: 'include',
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        };
        if (userTeamStatus) {
          // Team mode: fetch team accounts
          console.log('[AccountContext] Fetching team accounts from:', `${apiBaseUrl}/api/pro-team/social-accounts`);
          try {
            const teamResponse = await fetch(`${apiBaseUrl}/api/pro-team/social-accounts`, fetchOptions);
            console.log('[AccountContext] Team accounts fetch response:', teamResponse);
            if (teamResponse.ok) {
              const teamData = await teamResponse.json();
              console.log('[AccountContext] Team accounts fetch JSON:', teamData);
              accountsData = teamData.accounts || teamData.data || [];
            } else {
              console.warn('[AccountContext] Team accounts fetch failed with status:', teamResponse.status);
            }
          } catch (err) {
            console.error('[AccountContext] Error fetching team accounts:', err);
          }
        } else {
          // Individual mode: fetch individual accounts
          const individualResponse = await fetch(`${apiBaseUrl}/api/twitter/accounts`, fetchOptions);
          if (individualResponse.ok) {
            const individualData = await individualResponse.json();
            if (individualData.success && individualData.data) {
              accountsData = Array.isArray(individualData.data)
                ? individualData.data
                : [individualData.data];
            }
          }
        }
        setAccounts(accountsData);
        // Restore selection from localStorage, or pick first account
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
            } catch (error) {
              console.error('Failed to parse saved account:', error);
            }
          }
          setSelectedAccount(accountToSelect);
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
  }, [userTeamStatus, apiBaseUrl]);
  };


  return (
    <AccountContext.Provider
      value={{
        selectedAccount,
        setSelectedAccount: updateSelectedAccount,
        accounts,
        loading,
        getCurrentAccountId: () => getCurrentAccountId(selectedAccount),
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};
