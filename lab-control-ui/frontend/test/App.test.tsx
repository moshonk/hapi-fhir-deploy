// Loading indicator during initial page load: a spinner (role="status")
// must be visible while the session check / provider / saved-lab fetches
// are still in flight, and gone once they've all resolved.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';
import { gcpProviderFixture } from './fixtures/gcpProvider.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const sessionDeferred = deferred<boolean>();
const providersDeferred = deferred<(typeof gcpProviderFixture)[]>();
const labsDeferred = deferred<[]>();

vi.mock('../src/api/session.js', () => ({
  hasValidSession: () => sessionDeferred.promise,
}));

vi.mock('../src/api/client.js', () => ({
  fetchProviders: () => providersDeferred.promise,
  fetchLabs: () => labsDeferred.promise,
  fetchRunsForLab: () => Promise.resolve([]),
  logout: () => Promise.resolve(),
}));

describe('App initial load', () => {
  it('shows a loading indicator until the session check and initial fetches resolve', async () => {
    render(<App />);

    // Still checking the session -- spinner visible, nothing else rendered.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Lab Control UI')).not.toBeInTheDocument();

    sessionDeferred.resolve(true);

    // Session confirmed but providers/labs haven't resolved yet -- still loading.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByText('Lab Control UI')).not.toBeInTheDocument();

    providersDeferred.resolve([gcpProviderFixture]);

    // Providers resolved but labs haven't -- still loading.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByText('Lab Control UI')).not.toBeInTheDocument();

    labsDeferred.resolve([]);

    // Everything resolved -- spinner gone, real UI rendered.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Lab Control UI')).toBeInTheDocument();
  });
});
