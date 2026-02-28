import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

// AccountContext.jsx
const TEAM_CONTEXT_STORAGE_KEY = 'activeTeamContext';
const ACCOUNT_SCOPE_CHANGED_EVENT = 'suitegenie:account-scope-changed';

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

const normalizeAccountForStorage = (account = {}, fallbackTeamId = null) => ({
  id: account?.id || account?.account_id || null,
  username: account?.account_username || account?.username || null,
  display_name: account?.account_display_name || account?.display_name || null,
  team_id: account?.team_id || account?.teamId || fallbackTeamId || null,
});

const getStoredSelectedAccount = () => {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  const raw = localStorage.getItem('selectedTwitterAccount');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
};

const buildCachedAccountFallback = ({ fallbackTeamId = null, requireTeamAccount = false } = {}) => {
  const cached = getStoredSelectedAccount();
  if (!cached?.id) return [];

  const teamId = cached?.team_id || cached?.teamId || fallbackTeamId || null;
  if (requireTeamAccount && !teamId) {
    return [];
  }

  return [
    {
      ...cached,
      id: cached.id,
      team_id: teamId,
      username: cached.username || cached.account_username || null,
      display_name: cached.display_name || cached.account_display_name || null,
      account_username: cached.account_username || cached.username || null,
      account_display_name: cached.account_display_name || cached.display_name || null,
      nickname:
        cached.account_display_name ||
        cached.display_name ||
        cached.account_username ||
        cached.username ||
        null,
    },
  ];
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
  const [refreshNonce, setRefreshNonce] = useState(0);

  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';

  // Load persisted account selection on app start
  useEffect(() => {
    const parsed = getStoredSelectedAccount();
    if (!parsed?.id) {
      return;
    }

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

    setSelectedAccount(parsed);
  }, []);

  const updateSelectedAccount = async (account) => {
    setSelectedAccount(account);
    if (account) {
      const selectedTeamId = account.team_id || account.teamId || null;
      localStorage.setItem('selectedTwitterAccount', JSON.stringify(normalizeAccountForStorage(account, selectedTeamId)));

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

  useEffect(() => {
    const handleScopeChanged = () => {
      setRefreshNonce((value) => value + 1);
    };

    window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleScopeChanged);
    return () => {
      window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleScopeChanged);
    };
  }, []);

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
        const hydrateTeamAccountsFallback = async (fallbackTeamId = activeTeamId) => {
          const response = await fetch(`${apiBaseUrl}/api/twitter/team-accounts`, {
            credentials: 'include',
          });
          if (!response.ok) {
            return [];
          }

          const data = await response.json().catch(() => ({}));
          const rawAccounts = Array.isArray(data?.accounts) ? data.accounts : [];
          const responseTeamId = data?.team_id || data?.teamId || fallbackTeamId || null;
          return rawAccounts.map((account) => ({
            ...account,
            team_id: account?.team_id || account?.teamId || responseTeamId || null,
          }));
        };
        const fallbackToCachedScope = (requireTeamAccount = false) =>
          buildCachedAccountFallback({
            fallbackTeamId: requireTeamAccount ? activeTeamId : null,
            requireTeamAccount,
          });
        const fallbackToPersonalScope = async () => {
          const fallbackResponse = await fetch(`${apiBaseUrl}/api/twitter/status`, {
            credentials: 'include',
          });
          if (!fallbackResponse.ok) {
            return fallbackToCachedScope(false);
          }

          const fallbackData = await fallbackResponse.json();
          const rawFallbackAccounts = Array.isArray(fallbackData?.accounts) ? fallbackData.accounts : [];
          setUserTeamStatus(false);
          setActiveTeamId(null);
          localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
          return rawFallbackAccounts.map((account) => ({
            ...account,
            team_id: null,
          }));
        };

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
              const responseContext = String(teamData?.context || '').toLowerCase();
              const responseTeamId = teamData?.teamId || teamData?.team_id || null;
              const isServerTeamContext = responseContext === 'team' && Boolean(responseTeamId);

              // If membership changed (e.g. user left team), force-switch client back to personal mode.
              if (!isServerTeamContext) {
                setUserTeamStatus(false);
                setActiveTeamId(null);
                localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
              }

              const rawAccounts = teamData.accounts || teamData.data || [];
              accountsData = Array.isArray(rawAccounts)
                ? rawAccounts.map((account) => ({
                    ...account,
                    team_id: isServerTeamContext
                      ? (account?.team_id || account?.teamId || responseTeamId || null)
                      : null,
                  }))
                : [];
              if (isServerTeamContext && accountsData.length === 0) {
                accountsData = await hydrateTeamAccountsFallback(responseTeamId).catch(() => []);
              }
            } else {
              const teamError = await teamResponse.json().catch(() => ({}));
              const shouldFallbackToPersonal =
                (teamResponse.status === 403 && teamError?.code === 'TEAM_SCOPE_INVALID') ||
                teamResponse.status >= 500 ||
                teamResponse.status === 404 ||
                teamResponse.status === 400;

              if (shouldFallbackToPersonal) {
                accountsData = await hydrateTeamAccountsFallback(activeTeamId).catch(() => []);
                if (accountsData.length === 0) {
                  accountsData = await fallbackToPersonalScope();
                }
              }
            }
          } catch (err) {
            accountsData = await hydrateTeamAccountsFallback(activeTeamId).catch(() => []);
            if (accountsData.length === 0) {
              accountsData = await fallbackToPersonalScope().catch(() => fallbackToCachedScope(true));
            }
          }
        } else {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const personalResponse = await fetch(`${apiBaseUrl}/api/twitter/status`, {
              credentials: 'include',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (personalResponse.ok) {
              const personalData = await personalResponse.json();
              const rawAccounts = Array.isArray(personalData?.accounts) ? personalData.accounts : [];
              accountsData = rawAccounts.map((account) => ({
                ...account,
                team_id: null,
              }));
            } else {
              accountsData = fallbackToCachedScope(false);
            }
          } catch {
            accountsData = fallbackToCachedScope(false);
          }
        }

        if (accountsData.length === 0) {
          accountsData = fallbackToCachedScope(Boolean(userTeamStatus));
        }

        setAccounts(accountsData);

        if (accountsData.length > 0) {
          const savedAccount = getStoredSelectedAccount();
          let accountToSelect = accountsData[0]; // Default to first
          if (savedAccount) {
            const matchingAccount = accountsData.find((acc) => acc.id === savedAccount.id);
            if (matchingAccount) {
              accountToSelect = matchingAccount;
            }
          }
          setSelectedAccount(accountToSelect);

          const selectedTeamId = accountToSelect.team_id || accountToSelect.teamId || activeTeamId || null;
          localStorage.setItem(
            'selectedTwitterAccount',
            JSON.stringify(normalizeAccountForStorage(accountToSelect, selectedTeamId))
          );
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
        const cachedFallback = buildCachedAccountFallback({
          fallbackTeamId: activeTeamId,
          requireTeamAccount: Boolean(userTeamStatus),
        });
        setAccounts(cachedFallback);
        setSelectedAccount(cachedFallback[0] || null);
        if (cachedFallback.length === 0) {
          localStorage.removeItem('selectedTwitterAccount');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchAccounts();
  }, [authLoading, isAuthenticated, user, userTeamStatus, activeTeamId, apiBaseUrl, refreshNonce]);

  // Function to refresh team status (call after connecting Twitter account)
  const refreshTeamStatus = () => {
    setUserTeamStatus(null);
  };

  const refreshAccounts = () => {
    setRefreshNonce((value) => value + 1);
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
        refreshAccounts,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};
