// Ticks while a run is in progress, then freezes at the final elapsed time
// once ended_at is supplied -- and never renders anything before started_at
// exists (a pending run that hasn't actually started yet).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RunDuration } from '../src/components/RunDuration.js';

describe('RunDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when the run has not started yet', () => {
    const { container } = render(<RunDuration startedAt={null} endedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ticks upward once a second while endedAt is null', () => {
    render(<RunDuration startedAt="2026-01-01T00:00:00.000Z" endedAt={null} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();

    // vi's fake timers advance the system clock as they advance, so a
    // single advanceTimersByTime is both "time passes" and "the interval
    // fires" -- no separate setSystemTime needed (and combining the two
    // would double-count the elapsed time).
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByText('00:07')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(58000);
    });
    expect(screen.getByText('01:05')).toBeInTheDocument();
  });

  it('locks at the final duration once endedAt is set, and stops ticking', () => {
    const { rerender } = render(
      <RunDuration startedAt="2026-01-01T00:00:00.000Z" endedAt={null} />,
    );

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.getByText('00:30')).toBeInTheDocument();

    rerender(
      <RunDuration
        startedAt="2026-01-01T00:00:00.000Z"
        endedAt="2026-01-01T00:00:42.000Z"
      />,
    );
    expect(screen.getByText('00:42')).toBeInTheDocument();

    // The clock keeps moving, but the locked duration must not change.
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });
    expect(screen.getByText('00:42')).toBeInTheDocument();
  });

  it('renders hours once a run passes an hour', () => {
    render(
      <RunDuration
        startedAt="2026-01-01T00:00:00.000Z"
        endedAt="2026-01-01T01:02:03.000Z"
      />,
    );
    expect(screen.getByText('1:02:03')).toBeInTheDocument();
  });
});
