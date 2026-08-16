// T040: pass/warn/fail rows sourced verbatim from GET /api/prerequisites,
// which itself relays `scripts/lab doctor` verbatim -- this component makes
// no independent judgment about tool availability (FR-010). Presentational
// only: LabDashboard owns the fetch/poll loop (usePrerequisites) so
// ActionList's gating hint and this display share one set of results
// instead of polling twice.

import type { PrereqCheck } from '../api/types.js';

export interface PrerequisitePanelProps {
  checks: PrereqCheck[] | null;
  error: string | null;
}

export function PrerequisitePanel({ checks, error }: PrerequisitePanelProps) {
  if (error) return <p className="error">Could not load prerequisites: {error}</p>;
  if (!checks) return <p>Checking prerequisites...</p>;

  return (
    <table className="prerequisite-panel" aria-label="Prerequisites">
      <tbody>
        {checks.map((check) => (
          <tr key={check.id} className={`prereq-row prereq-${check.status}`}>
            <td className="prereq-status" aria-label={check.status}>
              {check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗'}
            </td>
            <td className="prereq-label">{check.label}</td>
            <td className="prereq-detail">{check.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
