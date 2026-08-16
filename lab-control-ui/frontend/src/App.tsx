// Root component (T043's route guard target). Gates everything behind a
// valid session (FR-013), then loads the registered provider(s) -- GCP is
// the only one implemented, but nothing here assumes that; a second
// registered provider would just render as a second option (US5).

import { useEffect, useState } from 'react';
import { Login } from './pages/Login.js';
import { ConfigureLab } from './pages/ConfigureLab.js';
import { LabDashboard } from './pages/LabDashboard.js';
import { RunHistory } from './pages/RunHistory.js';
import { hasValidSession } from './api/session.js';
import { fetchLabs, fetchProviders, fetchRunsForLab, logout } from './api/client.js';
import type { ActionRunSummary, LabConfiguration, ProviderPublicShape } from './api/types.js';

type SessionState = 'checking' | 'loggedOut' | 'loggedIn';

export function App() {
  const [session, setSession] = useState<SessionState>('checking');
  const [providers, setProviders] = useState<ProviderPublicShape[]>([]);
  const [lab, setLab] = useState<LabConfiguration | null>(null);
  const [runs, setRuns] = useState<ActionRunSummary[]>([]);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  useEffect(() => {
    hasValidSession()
      .then((ok) => setSession(ok ? 'loggedIn' : 'loggedOut'))
      .catch(() => setSession('loggedOut'));
  }, []);

  useEffect(() => {
    if (session !== 'loggedIn') return;
    fetchProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
    // Story 1: land on the most-recently-edited saved configuration, if any,
    // so a returning operator doesn't start from scratch every visit.
    fetchLabs()
      .then((labs) => setLab(labs[0] ?? null))
      .catch(() => setLab(null));
  }, [session]);

  const labId = lab?.id;
  useEffect(() => {
    // `runs` is only ever read while `lab` is truthy (see the render guard
    // below), so there's nothing to reset here when it's null -- avoids a
    // synchronous setState at the top of the effect body.
    if (!labId) return;
    fetchRunsForLab(labId)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [labId, runsRefreshKey]);

  if (session === 'checking') return <p>Loading...</p>;
  if (session === 'loggedOut') return <Login onLoggedIn={() => setSession('loggedIn')} />;

  const provider = providers[0];
  if (!provider) return <p>Loading provider configuration...</p>;

  return (
    <div className="app">
      <header>
        <h1>Lab Control UI</h1>
        <button
          type="button"
          onClick={() => {
            void logout().then(() => setSession('loggedOut'));
          }}
        >
          Log out
        </button>
      </header>

      <ConfigureLab key={lab?.id ?? 'new'} provider={provider} lab={lab} onLabChange={setLab} />

      {lab && (
        <>
          <LabDashboard
            provider={provider}
            lab={lab}
            runs={runs}
            onRunTriggered={() => setRunsRefreshKey((k) => k + 1)}
          />
          <RunHistory labId={lab.id} refreshKey={runsRefreshKey} />
        </>
      )}
    </div>
  );
}
