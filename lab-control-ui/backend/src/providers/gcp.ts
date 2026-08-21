// GCP ProviderAdapter (specs/009-lab-control-ui/data-model.md's GCP field
// table, specs/009-lab-control-ui/contracts/cli-action-map.md's exact
// invocation mapping). This is the ONLY module allowed to know GCP-specific
// field/action/CLI-mapping details -- see test/unit/no-provider-leakage.test.ts.

import type { ActionDef, ConfigField, ProviderAdapter } from './types.js';

export const GCP_CONFIG_FIELDS: ConfigField[] = [
  // --- common fields (apply to every provider) ---
  {
    key: 'lab_name',
    label: 'Lab name',
    scope: 'common',
    type: 'string',
    default: 'hapi-fhir-lab',
    helpText: 'Terraform workspace / --name. Must match ^[a-z][a-z0-9-]{2,31}$.',
    cliMapping: '--name {value}',
  },
  {
    key: 'ttl_hours',
    label: 'TTL (hours)',
    scope: 'common',
    type: 'number',
    default: 4,
    helpText: 'How long before this lab should be considered stale and torn down.',
    cliMapping: '--var ttl_hours={value}',
  },
  {
    key: 'echis_tier',
    label: 'eCHIS tier',
    scope: 'common',
    type: 'enum',
    enumValues: ['none', 'T2', 'T3'],
    default: 'none',
    helpText:
      "Pick a documented tier to autofill households/individuals/seed, or 'none' for a custom shape.",
    cliMapping: '--echis-tier {value} (benchmark only)',
  },
  {
    key: 'enable_pgbouncer',
    label: 'Enable PgBouncer pooled tier',
    scope: 'common',
    type: 'boolean',
    default: false,
    helpText:
      "Deploys the opt-in PgBouncer connection-pooling tier (spec 007, ansible/group_vars/lab.yml) alongside HAPI FHIR -- swaps in the pooled ScaledObject in place of the native one. Required for eCHIS tiers T4/T5. maxReplicaCount was lowered from the originally-committed 50 to 5 after a live load test: 50 bounded PgBouncer's client-accept capacity, not its real ~40-connection backend budget, and collapsed throughput/latency/failure-rate badly under the k6 load profile -- see manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml's connection-budget annotation and docs/autoscaling.md.",
    cliMapping: '--extra-vars enable_pgbouncer={value} (deploy only)',
  },
  {
    key: 'pgbouncer_default_pool_size',
    label: 'PgBouncer pool size',
    scope: 'common',
    type: 'number',
    default: 20,
    helpText:
      'Real PostgreSQL connections each PgBouncer replica maintains (DEFAULT_POOL_SIZE/MAX_DB_CONNECTIONS, ansible/templates/pgbouncer-deployment.runtime.yaml.j2). Total real connections = this * pgbouncer_replica_count (2, not yet UI-configurable) -- must stay <= (postgres_max_connections - reserved_connections) = 50 (docs/autoscaling.md); the committed default of 20 gives 40. Only takes effect on the next Deploy.',
    cliMapping: '--extra-vars pgbouncer_default_pool_size={value} (deploy only)',
  },
  {
    key: 'households',
    label: 'Households',
    scope: 'common',
    type: 'number',
    default: 33333,
    helpText: 'T2 shape (docs/echis-benchmark-tiers.md). T3 is 333333.',
    cliMapping: '--households {value}',
  },
  {
    key: 'individuals_per_household',
    label: 'Individuals per household',
    scope: 'common',
    type: 'number',
    default: 3,
    helpText: 'Held constant across all tiers.',
    cliMapping: '--individuals-per-household {value}',
  },
  {
    key: 'echis_seed',
    label: 'Seed',
    scope: 'common',
    type: 'number',
    default: 12345,
    helpText: 'Deterministic seed; keep constant across comparable runs.',
    cliMapping: '--seed {value}',
  },
  {
    key: 'k6_profile',
    label: 'k6 profile',
    scope: 'common',
    type: 'enum',
    enumValues: ['smoke', 'baseline', 'load', 'stress'],
    default: 'load',
    helpText: "Start with 'load' before pushing to 'stress'.",
    cliMapping: '--profile {value}',
  },
  // --- GCP-specific fields ---
  {
    key: 'project_id',
    label: 'GCP project ID',
    scope: 'provider',
    type: 'string',
    default: null,
    helpText: 'The only field this system cannot guess for you.',
    cliMapping: '--var project_id={value}',
  },
  {
    key: 'region',
    label: 'Region',
    scope: 'provider',
    type: 'string',
    default: 'us-central1',
    helpText: '',
    cliMapping: '--var region={value}',
  },
  {
    key: 'zone',
    label: 'Zone',
    scope: 'provider',
    type: 'string',
    default: 'us-central1-a',
    helpText: '',
    cliMapping: '--var zone={value}',
  },
  {
    key: 'kubernetes_version',
    label: 'Kubernetes version',
    scope: 'provider',
    type: 'string',
    default: '1.35.6-gke.1250000',
    helpText: '',
    cliMapping: '--var kubernetes_version={value}',
  },
  {
    key: 'node_size',
    label: 'Node size',
    scope: 'provider',
    type: 'string',
    default: 'e2-standard-4',
    helpText: 'c3-standard-8 for T3-scale runs (see the T3 runbook).',
    cliMapping: '--var node_size={value}',
  },
  {
    key: 'cluster_node_count',
    label: 'Cluster node count',
    scope: 'provider',
    type: 'number',
    default: 3,
    helpText: '',
    cliMapping: '--var cluster_node_count={value}',
  },
  {
    key: 'cluster_min_nodes',
    label: 'Cluster min nodes',
    scope: 'provider',
    type: 'number',
    default: 3,
    helpText: '',
    cliMapping: '--var cluster_min_nodes={value}',
  },
  {
    key: 'cluster_max_nodes',
    label: 'Cluster max nodes',
    scope: 'provider',
    type: 'number',
    default: 6,
    helpText: '',
    cliMapping: '--var cluster_max_nodes={value}',
  },
  {
    key: 'db_edition',
    label: 'Cloud SQL edition',
    scope: 'provider',
    type: 'enum',
    enumValues: ['ENTERPRISE', 'ENTERPRISE_PLUS'],
    default: 'ENTERPRISE',
    helpText: '',
    cliMapping: '--var db_edition={value}',
  },
  {
    key: 'db_sku',
    label: 'Cloud SQL SKU',
    scope: 'provider',
    type: 'string',
    default: 'db-custom-2-7680',
    helpText: '',
    cliMapping: '--var db_sku={value}',
  },
  {
    key: 'db_disk_size_gb',
    label: 'Cloud SQL disk size (GB)',
    scope: 'provider',
    type: 'number',
    default: 256,
    helpText: '',
    cliMapping: '--var db_disk_size_gb={value}',
  },
  {
    key: 'expose_source_ranges',
    label: 'Public exposure source ranges',
    scope: 'provider',
    type: 'string',
    default: '0.0.0.0/0',
    helpText:
      'Matches the CLI default. Named explicitly in the expose-fhir/expose-prometheus confirmation dialog.',
    cliMapping: '--source-ranges {value}',
  },
  {
    key: 'pause_replicas',
    label: 'Bulk-load pinned replicas',
    scope: 'provider',
    type: 'number',
    default: 5,
    helpText:
      'Do not exceed the native connection-budget ceiling (maxReplicaCount: 5, docs/autoscaling.md).',
    cliMapping: '--replicas {value}',
  },
  {
    key: 'shard_output_capacity_gb',
    label: 'Shard output storage capacity (GB)',
    scope: 'provider',
    type: 'number',
    default: 1024,
    helpText:
      "Filestore BASIC_HDD's billed floor is 1024GB (~$0.20/GB-month); only raise this if a run's shard count/size needs more headroom.",
    cliMapping: '--capacity-gb {value}',
  },
];

export const GCP_ACTIONS: ActionDef[] = [
  {
    name: 'up',
    label: 'Provision infrastructure',
    cliSubcommand: 'up',
    scope: 'common',
    requiresConfirmation: true,
    // {field_key} placeholders are resolved against the triggering lab's
    // live field values by resolveConfirmationMessage (commandBuilder.ts)
    // at trigger time -- never shown as raw templates to the operator.
    confirmationMessage:
      "This creates real, billable GCP resources (GKE cluster, Cloud SQL instance) for lab '{lab_name}'.",
    requiredPrerequisiteIds: ['terraform', 'gcloud', 'gcloud-adc'],
  },
  {
    name: 'deploy',
    label: 'Deploy HAPI FHIR',
    cliSubcommand: 'deploy',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: ['helm', 'kubectl', 'ansible-playbook', 'ansible-collections'],
    sequenceAfter: 'up',
  },
  {
    name: 'expose-fhir',
    label: 'Expose FHIR endpoint publicly',
    cliSubcommand: 'expose-fhir',
    scope: 'provider',
    requiresConfirmation: true,
    confirmationMessage:
      'This opens a public GCP firewall rule for the FHIR endpoint, reachable from {expose_source_ranges}. HAPI FHIR has no authentication in front of it.',
    requiredPrerequisiteIds: ['kubectl', 'gcloud'],
  },
  {
    name: 'unexpose-fhir',
    label: 'Close public FHIR exposure',
    cliSubcommand: 'unexpose-fhir',
    scope: 'provider',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: [],
  },
  {
    name: 'expose-prometheus',
    label: 'Expose Prometheus publicly',
    cliSubcommand: 'expose-prometheus',
    scope: 'provider',
    requiresConfirmation: true,
    confirmationMessage:
      'This opens a public GCP firewall rule for the Prometheus UI, reachable from {expose_source_ranges}.',
    requiredPrerequisiteIds: ['kubectl', 'gcloud'],
  },
  {
    name: 'unexpose-prometheus',
    label: 'Close public Prometheus exposure',
    cliSubcommand: 'unexpose-prometheus',
    scope: 'provider',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: [],
  },
  {
    name: 'expose-grafana',
    label: 'Expose Grafana publicly',
    cliSubcommand: 'expose-grafana',
    scope: 'provider',
    requiresConfirmation: true,
    // Unlike expose-fhir/expose-prometheus, Grafana does require a login
    // (kube-prometheus-stack's default admin/<generated password> --
    // docs/lab-cli.md's "Public exposure (GCP only)" section) -- named here
    // so the confirmation dialog doesn't overstate the exposure the way a
    // copy-pasted FHIR/Prometheus message would.
    confirmationMessage:
      "This opens a public GCP firewall rule for Grafana, reachable from {expose_source_ranges}. Login is required (user 'admin'; run `kubectl -n monitoring get secret prometheus-grafana -o jsonpath='{.data.admin-password}' | base64 -d` for the password).",
    requiredPrerequisiteIds: ['kubectl', 'gcloud'],
  },
  {
    name: 'unexpose-grafana',
    label: 'Close public Grafana exposure',
    cliSubcommand: 'unexpose-grafana',
    scope: 'provider',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: [],
  },
  {
    name: 'pause-autoscaling',
    label: 'Pin replicas for bulk-load window',
    cliSubcommand: 'pause-autoscaling',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: ['kubectl'],
  },
  {
    name: 'resume-autoscaling',
    label: 'Resume normal autoscaling',
    cliSubcommand: 'resume-autoscaling',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: ['kubectl'],
  },
  {
    name: 'seed',
    label: 'Seed synthetic data',
    cliSubcommand: 'seed',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: ['ruby'],
    sequenceAfter: 'deploy',
  },
  {
    name: 'provision-shard-storage',
    label: 'Provision RWX shard storage',
    cliSubcommand: 'provision-shard-storage',
    scope: 'provider',
    requiresConfirmation: true,
    // {field_key} placeholder resolved against this lab's live field values
    // by resolveConfirmationMessage, same as up/down/expose-*.
    confirmationMessage:
      "This provisions a billable GCP Filestore instance (BASIC_HDD, ~$0.20/GB-month, {shard_output_capacity_gb}GB) for lab '{lab_name}'. Required once before running 'Run k6 benchmark' in-cluster with more than 1 parallel shard; torn down automatically by 'Destroy infrastructure'.",
    requiredPrerequisiteIds: ['terraform', 'gcloud', 'kubectl'],
    sequenceAfter: 'up',
  },
  {
    name: 'benchmark',
    label: 'Run k6 benchmark',
    cliSubcommand: 'benchmark',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: ['k6'],
    sequenceAfter: 'seed',
  },
  {
    name: 'report',
    label: 'Publish report',
    cliSubcommand: 'report',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: ['ruby'],
    sequenceAfter: 'benchmark',
  },
  {
    name: 'down',
    label: 'Destroy infrastructure',
    cliSubcommand: 'down',
    scope: 'common',
    requiresConfirmation: true,
    confirmationMessage:
      "This destroys all provisioned infrastructure for lab '{lab_name}' (GKE cluster, Cloud SQL instance).",
    requiredPrerequisiteIds: ['terraform', 'gcloud'],
  },
];

/** eCHIS tier -> k6 script, per docs/echis-benchmark-tiers.md. */
const ECHIS_TIER_K6_SCRIPT: Record<string, string> = {
  T2: 'benchmarks/k6/echis_load_100.js',
  T3: 'benchmarks/k6/echis_load_1000.js',
};

function str(v: unknown, fallback = ''): string {
  return v === undefined || v === null ? fallback : String(v);
}

function kubeconfigPathFor(labName: string): string {
  return `ansible/artifacts/lab/gcp/${labName}/kubeconfig`;
}

/**
 * Pure mapping from (action, resolved field values) to a scripts/lab argv +
 * env, per contracts/cli-action-map.md. Callers (the actions route / T037's
 * trigger handler) are responsible for resolving anything not captured by
 * ConfigField -- namely `cliRunLabel` (contracts/cli-action-map.md's
 * disambiguation note: distinct from the action_runs.id `actionRunId`) and
 * `fhir_base_url` (resolved from the lab's last successful expose-fhir run,
 * falling back to http://localhost:8080/fhir) -- and injecting them into
 * fieldValues before calling this function, so this function stays a pure,
 * easily-unit-tested (T016) mapping with no I/O or DB access of its own.
 */
export function gcpBuildCommand(
  actionName: string,
  fieldValues: Record<string, unknown>,
): { argv: string[]; env: Record<string, string> } {
  const f = (key: string, fallback = '') => str(fieldValues[key], fallback);
  const labName = f('lab_name');
  const projectId = f('project_id');
  const cliRunLabel = f('cliRunLabel');

  switch (actionName) {
    case 'up':
      return {
        argv: [
          'up',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--auto-approve',
          '--var',
          `project_id=${projectId}`,
          '--var',
          `region=${f('region')}`,
          '--var',
          `zone=${f('zone')}`,
          '--var',
          `kubernetes_version=${f('kubernetes_version')}`,
          '--var',
          `node_size=${f('node_size')}`,
          '--var',
          `cluster_node_count=${f('cluster_node_count')}`,
          '--var',
          `cluster_min_nodes=${f('cluster_min_nodes')}`,
          '--var',
          `cluster_max_nodes=${f('cluster_max_nodes')}`,
          '--var',
          `db_edition=${f('db_edition')}`,
          '--var',
          `db_sku=${f('db_sku')}`,
          '--var',
          `db_disk_size_gb=${f('db_disk_size_gb')}`,
          '--var',
          `ttl_hours=${f('ttl_hours')}`,
        ],
        env: {},
      };

    case 'deploy':
      return {
        // Always passed explicitly (never conditionally omitted) so toggling
        // this field OFF on a later redeploy actually disables the pooled
        // tier again, rather than leaving a prior true value stuck via
        // Ansible's own enable_pgbouncer: false group_vars default.
        argv: [
          'deploy',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--extra-vars',
          `enable_pgbouncer=${f('enable_pgbouncer', 'false')}`,
          '--extra-vars',
          `pgbouncer_default_pool_size=${f('pgbouncer_default_pool_size', '20')}`,
        ],
        env: {},
      };

    case 'expose-fhir':
      return {
        argv: [
          'expose-fhir',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--var',
          `project_id=${projectId}`,
          '--source-ranges',
          f('expose_source_ranges'),
        ],
        // Requires KUBECONFIG, same as pause-autoscaling/resume-autoscaling
        // (docs/lab-cli.md's "Public exposure (GCP only)" section) --
        // without it kubectl falls back to its no-config default and fails.
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'unexpose-fhir':
      return {
        argv: [
          'unexpose-fhir',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--var',
          `project_id=${projectId}`,
        ],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'expose-prometheus':
      return {
        argv: [
          'expose-prometheus',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--var',
          `project_id=${projectId}`,
          '--source-ranges',
          f('expose_source_ranges'),
        ],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'unexpose-prometheus':
      return {
        argv: [
          'unexpose-prometheus',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--var',
          `project_id=${projectId}`,
        ],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'expose-grafana':
      return {
        argv: [
          'expose-grafana',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--var',
          `project_id=${projectId}`,
          '--source-ranges',
          f('expose_source_ranges'),
        ],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'unexpose-grafana':
      return {
        argv: [
          'unexpose-grafana',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--var',
          `project_id=${projectId}`,
        ],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    // Not in GCP_ACTIONS -- this is a read-only status query (routes/
    // exposures.ts), not an operator-triggerable action with its own
    // confirmation/log-stream/run-history entry. Kept in this same switch
    // so it shares f()/labName/projectId/kubeconfigPathFor with every real
    // action instead of duplicating that lookup elsewhere.
    case 'exposures':
      return {
        argv: ['exposures', '--cloud', 'gcp', '--name', labName, '--format', 'json'],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'pause-autoscaling':
      return {
        argv: ['pause-autoscaling', '--replicas', f('pause_replicas')],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'resume-autoscaling':
      return {
        argv: ['resume-autoscaling'],
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'seed': {
      const env: Record<string, string> = {
        FHIR_BASE_URL: f('fhir_base_url', 'http://localhost:8080/fhir'),
        LAB_SEED_GENERATOR_MODE: 'native',
      };
      return {
        argv: [
          'seed',
          '--households',
          f('households'),
          '--individuals-per-household',
          f('individuals_per_household'),
          '--seed',
          f('echis_seed'),
          '--run',
          cliRunLabel,
        ],
        env,
      };
    }

    case 'provision-shard-storage':
      return {
        argv: [
          'provision-shard-storage',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--auto-approve',
          '--var',
          `project_id=${projectId}`,
          '--capacity-gb',
          f('shard_output_capacity_gb', '1024'),
        ],
        // The PV/PVC apply step (manifests/k6-shard-job's static PV/PVC)
        // shells out to kubectl same as pause-autoscaling/expose-fhir --
        // scripts/lab's kubectl-using commands never resolve a kubeconfig
        // themselves, they expect the caller to set KUBECONFIG. Omitting
        // this makes kubectl fall back to no config at all (resolves to
        // localhost:8080, "connection refused") rather than this lab's
        // real cluster.
        env: { KUBECONFIG: kubeconfigPathFor(labName) },
      };

    case 'benchmark': {
      const tier = f('echis_tier');
      // Ephemeral per-trigger options (routes/actions.ts), not a persisted
      // ConfigField -- an operator picks this at the moment they click
      // "Run k6 benchmark", not when configuring the lab.
      const inCluster = fieldValues.in_cluster === true;
      const env: Record<string, string> = {
        FHIR_BASE_URL: inCluster
          ? // A local kubectl-port-forward URL (localhost:8080) is
            // meaningless from inside a k6 shard pod running in-cluster --
            // it would resolve to the shard pod itself, not FHIR. Use the
            // Service's cluster-DNS name instead, matching scripts/lab's
            // own HAPI_NAMESPACE/HAPI_SERVICE_NAME defaults (fhir /
            // hapi-fhir-hapi-fhir-jpaserver) -- neither is a configurable
            // ConfigField here, same as scripts/lab itself.
            f(
              'fhir_base_url_in_cluster',
              'http://hapi-fhir-hapi-fhir-jpaserver.fhir.svc.cluster.local:8080/fhir',
            )
          : f('fhir_base_url', 'http://localhost:8080/fhir'),
        // Not required by benchmark itself (only FHIR_BASE_URL is), but
        // ensure_local_prometheus_remote_write (scripts/lab) uses it to
        // open a local-only port-forward to Prometheus so this run's live
        // metrics land in Grafana automatically -- without it, resolving
        // a kubeconfig here would silently fail and every UI-triggered
        // benchmark would run without live metrics (docs/lab-cli.md's
        // "Live k6 metrics in Grafana" section).
        KUBECONFIG: kubeconfigPathFor(labName),
      };
      const argv = ['benchmark', '--profile', f('k6_profile')];
      if (inCluster) {
        // scripts/lab's cmd_benchmark_in_cluster always targets
        // benchmarks/k6/echis_load_100.js -- the k6-shard-job manifest's
        // ConfigMap mapping is static -- and DIES if K6_SCRIPT names
        // anything else, so it's deliberately never set here regardless of
        // echis_tier. --echis-tier is also deliberately omitted: it would
        // additionally trigger tier-sequence gating (requiring a prior
        // tier's benchmark to have already succeeded) that has nothing to
        // do with this standalone in-cluster run.
        const shards = Number(fieldValues.parallel_shards ?? 1);
        argv.push('--in-cluster', '--parallel-shards', String(shards));
      } else {
        const script = ECHIS_TIER_K6_SCRIPT[tier];
        if (script) env.K6_SCRIPT = script;
        if (tier && tier !== 'none') argv.push('--echis-tier', tier);
      }
      argv.push('--run', cliRunLabel);
      return { argv, env };
    }

    case 'report':
      return {
        argv: [
          'report',
          '--run',
          cliRunLabel,
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--profile',
          f('k6_profile'),
        ],
        env: {},
      };

    case 'down':
      return {
        argv: [
          'down',
          '--cloud',
          'gcp',
          '--name',
          labName,
          '--yes',
          '--var',
          `project_id=${projectId}`,
          '--var',
          `region=${f('region')}`,
          '--var',
          `zone=${f('zone')}`,
          '--var',
          `kubernetes_version=${f('kubernetes_version')}`,
        ],
        env: {},
      };

    default:
      throw new Error(`gcp provider: unknown action '${actionName}'`);
  }
}

export const gcpProvider: ProviderAdapter = {
  id: 'gcp',
  label: 'Google Cloud (GKE + Cloud SQL)',
  configFields: GCP_CONFIG_FIELDS,
  actions: GCP_ACTIONS,
  prerequisiteChecks: [
    { id: 'terraform', label: 'Terraform', severity: 'blocking' },
    { id: 'helm', label: 'Helm', severity: 'blocking' },
    { id: 'kubectl', label: 'kubectl', severity: 'blocking' },
    { id: 'ansible-playbook', label: 'ansible-playbook', severity: 'blocking' },
    { id: 'ansible-galaxy', label: 'ansible-galaxy', severity: 'blocking' },
    { id: 'ansible-collections', label: 'Ansible collections', severity: 'blocking' },
    { id: 'ruby', label: 'Ruby', severity: 'blocking' },
    { id: 'k6', label: 'k6', severity: 'blocking' },
    { id: 'java', label: 'Java 17+', severity: 'blocking' },
    { id: 'gcloud', label: 'gcloud CLI', severity: 'blocking' },
    { id: 'gke-gcloud-auth-plugin', label: 'gke-gcloud-auth-plugin', severity: 'blocking' },
    { id: 'gcloud-adc', label: 'gcloud Application Default Credentials', severity: 'warning' },
  ],
  buildCommand: gcpBuildCommand,
};
