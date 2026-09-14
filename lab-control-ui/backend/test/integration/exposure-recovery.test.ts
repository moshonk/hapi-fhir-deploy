// Boot-time recovery (exposureRecovery.ts, server.ts). Confirmed live three
// separate times in one session: every container redeploy kills every
// kubectl-port-forward-backed tunnel while the GCP firewall rule each one
// opened stays live, requiring the exact same "re-run expose-* by hand"
// dance each time. Asserts recoverExposuresOnBoot automates that: it
// re-runs expose-* (creating a normal, visible action_runs row) for every
// service whose firewall rule survived but whose tunnel didn't, and leaves
// everything else alone.

import { afterEach, describe, expect, it } from 'vitest';
import { recoverExposuresOnBoot } from '../../src/actions/exposureRecovery.js';
import { createLabConfiguration, listActionRunsForLab } from '../../src/db/queries.js';
import { buildTestApp } from './helpers.js';

const savedEnv = { ...process.env };

async function waitForRunCount(
  db: import('node:sqlite').DatabaseSync,
  labId: string,
  count: number,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listActionRunsForLab(db, labId).length >= count) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`expected ${count} run(s) for lab ${labId} within ${timeoutMs}ms`);
}

describe('recoverExposuresOnBoot', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('re-runs expose-fhir for a dead tunnel behind an open firewall rule, but leaves an already-live exposure and a never-exposed one alone', async () => {
    process.env.STUB_LAB_LINES = JSON.stringify([
      { id: 'fhir', label: 'HAPI FHIR', exposed: false, firewallRule: 'allow-hapi-fhir-8080-lab' },
      {
        id: 'prometheus',
        label: 'Prometheus',
        exposed: true,
        firewallRule: 'allow-prometheus-9090-lab',
        url: 'http://1.2.3.4:9090',
      },
      { id: 'grafana', label: 'Grafana', exposed: false },
    ]);
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { db, config } = buildTestApp();
    const lab = createLabConfiguration(db, {
      provider: 'gcp',
      name: 'recovery-test',
      fields: { project_id: 'my-project' },
    });

    await recoverExposuresOnBoot(db, config);
    await waitForRunCount(db, lab.id, 1);

    const runs = listActionRunsForLab(db, lab.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].action_name).toBe('expose-fhir');
  });

  it('re-runs nothing when every exposure is already live', async () => {
    process.env.STUB_LAB_LINES = JSON.stringify([
      { id: 'fhir', label: 'HAPI FHIR', exposed: true, firewallRule: 'allow-hapi-fhir-8080-lab' },
      {
        id: 'prometheus',
        label: 'Prometheus',
        exposed: true,
        firewallRule: 'allow-prometheus-9090-lab',
      },
      { id: 'grafana', label: 'Grafana', exposed: true, firewallRule: 'allow-grafana-3001-lab' },
    ]);
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { db, config } = buildTestApp();
    const lab = createLabConfiguration(db, {
      provider: 'gcp',
      name: 'recovery-test-2',
      fields: { project_id: 'my-project' },
    });

    await recoverExposuresOnBoot(db, config);
    // Give any (wrongly) spawned recovery a moment to show up before
    // asserting none did.
    await new Promise((r) => setTimeout(r, 200));
    expect(listActionRunsForLab(db, lab.id)).toHaveLength(0);
  });

  it('never throws when the exposures check itself fails (e.g. kubectl unreachable)', async () => {
    process.env.STUB_LAB_LINES = 'not valid json';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { db, config } = buildTestApp();
    createLabConfiguration(db, {
      provider: 'gcp',
      name: 'recovery-test-3',
      fields: { project_id: 'my-project' },
    });

    await expect(recoverExposuresOnBoot(db, config)).resolves.toBeUndefined();
  });
});
