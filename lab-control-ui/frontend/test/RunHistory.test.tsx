// Client-side pagination of a lab's run history: GET /api/labs/:id/runs
// returns the whole history in one response (contracts/api.md), so long
// histories are windowed into pages here rather than rendered as one long
// scroll.

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunHistory } from '../src/pages/RunHistory.js';
import type { ActionRunSummary } from '../src/api/types.js';

function run(overrides: Partial<ActionRunSummary> = {}): ActionRunSummary {
  return {
    id: 'run-1',
    action_name: 'seed',
    status: 'succeeded',
    started_at: null,
    ended_at: null,
    exit_code: 0,
    ...overrides,
  };
}

function manyRuns(count: number): ActionRunSummary[] {
  return Array.from({ length: count }, (_, i) => run({ id: `run-${i}`, action_name: `run-${i}` }));
}

let fetchRunsForLabResult: Promise<ActionRunSummary[]> = Promise.resolve([]);

vi.mock('../src/api/client.js', () => ({
  fetchRunsForLab: () => fetchRunsForLabResult,
  fetchRun: vi.fn(),
  fetchRunArtifacts: vi.fn(),
}));

describe('RunHistory pagination', () => {
  it('shows no pagination controls when the history fits on one page', async () => {
    fetchRunsForLabResult = Promise.resolve(manyRuns(10));
    render(<RunHistory labId="lab-1" refreshKey={0} />);

    await waitFor(() => expect(screen.getByText('run-0 — succeeded')).toBeInTheDocument());
    expect(screen.queryByRole('navigation', { name: /run history pages/i })).not.toBeInTheDocument();
  });

  it('splits a longer history into pages of 10 and pages through it', async () => {
    fetchRunsForLabResult = Promise.resolve(manyRuns(25));
    render(<RunHistory labId="lab-1" refreshKey={0} />);

    await waitFor(() => expect(screen.getByText('run-0 — succeeded')).toBeInTheDocument());
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('run-9 — succeeded')).toBeInTheDocument();
    expect(screen.queryByText('run-10 — succeeded')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    screen.getByRole('button', { name: 'Next' }).click();

    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument());
    expect(screen.getByText('run-10 — succeeded')).toBeInTheDocument();
    expect(screen.getByText('run-19 — succeeded')).toBeInTheDocument();
    expect(screen.queryByText('run-9 — succeeded')).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Next' }).click();

    await waitFor(() => expect(screen.getByText('Page 3 of 3')).toBeInTheDocument());
    expect(screen.getByText('run-24 — succeeded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('resets to page 1 when switching to a different lab', async () => {
    fetchRunsForLabResult = Promise.resolve(manyRuns(25));
    const { rerender } = render(<RunHistory labId="lab-1" refreshKey={0} />);

    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());
    screen.getByRole('button', { name: 'Next' }).click();
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument());

    fetchRunsForLabResult = Promise.resolve(manyRuns(25));
    rerender(<RunHistory labId="lab-2" refreshKey={0} />);

    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());
  });
});
