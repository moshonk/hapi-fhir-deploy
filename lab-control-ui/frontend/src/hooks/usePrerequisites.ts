import { useCallback, useEffect, useState } from 'react';
import { fetchPrerequisites } from '../api/client.js';
import type { PrereqCheck } from '../api/types.js';

export function usePrerequisites(provider: string, pollIntervalMs = 30_000) {
  const [checks, setChecks] = useState<PrereqCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchPrerequisites(provider)
      .then(setChecks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [provider]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(timer);
  }, [refresh, pollIntervalMs]);

  return { checks, error, refresh };
}
