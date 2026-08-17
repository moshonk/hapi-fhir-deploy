// Mirrors backend/src/providers/types.ts's public shape + contracts/api.md.

export type ConfigFieldScope = 'common' | 'provider';
export type ConfigFieldType = 'string' | 'number' | 'enum' | 'boolean';

export interface ConfigField {
  key: string;
  label: string;
  scope: ConfigFieldScope;
  type: ConfigFieldType;
  enumValues?: string[];
  default: string | number | boolean | null;
  helpText: string;
  cliMapping: string;
}

export interface ActionDef {
  name: string;
  label: string;
  cliSubcommand: string;
  scope: ConfigFieldScope;
  requiresConfirmation: boolean;
  confirmationMessage: string | null;
  requiredPrerequisiteIds: string[];
  sequenceAfter?: string;
}

export interface ProviderPublicShape {
  id: string;
  label: string;
  configFields: ConfigField[];
  actions: ActionDef[];
}

export interface LabConfiguration {
  id: string;
  provider: string;
  name: string;
  fields: Record<string, unknown>;
  launchable: boolean;
  created_at: string;
  updated_at: string;
}

export type ActionRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ActionRunSummary {
  id: string;
  action_name: string;
  status: ActionRunStatus;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
}

export interface ActionRunDetail extends ActionRunSummary {
  lab_configuration_id: string;
  command_preview: string;
  log_file_path: string;
  cli_run_label: string;
}

/** GET /api/runs/:runId/artifacts's per-file record. `content` is the
 * parsed JSON value for kind "json", or the raw file text for kind
 * "text" (e.g. report.md, summary.csv). Never includes k6-raw.jsonl --
 * that's a multi-gigabyte NDJSON dump, not something this endpoint will
 * ever serve. */
export interface ArtifactFile {
  name: string;
  kind: 'json' | 'text';
  content: unknown;
}

export interface RunArtifacts {
  cliRunLabel: string;
  files: ArtifactFile[];
}

export type PrereqStatus = 'pass' | 'warn' | 'fail';

export interface PrereqCheck {
  id: string;
  label: string;
  status: PrereqStatus;
  detail: string;
}

/** GET /api/labs/:id/exposures's per-service record (backend/src/routes/
 * exposures.ts, `scripts/lab exposures --format json` relayed verbatim). */
export interface ExposureRecord {
  id: string;
  label: string;
  exposed: boolean;
  url?: string;
  port?: string;
  firewallRule?: string;
  /** Only present on the grafana record -- FHIR/Prometheus have no auth. */
  credentialsAvailable?: boolean;
  username?: string;
  password?: string;
  credentialsReason?: string;
}
