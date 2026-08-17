// Shows a link (and credentials, if applicable) for each currently-exposed
// service, sourced verbatim from GET /api/labs/:id/exposures -- this
// component makes no independent judgment about what's reachable (mirrors
// PrerequisitePanel.tsx's relay-only stance). Renders nothing once nothing
// is exposed, rather than a row of "not exposed" noise -- the Actions list
// above already shows expose-*/unexpose-* as buttons.

import type { ExposureRecord } from '../api/types.js';

export interface ExposurePanelProps {
  exposures: ExposureRecord[] | null;
  error: string | null;
}

export function ExposurePanel({ exposures, error }: ExposurePanelProps) {
  if (error) return <p className="error">Could not check public exposures: {error}</p>;
  if (!exposures) return null;

  const exposed = exposures.filter((e) => e.exposed);
  if (exposed.length === 0) return null;

  return (
    <section aria-label="Public exposures" className="exposure-panel">
      <h2>Publicly exposed</h2>
      <ul className="exposure-list">
        {exposed.map((e) => (
          <li key={e.id} className="exposure-item">
            <span className="exposure-label">{e.label}:</span>{' '}
            <a href={e.url} target="_blank" rel="noopener noreferrer">
              {e.url}
            </a>
            {e.credentialsAvailable && (
              <p className="exposure-credentials">
                Login: <code>{e.username}</code> / <code>{e.password}</code>
              </p>
            )}
            {e.credentialsAvailable === false && e.credentialsReason && (
              <p className="exposure-credentials-unavailable">{e.credentialsReason}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
