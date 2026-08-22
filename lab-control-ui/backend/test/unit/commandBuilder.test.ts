// Asserts commandBuilder + the GCP provider produce the exact invocation
// documented in specs/009-lab-control-ui/contracts/cli-action-map.md, one
// case per table row (T016). If this test and that doc ever diverge, one of
// them is wrong -- this is the guard against that drift.

import { describe, expect, it } from 'vitest';
import { gcpProvider } from '../../src/providers/gcp.js';
import {
  buildCommand,
  formatCommandPreview,
  resolveConfirmationMessage,
} from '../../src/actions/commandBuilder.js';

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
  shard_output_capacity_gb: 1024,
  enable_pgbouncer: false,
  pgbouncer_default_pool_size: 20,
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

  it('deploy (enable_pgbouncer: false -> --extra-vars enable_pgbouncer=false, always explicit)', () => {
    expect(run('deploy').argv).toEqual([
      'deploy',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--extra-vars',
      'enable_pgbouncer=false',
      '--extra-vars',
      'pgbouncer_default_pool_size=20',
    ]);
  });

  it('deploy (enable_pgbouncer: true, custom pool size)', () => {
    expect(run('deploy', { enable_pgbouncer: true, pgbouncer_default_pool_size: 25 }).argv).toEqual(
      [
        'deploy',
        '--cloud',
        'gcp',
        '--name',
        'hapi-fhir-lab',
        '--extra-vars',
        'enable_pgbouncer=true',
        '--extra-vars',
        'pgbouncer_default_pool_size=25',
      ],
    );
  });

  it('expose-fhir (requires KUBECONFIG, same as pause/resume-autoscaling)', () => {
    const cmd = run('expose-fhir');
    expect(cmd.argv).toEqual([
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
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('unexpose-fhir (requires KUBECONFIG)', () => {
    const cmd = run('unexpose-fhir');
    expect(cmd.argv).toEqual([
      'unexpose-fhir',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
    ]);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('expose-prometheus (requires KUBECONFIG)', () => {
    const cmd = run('expose-prometheus');
    expect(cmd.argv).toEqual([
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
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('unexpose-prometheus (requires KUBECONFIG)', () => {
    const cmd = run('unexpose-prometheus');
    expect(cmd.argv).toEqual([
      'unexpose-prometheus',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
    ]);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('expose-grafana (requires KUBECONFIG)', () => {
    const cmd = run('expose-grafana');
    expect(cmd.argv).toEqual([
      'expose-grafana',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
      '--source-ranges',
      '0.0.0.0/0',
    ]);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('unexpose-grafana (requires KUBECONFIG)', () => {
    const cmd = run('unexpose-grafana');
    expect(cmd.argv).toEqual([
      'unexpose-grafana',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--var',
      'project_id=my-project',
    ]);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
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

  it('provision-shard-storage (requires KUBECONFIG for its kubectl-applied PV/PVC step, same as pause/resume-autoscaling)', () => {
    const cmd = run('provision-shard-storage');
    expect(cmd.argv).toEqual([
      'provision-shard-storage',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--auto-approve',
      '--var',
      'project_id=my-project',
      '--capacity-gb',
      '1024',
    ]);
    expect(cmd.env).toEqual({ KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig' });
  });

  it('seed', () => {
    const cmd = run('seed');
    expect(cmd.argv).toEqual([
      'seed',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
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

  it("seed (restore_from_backup: true skips generation and pg_restore's the given directory)", () => {
    const cmd = run('seed', {
      restore_from_backup: true,
      backup_dir: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup',
    });
    expect(cmd.argv).toEqual([
      'seed',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--restore-from-backup',
      '--backup-dir',
      'ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup',
      '--run',
      'hapi-fhir-lab-20260101-000000',
    ]);
    expect(cmd.env).toEqual({
      FHIR_BASE_URL: 'http://localhost:8080/fhir',
      LAB_SEED_GENERATOR_MODE: 'native',
    });
  });

  it('backup-db (explicit backup_dir)', () => {
    const cmd = run('backup-db', {
      backup_dir: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup',
    });
    expect(cmd.argv).toEqual([
      'backup-db',
      '--cloud',
      'gcp',
      '--name',
      'hapi-fhir-lab',
      '--backup-dir',
      'ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup',
    ]);
    expect(cmd.env).toEqual({});
  });

  it('backup-db (no backup_dir -- omits --backup-dir so scripts/lab applies its own default)', () => {
    const cmd = run('backup-db');
    expect(cmd.argv).toEqual(['backup-db', '--cloud', 'gcp', '--name', 'hapi-fhir-lab']);
    expect(cmd.env).toEqual({});
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
      // scripts/lab's ensure_local_prometheus_remote_write needs this to
      // auto-detect a kubeconfig for the live-metrics port-forward --
      // without it, every UI-triggered benchmark would silently run
      // without live k6 metrics in Grafana.
      KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig',
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

  it('benchmark (in_cluster -> --in-cluster/--parallel-shards, cluster-DNS FHIR_BASE_URL, no --echis-tier/K6_SCRIPT)', () => {
    const cmd = run('benchmark', { in_cluster: true, parallel_shards: 5 });
    expect(cmd.argv).toEqual([
      'benchmark',
      '--profile',
      'load',
      '--in-cluster',
      '--parallel-shards',
      '5',
      '--run',
      'hapi-fhir-lab-20260101-000000',
    ]);
    expect(cmd.env).toEqual({
      // Not localhost:8080 -- that would resolve to the k6 shard pod
      // itself, not FHIR, from inside the cluster.
      FHIR_BASE_URL: 'http://hapi-fhir-hapi-fhir-jpaserver.fhir.svc.cluster.local:8080/fhir',
      KUBECONFIG: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/kubeconfig',
    });
    // T3 tier is set in FIELDS -- confirms in_cluster suppresses BOTH
    // --echis-tier and K6_SCRIPT even when a tier is configured, since
    // cmd_benchmark_in_cluster (scripts/lab) always targets
    // echis_load_100.js and dies if K6_SCRIPT names anything else.
    expect(cmd.argv).not.toContain('--echis-tier');
    expect(cmd.env.K6_SCRIPT).toBeUndefined();
  });

  it('benchmark (in_cluster, no parallel_shards override -> defaults to 1)', () => {
    const cmd = run('benchmark', { in_cluster: true });
    expect(cmd.argv).toEqual([
      'benchmark',
      '--profile',
      'load',
      '--in-cluster',
      '--parallel-shards',
      '1',
      '--run',
      'hapi-fhir-lab-20260101-000000',
    ]);
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
      'FHIR_BASE_URL=http://localhost:8080/fhir LAB_SEED_GENERATOR_MODE=native scripts/lab seed --cloud gcp --name hapi-fhir-lab --households 33333 --individuals-per-household 3 --seed 12345 --run hapi-fhir-lab-20260101-000000',
    );
  });

  it('rejects an unknown action', () => {
    expect(() => run('not-a-real-action')).toThrow(/unknown action/);
  });

  it('returns the cliRunLabel actually used, whether auto-generated or overridden', () => {
    expect(run('seed').cliRunLabel).toBe('hapi-fhir-lab-20260101-000000');

    const overridden = buildCommand(gcpProvider, 'report', FIELDS, {
      cliRunLabel: 'hapi-fhir-lab-some-prior-run',
    });
    expect(overridden.cliRunLabel).toBe('hapi-fhir-lab-some-prior-run');
    expect(overridden.argv).toContain('hapi-fhir-lab-some-prior-run');
    expect(overridden.argv).not.toContain('hapi-fhir-lab-20260101-000000');
  });
});

describe('resolveConfirmationMessage (FR-012 -- name the actual configured value)', () => {
  const upAction = gcpProvider.actions.find((a) => a.name === 'up')!;
  const exposeFhirAction = gcpProvider.actions.find((a) => a.name === 'expose-fhir')!;
  const deployAction = gcpProvider.actions.find((a) => a.name === 'deploy')!;

  it('interpolates {field_key} placeholders against live field values', () => {
    const message = resolveConfirmationMessage(exposeFhirAction, {
      expose_source_ranges: '203.0.113.7/32',
    });
    expect(message).toContain('203.0.113.7/32');
    expect(message).not.toContain('{expose_source_ranges}');
  });

  it('interpolates lab_name for up/down', () => {
    const message = resolveConfirmationMessage(upAction, { lab_name: 'my-real-lab' });
    expect(message).toContain("'my-real-lab'");
  });

  it('leaves an unresolvable placeholder visibly unresolved rather than silently dropping it', () => {
    const message = resolveConfirmationMessage(exposeFhirAction, {});
    expect(message).toContain('{expose_source_ranges}');
  });

  it('returns null for actions with no confirmation message', () => {
    expect(resolveConfirmationMessage(deployAction, {})).toBeNull();
  });

  it('expose-grafana: interpolates expose_source_ranges and leaves the jsonpath braces in the login hint untouched', () => {
    const exposeGrafanaAction = gcpProvider.actions.find((a) => a.name === 'expose-grafana')!;
    const message = resolveConfirmationMessage(exposeGrafanaAction, {
      expose_source_ranges: '203.0.113.7/32',
    })!;
    expect(message).toContain('203.0.113.7/32');
    expect(message).not.toContain('{expose_source_ranges}');
    // {.data.admin-password} isn't a {field_key} placeholder (dots/hyphens
    // aren't valid field-key characters) -- must survive interpolation
    // verbatim as the real kubectl jsonpath expression it is.
    expect(message).toContain('{.data.admin-password}');
  });

  it('provision-shard-storage: interpolates shard_output_capacity_gb and lab_name', () => {
    const provisionShardStorageAction = gcpProvider.actions.find(
      (a) => a.name === 'provision-shard-storage',
    )!;
    const message = resolveConfirmationMessage(provisionShardStorageAction, {
      lab_name: 'my-real-lab',
      shard_output_capacity_gb: 2048,
    })!;
    expect(message).toContain("'my-real-lab'");
    expect(message).toContain('2048GB');
    expect(message).not.toContain('{shard_output_capacity_gb}');
  });
});
