// Renders each artifact file as its own section; JSON content is
// pretty-printed, text content shown verbatim; empty files shows a plain
// "nothing yet" message rather than an empty panel.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultsPanel } from '../src/components/ResultsPanel.js';
import type { ArtifactFile } from '../src/api/types.js';

describe('ResultsPanel', () => {
  it('shows a placeholder when there are no files yet', () => {
    render(<ResultsPanel files={[]} />);
    expect(screen.getByText(/No result artifacts yet/)).toBeInTheDocument();
  });

  it('renders a JSON file pretty-printed under its own name', () => {
    const files: ArtifactFile[] = [
      { name: 'k6-fhir-summary.json', kind: 'json', content: { concurrency_target: 100 } },
    ];
    render(<ResultsPanel files={files} />);
    expect(screen.getByText('k6-fhir-summary.json')).toBeInTheDocument();
    expect(screen.getByText(/"concurrency_target": 100/)).toBeInTheDocument();
  });

  it('renders a text file verbatim', () => {
    const files: ArtifactFile[] = [
      { name: 'report.md', kind: 'text', content: '# Report\n\nAll good.\n' },
    ];
    render(<ResultsPanel files={files} />);
    expect(screen.getByText('report.md')).toBeInTheDocument();
    expect(screen.getByText(/All good\./)).toBeInTheDocument();
  });

  it('renders multiple files, each collapsible, first one open', () => {
    const files: ArtifactFile[] = [
      { name: 'k6-fhir-summary.json', kind: 'json', content: { a: 1 } },
      { name: 'benchmark-metadata.json', kind: 'json', content: { b: 2 } },
    ];
    const { container } = render(<ResultsPanel files={files} />);
    const details = container.querySelectorAll('details');
    expect(details).toHaveLength(2);
    expect(details[0]).toHaveAttribute('open');
    expect(details[1]).not.toHaveAttribute('open');
  });
});
