// Asserts commandBuilder + the GCP provider produce the exact invocation
// documented in specs/009-lab-control-ui/contracts/cli-action-map.md, one
// case per table row (T016). If this test and that doc ever diverge, one of
// them is wrong -- this is the guard against that drift.

import { describe, expect, it } from 'vitest';
import { gcpProvider } from '../../src/providers/gcp.js';
import { buildCommand, formatCommandPreview } from '../../src/actions/commandBuilder.js';

const FIELDS = {
  lab_name: 'hapi-fhir-lab',
  project_id: 'my-project',
  region: 'us-central1',
  zone: 'us-central1-a',
  kubernetes_version: '1.35.6-gke.1258000',
  node_size: 'e2-standard-4',
  cluster_node_count: 3,
  cluster_min_nodes: 3,
  cluster_max_nodes: 6,
  db_edition: 'ENTERPRISE',
  db_sku: 'db-custom-2-7680',
  db_disk_size_gb: 256,
  ttl_hours: 4,
  expose_source_ranges: '0.0.0.0/0',
  pause_replicas: 5,
  households: 33333,
  individuals_per_household: 3,
  echis_seed: 12345,
  k6_profile: 'load',
  echis_tier: 'T3',
};

const CONTEXT = {
  cliRunLabel: 'hapi-fhir-lab-20260101-000000',
  fhirBaseUrl: 'http://localhost:8080/fhir',
};

function run(action: string, overrides: Record<string, unknown> = {}) {
  return buildCommand(gcpProvider, action, { ...FIELDS, ...overrides }, CONTEXT);
}

describe('commandBuilder x gcpProvider (contracts/cli-action-map.md)', () => {
  it('up', () => {
    expect(run('up').argv).toEqual([
      'up',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--auto-approve',
      '--var',
      'project_id=my-project',
      '--var',
      'region=us-central1',
      '--var',
      'zone=us-central1-a',
      '--var',
      'kubernetes_version=1.35.6-gke.1258000',
      '--var',
      'node_size=e2-standard-4',
      '--var',
      'cluster_node_count=3',
      '--var',
      'cluster_min_nodes=3',
      '--var',
      'cluster_max_nodes=6',
      '--var',
      'db_edition=ENTERPRISE',
      '--var',
      'db_sku=db-custom-2-7680',
      '--var',
      'db_disk_size_gb=256',
      '--var',
      'ttl_hours=4',
    ]);
  });

  it('deploy', () => {
    expect(run('deploy').argv).toEqual(['deploy', '--cloud', 'gcp', '--name', 'hapi-fhir-lab']);
  });

  it('expose-fhir', () => {
    expect(run('expose-fhir').argv).toEqual([
      'expose-fhir',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
      '--source-ranges',
      '0.0.0.0/0',
    ]);
  });

  it('unexpose-fhir', () => {
    expect(run('unexpose-fhir').argv).toEqual([
      'unexpose-fhir',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
    ]);
  });

  it('expose-prometheus', () => {
    expect(run('expose-prometheus').argv).toEqual([
      'expose-prometheus',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
      '--source-ranges',
      '0.0.0.0/0',
    ]);
  });

  it('unexpose-prometheus', () => {
    expect(run('unexpose-prometheus').argv).toEqual([
      'unexpose-prometheus',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
    ]);
  });

  it('pause-autoscaling', () => {
    const cmd = run('pause-autoscaling');
    expect(cmd.argv).toEqual(['pause-autoscaling', '--replicas', '5']);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('resume-autoscaling', () => {
    const cmd = run('resume-autoscaling');
    expect(cmd.argv).toEqual(['resume-autoscaling']);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('seed', () => {
    const cmd = run('seed');
    expect(cmd.argv).toEqual([
      'seed',
      '--households',
      '33333',
      '--individuals-per-household',
      '3',
      '--seed',
      '12345',
      '--run',
      'hapi-fhir-lab-20260101-000000',
    ]);
    expect(cmd.env).toEqual({
      FHIR_BASE_URL: 'http://localhost:8080/fhir',
      LAB_SEED_GENERATOR_MODE: 'native',
    });
  });

  it('benchmark (T3 tier -> echis_load_1000.js)', () => {
    const cmd = run('benchmark');
    expect(cmd.argv).toEqual([
      'benchmark',
      '--profile',
      'load',
      '--echis-tier',
      'T3',
      '--run',
      'hapi-fhir-lab-20260101-000000',
    ]);
    expect(cmd.env).toEqual({
      FHIR_BASE_URL: 'http://localhost:8080/fhir',
      K6_SCRIPT: 'benchmarks/k6/echis_load_1000.js',
    });
  });

  it('benchmark (T2 tier -> echis_load_100.js)', () => {
    const cmd = run('benchmark', { echis_tier: 'T2' });
    expect(cmd.env.K6_SCRIPT).toBe('benchmarks/k6/echis_load_100.js');
    expect(cmd.argv).toContain('T2');
  });

  it('benchmark (no tier -> no --echis-tier, no K6_SCRIPT override)', () => {
    const cmd = run('benchmark', { echis_tier: 'none' });
    expect(cmd.argv).toEqual([
      'benchmark',
      '--profile',
      'load',
      '--run',
      'hapi-fhir-lab-20260101-000000',
    ]);
    expect(cmd.env.K6_SCRIPT).toBeUndefined();
  });

  it('report', () => {
    expect(run('report').argv).toEqual([
      'report',
      '--run',
      'hapi-fhir-lab-20260101-000000',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--profile',
      'load',
    ]);
  });

  it('down', () => {
    expect(run('down').argv).toEqual([
      'down',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--yes',
      '--var',
      'project_id=my-project',
      '--var',
      'region=us-central1',
      '--var',
      'zone=us-central1-a',
      '--var',
      'kubernetes_version=1.35.6-gke.1258000',
    ]);
  });

  it('formats a human-readable preview with env prefix', () => {
    const cmd = run('seed');
    const preview = formatCommandPreview(cmd);
    expect(preview).toBe(
      'FHIR_BASE_URL=http://localhost:8080/fhir LAB_SEED_GENERATOR_MODE=native scripts/lab seed --households 33333 --individuals-per-household 3 --seed 12345 --run hapi-fhir-lab-20260101-000000',
    );
  });

  it('rejects an unknown action', () => {
    expect(() => run('not-a-real-action')).toThrow(/unknown action/);
  });
});
