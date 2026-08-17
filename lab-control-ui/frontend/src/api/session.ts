// Frontend session check (T043). No dedicated "whoami" endpoint exists in
// contracts/api.md -- any authenticated route doubles as a session probe,
// so this uses the cheapest one (/api/providers) rather than adding a new
// backend endpoint for a one-bit answer.

import { ApiError, fetchProviders } from './client.js';

export async function hasValidSession(): Promise<boolean> {
  try {
    await fetchProviders();
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err;
  }
}
