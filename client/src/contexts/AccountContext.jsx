import { createContext, useContext } from 'react';

export const TEAM_CONTEXT_STORAGE_KEY = 'activeTeamContext';
export const ACCOUNT_SCOPE_CHANGED_EVENT = 'suitegenie:account-scope-changed';

const AccountContext = createContext();

// Helper to get current account ID
export const getCurrentAccountId = (selectedAccount) => {
  if (!selectedAccount) return null;
  return selectedAccount.id || selectedAccount.account_id || null;
};

export const useAccount = () => {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
};

export default AccountContext;
