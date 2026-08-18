// Root-caused live: the previous implementation called
// `setLines((prev) => [...prev, event.data])` once per SSE `log` event --
// O(n) per event, O(n^2) across a burst -- which froze the tab for minutes
// against a real run that produced hundreds of thousands of lines. This
// asserts the fix holds: a burst of events collapses into a bounded number
// of renders, and rendered lines are capped (oldest dropped, with a visible
// notice), regardless of how many events actually arrived.

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogViewer } from '../src/components/LogViewer.js';

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Listener[]>();
  closed = false;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }

  close() {
    this.closed = true;
  }
}

describe('LogViewer', () => {
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    FakeEventSource.instances = [];
    rafCallbacks = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    // jsdom doesn't implement Element.scrollTo -- a real browser API this
    // component uses to keep the log pinned to the bottom, unrelated to
    // what this suite is testing.
    Element.prototype.scrollTo = vi.fn();
    // Deterministic, manually-flushed rAF instead of relying on real frame
    // timing -- runFrame() below drives it explicitly.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runFrame() {
    const pending = rafCallbacks;
    rafCallbacks = [];
    act(() => {
      for (const cb of pending) cb(0);
    });
  }

  it('collapses a burst of many events into lines, capped at the render limit', () => {
    render(<LogViewer runId="run-1" />);
    const source = FakeEventSource.instances[0];

    // Simulate a degenerate run: far more lines than MAX_RENDERED_LINES
    // (2000) arriving as a single synchronous burst, the way a replay-on-
    // connect burst (or a live run logging just as fast) would.
    act(() => {
      for (let i = 0; i < 2500; i++) {
        source.emit('log', `line-${i}`);
      }
    });
    // Only ONE animation frame was scheduled for the whole burst -- proof
    // this isn't one render per event.
    expect(rafCallbacks.length).toBe(1);
    runFrame();

    // The most recent lines survive; the oldest 500 were dropped.
    expect(screen.getByText(/line-2499/)).toBeInTheDocument();
    expect(screen.queryByText(/^line-0$/m)).not.toBeInTheDocument();
    expect(screen.getByText(/500 earlier line\(s\) not shown/)).toBeInTheDocument();
  });

  it('shows no truncation notice when under the render cap', () => {
    render(<LogViewer runId="run-2" />);
    const source = FakeEventSource.instances[0];

    act(() => {
      source.emit('log', 'hello');
      source.emit('log', 'world');
    });
    runFrame();

    expect(screen.getByText(/hello/)).toBeInTheDocument();
    expect(screen.queryByText(/earlier line\(s\) not shown/)).not.toBeInTheDocument();
  });

  it('flushes pending lines and reports status on the status event', () => {
    const onStatus = vi.fn();
    render(<LogViewer runId="run-3" onStatus={onStatus} />);
    const source = FakeEventSource.instances[0];

    act(() => {
      source.emit('log', 'last line');
      source.emit('status', 'succeeded');
    });

    expect(screen.getByText('last line')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(onStatus).toHaveBeenCalledWith('succeeded');
    expect(source.closed).toBe(true);
  });
});
