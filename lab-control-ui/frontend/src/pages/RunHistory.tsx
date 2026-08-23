// T034: past runs for a lab (FR-009), each individually viewable including
// the configuration that produced it and its full captured output.

import { useEffect, useState } from 'react';
import { fetchRun, fetchRunArtifacts, fetchRunsForLab } from '../api/client.js';
import type { ActionRunDetail, ActionRunSummary, RunArtifacts } from '../api/types.js';
import { LogViewer } from '../components/LogViewer.js';
import { RESULT_ARTIFACT_ACTIONS, ResultsPanel } from '../components/ResultsPanel.js';
import { DURATION_TRACKED_ACTIONS, RunDuration } from '../components/RunDuration.js';

export interface RunHistoryProps {
  labId: string;
  /** Bump this to force a refresh after a new run is triggered elsewhere. */
  refreshKey: number;
}

// GET /api/labs/:id/runs returns this lab's entire run history in one
// response (newest first, per contracts/api.md), so pagination here is
// purely a client-side windowing of that array -- no backend/API change
// needed to keep a long-lived lab's history from turning into one long
// scroll.
const PAGE_SIZE = 10;

export function RunHistory({ labId, refreshKey }: RunHistoryProps) {
  const [runs, setRuns] = useState<ActionRunSummary[]>([]);
  const [selected, setSelected] = useState<ActionRunDetail | null>(null);
  const [results, setResults] = useState<RunArtifacts | null>(null);
  const [page, setPage] = useState(0);
  // Tracks the labId `page` was last reset for, so a lab switch can be
  // detected and reset during render (React's "adjusting state when a prop
  // changes" pattern) instead of an effect -- takes effect in the same
  // render rather than causing an extra one. A same-lab refresh (new run
  // triggered, refreshKey bump) deliberately leaves `page` alone -- an
  // operator paged back into older history shouldn't get yanked back to
  // page 1 just because a new run started.
  const [pageResetForLabId, setPageResetForLabId] = useState(labId);
  if (labId !== pageResetForLabId) {
    setPageResetForLabId(labId);
    setPage(0);
  }

  useEffect(() => {
    fetchRunsForLab(labId)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [labId, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  // Clamped inline (not stored/effect-driven) so a history that got shorter
  // than the page the operator was on -- e.g. this lab's runs were pruned
  // elsewhere -- can't strand `page` past the last real page.
  const currentPage = Math.min(page, totalPages - 1);
  const pagedRuns = runs.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  async function refreshResults(runId: string) {
    try {
      setResults(await fetchRunArtifacts(runId));
    } catch {
      setResults(null);
    }
  }

  async function select(runId: string) {
    const run = await fetchRun(runId);
    setSelected(run);
    setResults(null);
    if (RESULT_ARTIFACT_ACTIONS.has(run.action_name)) {
      void refreshResults(runId);
    }
  }

  return (
    <section aria-label="Run history">
      <h2>Run history</h2>
      {runs.length === 0 && <p>No runs yet.</p>}
      <ul className="run-history-list">
        {pagedRuns.map((run) => (
          <li key={run.id}>
            <button type="button" onClick={() => void select(run.id)}>
              {run.action_name} — {run.status}
              {run.started_at ? ` (${new Date(run.started_at).toLocaleString()})` : ''}
              {DURATION_TRACKED_ACTIONS.has(run.action_name) && (
                <RunDuration startedAt={run.started_at} endedAt={run.ended_at} />
              )}
            </button>
          </li>
        ))}
      </ul>
      {runs.length > PAGE_SIZE && (
        <nav className="run-history-pagination" aria-label="Run history pages">
          <button
            type="button"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 0}
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
          >
            Next
          </button>
        </nav>
      )}
      {selected && (
        <div className="run-detail">
          <h3>
            {selected.action_name} ({selected.status})
            {DURATION_TRACKED_ACTIONS.has(selected.action_name) && (
              <RunDuration startedAt={selected.started_at} endedAt={selected.ended_at} />
            )}
          </h3>
          <pre className="command-preview">{selected.command_preview}</pre>
          {RESULT_ARTIFACT_ACTIONS.has(selected.action_name) && (
            <>
              <h4>Results</h4>
              <ResultsPanel files={results?.files ?? []} />
            </>
          )}
          <h4>Log</h4>
          <LogViewer
            key={selected.id}
            runId={selected.id}
            onStatus={() => void refreshResults(selected.id)}
          />
        </div>
      )}
    </section>
  );
}
