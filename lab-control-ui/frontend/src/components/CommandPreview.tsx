// T024: shows the exact scripts/lab command a configuration will produce
// (FR-003) via GET /api/labs/:id/preview -- never independently reconstructed
// client-side, so it can't drift from what triggering the action actually runs.
//
// Callers MUST render this with `key={`${labId}-${action}`}` if they want a
// clean "loading..." state when either changes; otherwise the previous
// command stays visible until the new one resolves (updates happen inside
// the fetch's async continuation, not synchronously in the effect body).

import { useEffect, useState } from 'react';
import { fetchCommandPreview } from '../api/client.js';

export interface CommandPreviewProps {
  labId: string;
  action: string;
}

export function CommandPreview({ labId, action }: CommandPreviewProps) {
  const [command, setCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCommandPreview(labId, action)
      .then((cmd) => {
        if (cancelled) return;
        setCommand(cmd);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setCommand(null);
      });
    return () => {
      cancelled = true;
    };
  }, [labId, action]);

  return (
    <div className="command-preview" aria-label={`Command preview for ${action}`}>
      <p className="command-preview-label">Equivalent command:</p>
      {error && <p className="error">{error}</p>}
      {!error && <pre>{command ?? 'loading...'}</pre>}
    </div>
  );
}
