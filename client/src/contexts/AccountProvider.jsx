import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import AccountContext, {
  getCurrentAccountId,
  TEAM_CONTEXT_STORAGE_KEY,
  ACCOUNT_SCOPE_CHANGED_EVENT,
} from './AccountContext';

// --- Private helpers (used only by AccountProvider) ---

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

const normalizeAccountForStorage = (account = {}, fallbackTeamId = null, ownerUserId = null) => ({
  id: account?.id || account?.account_id || null,
  username: account?.account_username || account?.username || null,
  display_name: account?.account_display_name || account?.display_name || null,
  team_id: account?.team_id || account?.teamId || fallbackTeamId || null,
  _owner_user_id: ownerUserId || null,
});

const getStoredSelectedAccount = (currentUserId = null) => {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  const raw = localStorage.getItem('selectedTwitterAccount');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;

    // CRITICAL: If we know who the current user is, validate ownership
    if (currentUserId) {
      if (!parsed._owner_user_id) {
        // Legacy cache entry without ownership stamp — untrusted, clear it
        localStorage.removeItem('selectedTwitterAccount');
        localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
        return null;
      }
      if (parsed._owner_user_id !== currentUserId) {
        // Cache belongs to a different user — cross-user leak prevention
        localStorage.removeItem('selectedTwitterAccount');
        localStorage.removeItem(TEAM_CONTEXT_STORAGE_KEY);
        return null;
      }
    }

    return parsed;
  } catch {
    return null;
  }
};

const buildCachedAccountFallback = ({ fallbackTeamId = null, requireTeamAccount = false, currentUserId = null } = {}) => {
  const cached = getStoredSelectedAccount(currentUserId);
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

// --- Provider component ---

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
  // NOTE: We do NOT set selectedAccount here without knowing who the user is.
  // The fetch effect (Step 2) will handle restoring from cache with user validation.
  useEffect(() => {
    // If no user yet (auth still loading), skip.
    // Once user is known, Step 2 will load the correct account.
    if (!user?.id) return;

    const parsed = getStoredSelectedAccount(user.id);
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
  }, [user?.id]);

  const updateSelectedAccount = async (account) => {
    setSelectedAccount(account);
    if (account) {
      const selectedTeamId = account.team_id || account.teamId || null;
      localStorage.setItem('selectedTwitterAccount', JSON.stringify(normalizeAccountForStorage(account, selectedTeamId, user?.id)));

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

    // CRITICAL: When a new user logs in, clear any cached account that belongs to a different user.
    // This prevents cross-user data leaks via shared localStorage.
    const cached = getStoredSelectedAccount(user.id);
    if (!cached) {
      // Either no cache or cache belonged to a different user (already cleared by getStoredSelectedAccount)
      setSelectedAccount(null);
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
            currentUserId: user?.id,
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
          // Personal (non-team) account fetch
          let apiSucceeded = false;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const personalResponse = await fetch(`${apiBaseUrl}/api/twitter/status`, {
              credentials: 'include',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (personalResponse.ok) {
              apiSucceeded = true;
              const personalData = await personalResponse.json();
              const rawAccounts = Array.isArray(personalData?.accounts) ? personalData.accounts : [];
              accountsData = rawAccounts.map((account) => ({
                ...account,
                team_id: null,
              }));
              // API succeeded — even if empty, this is the truth. Do NOT fall back to cache.
            } else {
              accountsData = fallbackToCachedScope(false);
            }
          } catch {
            // Network error — cache fallback is acceptable here
            accountsData = fallbackToCachedScope(false);
          }

          // CRITICAL: Only use cache fallback for network/server errors, NOT when API returned empty
          if (accountsData.length === 0 && !apiSucceeded) {
            accountsData = fallbackToCachedScope(false);
          }
        }

        // Cache fallback removed — we trust the API response.
        // Stale localStorage data from other users must never be used as account source.

        setAccounts(accountsData);

        if (accountsData.length > 0) {
          const savedAccount = getStoredSelectedAccount(user?.id);
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
            JSON.stringify(normalizeAccountForStorage(accountToSelect, selectedTeamId, user?.id))
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
          currentUserId: user?.id,
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

  const contextValue = useMemo(() => ({
    selectedAccount,
    setSelectedAccount: updateSelectedAccount,
    accounts,
    loading,
    getCurrentAccountId: () => getCurrentAccountId(selectedAccount),
    isTeamMode: Boolean(userTeamStatus),
    activeTeamId,
    refreshTeamStatus,
    refreshAccounts,
  }), [selectedAccount, accounts, loading, userTeamStatus, activeTeamId]);

  return (
    <AccountContext.Provider value={contextValue}>
      {children}
    </AccountContext.Provider>
  );
};
