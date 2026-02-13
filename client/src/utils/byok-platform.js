// Utility to fetch BYOK/platform mode for the current user from new-platform
import axios from 'axios';

const PLATFORM_API_URL = import.meta.env.VITE_PLATFORM_API_URL || 'http://localhost:3000/api';
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_PLATFORM_TIMEOUT_MS || 2500);
const PREF_CACHE_TTL_MS = Number(import.meta.env.VITE_BYOK_PREF_CACHE_TTL_MS || 60000);
const KEYS_CACHE_TTL_MS = Number(import.meta.env.VITE_BYOK_KEYS_CACHE_TTL_MS || 60000);
const FAILURE_COOLDOWN_MS = Number(import.meta.env.VITE_BYOK_FAILURE_COOLDOWN_MS || 30000);

const preferenceCache = {
  value: 'platform',
  fetchedAt: 0,
};

const keysCache = {
  value: [],
  fetchedAt: 0,
};

let lastNetworkFailureAt = 0;
let networkFailureLogged = false;

function now() {
  return Date.now();
}

function isFresh(cache, ttlMs) {
  return cache.fetchedAt > 0 && now() - cache.fetchedAt <= ttlMs;
}

function inFailureCooldown() {
  return lastNetworkFailureAt > 0 && now() - lastNetworkFailureAt <= FAILURE_COOLDOWN_MS;
}

function markNetworkFailure(scopeLabel) {
  lastNetworkFailureAt = now();
  if (networkFailureLogged) return;
  networkFailureLogged = true;
  console.warn(
    `[BYOK] Platform API unavailable for ${scopeLabel}. Using fallback for ${FAILURE_COOLDOWN_MS}ms.`
  );
}

function clearNetworkFailure() {
  lastNetworkFailureAt = 0;
  networkFailureLogged = false;
}

function isNetworkError(error) {
  if (!error) return false;
  if (!error.response && (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED')) {
    return true;
  }
  const message = String(error.message || '').toLowerCase();
  return message.includes('network') || message.includes('connection refused');
}

async function fetchPlatform(path, scopeLabel) {
  if (inFailureCooldown()) {
    return null;
  }

  try {
    const response = await axios.get(`${PLATFORM_API_URL}${path}`, {
      withCredentials: true,
      timeout: REQUEST_TIMEOUT_MS,
    });
    clearNetworkFailure();
    return response;
  } catch (error) {
    if (isNetworkError(error)) {
      markNetworkFailure(scopeLabel);
      return null;
    }
    throw error;
  }
}

export async function fetchApiKeyPreference() {
  if (isFresh(preferenceCache, PREF_CACHE_TTL_MS)) {
    return preferenceCache.value;
  }

  try {
    const response = await fetchPlatform('/byok/preference', 'preference');
    if (!response) {
      return preferenceCache.value || 'platform';
    }

    const apiKeyPreference = response?.data?.api_key_preference === 'byok' ? 'byok' : 'platform';
    preferenceCache.value = apiKeyPreference;
    preferenceCache.fetchedAt = now();
    return apiKeyPreference;
  } catch (error) {
    const status = error?.response?.status;
    if (status && status !== 401 && status !== 403 && status !== 404) {
      console.warn('[BYOK] Failed to fetch API key preference:', error.message || error);
    }
    return preferenceCache.value || 'platform';
  }
}

export async function fetchByokKeys() {
  if (isFresh(keysCache, KEYS_CACHE_TTL_MS)) {
    return keysCache.value;
  }

  try {
    const response = await fetchPlatform('/byok/keys', 'keys');
    if (!response) {
      return keysCache.value || [];
    }

    const keys = Array.isArray(response?.data?.keys) ? response.data.keys : [];
    keysCache.value = keys;
    keysCache.fetchedAt = now();
    return keys;
  } catch (error) {
    const status = error?.response?.status;
    if (status && status !== 401 && status !== 403 && status !== 404) {
      console.warn('[BYOK] Failed to fetch BYOK keys:', error.message || error);
    }
    return keysCache.value || [];
  }
}
