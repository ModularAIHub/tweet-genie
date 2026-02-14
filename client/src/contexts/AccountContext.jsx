import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

// AccountContext.jsx
const TEAM_CONTEXT_STORAGE_KEY = 'activeTeamContext';

const resolvePrimaryTeamId = (user) => {
  if (!user) return null;
  if (user.team_id || user.teamId) {
    return user.team_id || user.teamId;
  }

  if (Array.isArray(user.teamMemberships)) {
    const membership = user.teamMemberships.find((item) => item?.teamId || item?.team_id);
    if (membership) {
      return membership.teamId || membership.team_id || null;
    }
  }

  return null;
};

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
  const [activeTeamId, setActiveTeamId] = useState(null);

  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';

  // Load persisted account selection on app start
  useEffect(() => {
    const savedAccount = localStorage.getItem('selectedTwitterAccount');
    if (savedAccount) {
      try {
        const parsed = JSON.parse(savedAccount);
        const teamContextRaw = localStorage.getItem(TEAM_CONTEXT_STORAGE_KEY);
        let hasTeamContext = false;
        if (teamContextRaw) {
          try {
            const parsedTeamContext = JSON.parse(teamContextRaw);
            hasTeamContext = Boolean(parsedTeamContext?.team_id || parsedTeamContext?.teamId);
          } catch {
            hasTeamContext = false;
          }
        }

        const accountTeamId = parsed?.team_id || parsed?.teamId || null;
        if (hasTeamContext && !accountTeamId) {
          localStorage.removeItem('selectedTwitterAccount');
          return;
        }

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
      const selectedTeamId = account.team_id || account.teamId || null;
      localStorage.setItem(
        'selectedTwitterAccount',
        JSON.stringify({
          id: account.id,
          username: account.account_username || account.username,
          display_name: account.account_display_name || account.display_name,
          team_id: selectedTeamId,
        }),
      );

      if (selectedTeamId) {
        localStorage.setItem(
          TEAM_CONTEXT_STORAGE_KEY,
          JSON.stringify({ team_id: selectedTeamId })
        );
      }

    } else {
      localStorage.removeItem('selectedTwitterAccount');
      if (!userTeamStatus || !activeTeamId) {
        localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
      }
    }
  };

  // Step 1: Derive team status from the already-authenticated user payload
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!isAuthenticated || !user) {
      setUserTeamStatus(false);
      setActiveTeamId(null);
      localStorage.removeItem('selectedTwitterAccount');
      localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
      return;
    }

    const primaryTeamId = resolvePrimaryTeamId(user);
    const hasTeamMemberships =
      !!primaryTeamId ||
      (Array.isArray(user.teamMemberships) && user.teamMemberships.length > 0);

    setUserTeamStatus(hasTeamMemberships);
    setActiveTeamId(hasTeamMemberships ? primaryTeamId : null);

    if (hasTeamMemberships && primaryTeamId) {
      localStorage.setItem(
        TEAM_CONTEXT_STORAGE_KEY,
        JSON.stringify({ team_id: primaryTeamId })
      );
    } else {
      localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
    }
  }, [authLoading, isAuthenticated, user]);

  // Step 2: Only fetch accounts after team status is known
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!isAuthenticated || !user) {
      setAccounts([]);
      setSelectedAccount(null);
      localStorage.removeItem('selectedTwitterAccount');
      localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
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
              const responseTeamId = teamData?.teamId || teamData?.team_id || activeTeamId || null;
              const rawAccounts = teamData.accounts || teamData.data || [];
              accountsData = Array.isArray(rawAccounts)
                ? rawAccounts.map((account) => ({
                    ...account,
                    team_id: account?.team_id || account?.teamId || responseTeamId || null,
                  }))
                : [];
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

          const selectedTeamId = accountToSelect.team_id || accountToSelect.teamId || activeTeamId || null;
          localStorage.setItem('selectedTwitterAccount', JSON.stringify({
            id: accountToSelect.id,
            username: accountToSelect.account_username,
            display_name: accountToSelect.account_display_name,
            team_id: selectedTeamId,
          }));
          if (selectedTeamId) {
            localStorage.setItem(
              TEAM_CONTEXT_STORAGE_KEY,
              JSON.stringify({ team_id: selectedTeamId })
            );
          }
        } else {
          setSelectedAccount(null);
          localStorage.removeItem('selectedTwitterAccount');
          if (userTeamStatus && activeTeamId) {
            localStorage.setItem(
              TEAM_CONTEXT_STORAGE_KEY,
              JSON.stringify({ team_id: activeTeamId })
            );
          } else {
            localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
          }
        }
      } catch (error) {
        setAccounts([]);
        setSelectedAccount(null);
        localStorage.removeItem('selectedTwitterAccount');
      } finally {
        setLoading(false);
      }
    };
    fetchAccounts();
  }, [authLoading, isAuthenticated, user, userTeamStatus, activeTeamId, apiBaseUrl]);

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
        isTeamMode: Boolean(userTeamStatus),
        activeTeamId,
        refreshTeamStatus, // Export this to clear cache when needed
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};
