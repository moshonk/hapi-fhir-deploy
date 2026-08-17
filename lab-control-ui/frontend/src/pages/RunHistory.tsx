// T034: past runs for a lab (FR-009), each individually viewable including
// the configuration that produced it and its full captured output.

import { useEffect, useState } from 'react';
import { fetchRun, fetchRunsForLab } from '../api/client.js';
import type { ActionRunDetail, ActionRunSummary } from '../api/types.js';
import { LogViewer } from '../components/LogViewer.js';

export interface RunHistoryProps {
  labId: string;
  /** Bump this to force a refresh after a new run is triggered elsewhere. */
  refreshKey: number;
}

export function RunHistory({ labId, refreshKey }: RunHistoryProps) {
  const [runs, setRuns] = useState<ActionRunSummary[]>([]);
  const [selected, setSelected] = useState<ActionRunDetail | null>(null);

  useEffect(() => {
    fetchRunsForLab(labId)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [labId, refreshKey]);

  async function select(runId: string) {
    setSelected(await fetchRun(runId));
  }

  return (
    <section aria-label="Run history">
      <h2>Run history</h2>
      {runs.length === 0 && <p>No runs yet.</p>}
      <ul className="run-history-list">
        {runs.map((run) => (
          <li key={run.id}>
            <button type="button" onClick={() => void select(run.id)}>
              {run.action_name} — {run.status}
              {run.started_at ? ` (${new Date(run.started_at).toLocaleString()})` : ''}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="run-detail">
          <h3>
            {selected.action_name} ({selected.status})
          </h3>
          <pre className="command-preview">{selected.command_preview}</pre>
          <LogViewer key={selected.id} runId={selected.id} />
        </div>
      )}
    </section>
  );
}
