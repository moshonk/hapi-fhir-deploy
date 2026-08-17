// T033: live log viewer consuming the SSE stream. Uses the browser's native
// EventSource, which auto-reconnects on drop -- combined with the backend
// always replaying the full log on connect (research.md §2), a reload or a
// dropped connection loses nothing (FR-008).
//
// Callers MUST render this with `key={runId}` (see RunHistory/LabDashboard)
// so switching to a different run remounts fresh state instead of this
// component resetting it imperatively inside an effect.

import { useEffect, useEffectEvent, useRef, useState } from 'react';

export interface LogViewerProps {
  runId: string;
  onStatus?: (status: 'succeeded' | 'failed') => void;
}

export function LogViewer({ runId, onStatus }: LogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<'streaming' | 'succeeded' | 'failed'>('streaming');
  const containerRef = useRef<HTMLPreElement>(null);

  // Always calls the latest `onStatus` without making it a reactive
  // dependency of the effect below (react-hooks/refs forbids the older
  // "assign to a ref during render" pattern for this).
  const notifyStatus = useEffectEvent((finalStatus: 'succeeded' | 'failed') => {
    onStatus?.(finalStatus);
  });

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/stream`, { withCredentials: true });

    source.addEventListener('log', (event: MessageEvent<string>) => {
      setLines((prev) => [...prev, event.data]);
    });
    source.addEventListener('status', (event: MessageEvent<string>) => {
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
      <pre ref={containerRef} className="log-content">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
