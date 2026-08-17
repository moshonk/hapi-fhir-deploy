// Live-ticking elapsed-time display for a run, used for the long-running,
// duration-meaningful actions (seed, benchmark, report -- see
// DURATION_TRACKED_ACTIONS below) rather than every action, since e.g.
// expose-*/unexpose-* are effectively instantaneous and "up"/"down" already
// stream their own step-by-step progress.
//
// While `endedAt` is null, the displayed duration ticks once a second off
// the client clock; the moment `endedAt` is provided it is computed once
// from `endedAt - startedAt` and never changes again -- "locked" at
// whatever the run actually took, regardless of how long the component
// stays mounted afterward.

import { useEffect, useState } from 'react';

export interface RunDurationProps {
  startedAt: string | null;
  endedAt: string | null;
}

/** Action names this component is meant to be shown for (LabDashboard's
 * active-run panel and RunHistory both gate on this same set, so the
 * feature applies consistently in both places). */
export const DURATION_TRACKED_ACTIONS = new Set(['seed', 'benchmark', 'report']);

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function RunDuration({ startedAt, endedAt }: RunDurationProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endedAt || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt]);

  if (!startedAt) return null;

  const elapsedMs = endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : now - new Date(startedAt).getTime();

  return (
    <span
      className={`run-duration ${endedAt ? 'run-duration-final' : 'run-duration-live'}`}
      title={endedAt ? 'Final duration' : 'Elapsed so far'}
    >
      {formatDuration(elapsedMs)}
    </span>
  );
}
