// Utility to fetch BYOK/platform mode for the current user
import api from './api';

export async function fetchApiKeyPreference() {
  try {
    const response = await api.get('/api/byok/preference');
    return response.data.api_key_preference || 'platform';
  } catch (error) {
    console.error('Failed to fetch API key preference:', error);
    return 'platform';
  }
}
