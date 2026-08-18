// T033: live log viewer consuming the SSE stream. Uses the browser's native
// EventSource, which auto-reconnects on drop -- combined with the backend
// replaying the log on connect (capped, see backend/src/actions/runner.ts's
// readLogTail), a reload or a dropped connection loses nothing (FR-008)
// short of the very oldest lines of a degenerate run.
//
// Root-caused live: the previous version called `setLines((prev) =>
// [...prev, event.data])` once per SSE `log` event -- an O(n) array copy
// EVERY event, O(n^2) total across a replay burst. A real run that logged
// at ~2,300 lines/sec for a few minutes (544K lines total) froze the tab
// for minutes on every page reload, because reconnecting replayed the
// whole backlog as individual events. The backend now caps that replay
// burst, but a live-tailed run producing output at a similar rate would
// still hit the same O(n^2) wall while connected and watching -- so this
// component ALSO: (a) batches incoming lines into a ref and flushes to
// state at most once per animation frame instead of once per event, and
// (b) caps how many lines it keeps/renders, dropping the oldest, so the
// DOM never has to hold an unbounded <pre> either.
//
// Callers MUST render this with `key={runId}` (see RunHistory/LabDashboard)
// so switching to a different run remounts fresh state instead of this
// component resetting it imperatively inside an effect.

import { useEffect, useEffectEvent, useRef, useState } from 'react';

export interface LogViewerProps {
  runId: string;
  onStatus?: (status: 'succeeded' | 'failed') => void;
}

/** Lines kept/rendered client-side, oldest dropped first. Independent of
 * (and smaller than) the backend's own replay cap -- this bounds the DOM
 * and this component's own state regardless of how the lines arrived
 * (replay burst or a live run logging just as fast while connected). */
const MAX_RENDERED_LINES = 2000;

export function LogViewer({ runId, onStatus }: LogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [omittedCount, setOmittedCount] = useState(0);
  const [status, setStatus] = useState<'streaming' | 'succeeded' | 'failed'>('streaming');
  const containerRef = useRef<HTMLPreElement>(null);

  // Buffered outside React state: appended synchronously by every SSE
  // event (cheap, O(1) push), flushed into state at most once per
  // animation frame -- turning a burst of thousands of events into a
  // small, bounded number of renders instead of one render per event.
  const pendingRef = useRef<string[]>([]);
  const flushScheduledRef = useRef(false);

  // Always calls the latest `onStatus` without making it a reactive
  // dependency of the effect below (react-hooks/refs forbids the older
  // "assign to a ref during render" pattern for this).
  const notifyStatus = useEffectEvent((finalStatus: 'succeeded' | 'failed') => {
    onStatus?.(finalStatus);
  });

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/stream`, { withCredentials: true });

    const flush = () => {
      flushScheduledRef.current = false;
      if (pendingRef.current.length === 0) return;
      const incoming = pendingRef.current;
      pendingRef.current = [];

      setLines((prev) => {
        const combined = prev.length > 0 ? prev.concat(incoming) : incoming;
        if (combined.length <= MAX_RENDERED_LINES) return combined;
        const overflow = combined.length - MAX_RENDERED_LINES;
        setOmittedCount((n) => n + overflow);
        return combined.slice(overflow);
      });
    };

    source.addEventListener('log', (event: MessageEvent<string>) => {
      pendingRef.current.push(event.data);
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        requestAnimationFrame(flush);
      }
    });
    source.addEventListener('status', (event: MessageEvent<string>) => {
      flush();
      const finalStatus = event.data === 'succeeded' ? 'succeeded' : 'failed';
      setStatus(finalStatus);
      notifyStatus(finalStatus);
      source.close();
    });
    source.onerror = () => {
      // EventSource retries automatically; nothing to do here beyond not
      // crashing the component.
    };

    return () => source.close();
  }, [runId]);

  useEffect(() => {
    containerRef.current?.scrollTo(0, containerRef.current.scrollHeight);
  }, [lines]);

  return (
    <div className="log-viewer" aria-live="polite" aria-label={`Log for run ${runId}`}>
      <p className={`log-status log-status-${status}`}>{status}</p>
      {omittedCount > 0 && (
        <p className="log-truncated-notice">
          {omittedCount} earlier line(s) not shown (kept to the most recent {MAX_RENDERED_LINES}) --
          the full log is still captured on disk regardless.
        </p>
      )}
      <pre ref={containerRef} className="log-content">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
