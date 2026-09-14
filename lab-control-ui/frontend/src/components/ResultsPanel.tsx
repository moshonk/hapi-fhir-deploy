// Renders a seed/benchmark/report run's result artifacts (GET
// /api/runs/:runId/artifacts) -- distinct from LogViewer's raw process
// output. Each file is its own collapsible section so a long k6-summary.json
// doesn't bury report.md (or vice versa); the first file starts expanded
// since that's almost always the one worth seeing first (k6-fhir-summary.json
// or report.md, per RUN_DIR_JSON_FILES'/the report branch's ordering on the
// backend).

import type { ArtifactFile } from '../api/types.js';

/** Action names that can ever have result artifacts (mirrors the backend's
 * RUN_DIR_ACTIONS in routes/runs.ts) -- used to decide whether to even show
 * this panel/fetch for a given run, so e.g. "up"/"expose-fhir" don't render
 * a permanent, always-empty "No result artifacts yet." */
export const RESULT_ARTIFACT_ACTIONS = new Set(['seed', 'benchmark', 'report']);

export interface ResultsPanelProps {
  files: ArtifactFile[];
}

function renderContent(file: ArtifactFile): string {
  if (file.kind === 'json') {
    return JSON.stringify(file.content, null, 2);
  }
  return String(file.content);
}

export function ResultsPanel({ files }: ResultsPanelProps) {
  if (files.length === 0) {
    return <p className="results-panel-empty">No result artifacts yet.</p>;
  }

  return (
    <div className="results-panel">
      {files.map((file, index) => (
        <details key={file.name} className="results-panel-file" open={index === 0}>
          <summary>{file.name}</summary>
          <pre className="results-panel-content">{renderContent(file)}</pre>
        </details>
      ))}
    </div>
  );
}
