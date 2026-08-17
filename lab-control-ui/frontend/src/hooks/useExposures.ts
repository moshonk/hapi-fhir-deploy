import { useCallback, useEffect, useState } from 'react';
import { fetchExposures } from '../api/client.js';
import type { ExposureRecord } from '../api/types.js';

// Polls GET /api/labs/:id/exposures so the "once exposed, show a link (and
// credentials, if applicable)" panel (LabDashboard.tsx) reflects reality
// even without an action just having run -- e.g. after a page reload, or
// once someone else's unexpose-* closes it. Mirrors usePrerequisites.ts's
// shape; `refresh()` is exposed so LabDashboard can force an immediate
// re-check right after an expose-*/unexpose-* run finishes instead of
// waiting out the poll interval.
export function useExposures(labId: string, pollIntervalMs = 15_000) {
  const [exposures, setExposures] = useState<ExposureRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchExposures(labId)
      .then((records) => {
        setExposures(records);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [labId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(timer);
  }, [refresh, pollIntervalMs]);

  return { exposures, error, refresh };
}
