import { createContext, useContext } from 'react';

const AuthContext = createContext();

let hasLoggedMissingAuthProvider = false;

const buildFallbackRedirectToLogin = () => () => {
  if (typeof window === 'undefined') return;
  const currentUrl = encodeURIComponent(window.location.href);
  const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in';
  window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
};

const AUTH_FALLBACK_CONTEXT = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
  logout: async () => {},
  checkAuthStatus: async () => {},
  redirectToLogin: buildFallbackRedirectToLogin(),
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    if (!hasLoggedMissingAuthProvider) {
      hasLoggedMissingAuthProvider = true;
      console.error('useAuth called outside AuthProvider. Falling back to unauthenticated context.');
    }
    return AUTH_FALLBACK_CONTEXT;
  }
  return context;
};

export default AuthContext;
