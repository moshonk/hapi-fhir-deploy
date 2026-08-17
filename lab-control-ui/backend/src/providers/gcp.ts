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
    default: '1.35.6-gke.1258000',
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
      return { argv: ['deploy', '--cloud', 'gcp', '--name', labName], env: {} };

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

    case 'benchmark': {
      const tier = f('echis_tier');
      const env: Record<string, string> = {
        FHIR_BASE_URL: f('fhir_base_url', 'http://localhost:8080/fhir'),
      };
      const script = ECHIS_TIER_K6_SCRIPT[tier];
      if (script) env.K6_SCRIPT = script;
      const argv = ['benchmark', '--profile', f('k6_profile')];
      if (tier && tier !== 'none') argv.push('--echis-tier', tier);
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
