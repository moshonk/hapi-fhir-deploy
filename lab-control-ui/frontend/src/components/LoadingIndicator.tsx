// Visual loading state for async work that blocks the whole page --
// currently App.tsx's session check and initial provider/lab fetch. A
// spinner (not just text) makes it obvious the app is doing something
// rather than having failed to render, on connections slow enough for the
// initial requests to take a moment (real GCP-lab-scale round trips through
// the reverse proxy, per research.md §7).

export interface LoadingIndicatorProps {
  label: string;
}

export function LoadingIndicator({ label }: LoadingIndicatorProps) {
  return (
    <div className="loading-indicator" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
