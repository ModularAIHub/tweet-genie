const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

export const saveDraft = (key, data, { version = 1 } = {}) => {
  if (!canUseStorage() || !key) return false;

  try {
    const payload = {
      v: version,
      savedAt: Date.now(),
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn(`[draftStorage] Failed to save draft for key "${key}"`, error);
    return false;
  }
};

export const loadDraft = (key, { version = 1, ttlMs = null } = {}) => {
  if (!canUseStorage() || !key) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(key);
      return null;
    }

    if (parsed.v !== version) {
      window.localStorage.removeItem(key);
      return null;
    }

    if (ttlMs && Number.isFinite(ttlMs)) {
      const savedAt = Number(parsed.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > ttlMs) {
        window.localStorage.removeItem(key);
        return null;
      }
    }

    return {
      data: parsed.data ?? null,
      savedAt: Number(parsed.savedAt || 0) || null,
      version: parsed.v,
    };
  } catch (error) {
    console.warn(`[draftStorage] Failed to load draft for key "${key}"`, error);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup errors.
    }
    return null;
  }
};

export const clearDraft = (key) => {
  if (!canUseStorage() || !key) return false;

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[draftStorage] Failed to clear draft for key "${key}"`, error);
    return false;
  }
};

