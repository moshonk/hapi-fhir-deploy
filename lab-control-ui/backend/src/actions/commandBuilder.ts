// CLI argument/command builder (specs/009-lab-control-ui/contracts/cli-action-map.md,
// T015). Resolves everything a ProviderAdapter.buildCommand needs -- including
// the two values contracts/cli-action-map.md documents as caller-resolved
// rather than form fields (`cliRunLabel`, `fhir_base_url`) -- then delegates
// the actual provider-specific argv/env mapping to the provider itself, so
// this module never hardcodes GCP (or any other provider's) flag semantics.

import type { ActionDef, ProviderAdapter, ConfigField } from '../providers/types.js';

export interface BuildCommandContext {
  /** Pre-resolved cliRunLabel; if omitted, generated as `{lab_name}-{timestamp}`. */
  cliRunLabel?: string;
  /** Pre-resolved FHIR_BASE_URL; if omitted, falls back to the documented default. */
  fhirBaseUrl?: string;
  now?: Date;
}

export interface ResolvedCommand {
  argv: string[];
  env: Record<string, string>;
  /**
   * The cliRunLabel actually used for this invocation (auto-generated
   * unless context.cliRunLabel overrode it) -- distinct from the
   * action_runs.id `actionRunId` (contracts/api.md's disambiguation note).
   * Callers (the actions route) persist this so a later `report` trigger
   * can target the SAME run's artifacts instead of generating a fresh
   * label that points at a run directory that never existed.
   */
  cliRunLabel: string;
}

/** `{lab_name}-{YYYYMMDD-HHMMSS}`, matching the runbook's own --run convention. */
export function generateCliRunLabel(labName: string, now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .replace('T', '-');
  return `${labName}-${stamp}`;
}

export function defaultFieldValues(provider: ProviderAdapter): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of provider.configFields) {
    if (field.default !== null) values[field.key] = field.default;
  }
  return values;
}

export function isLaunchable(
  provider: ProviderAdapter,
  fieldValues: Record<string, unknown>,
): boolean {
  return provider.configFields
    .filter((f) => f.default === null)
    .every((f) => {
      const v = fieldValues[f.key];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
}

export function requiredFieldKeys(provider: ProviderAdapter): string[] {
  return provider.configFields.filter((f: ConfigField) => f.default === null).map((f) => f.key);
}

export function buildCommand(
  provider: ProviderAdapter,
  actionName: string,
  fieldValues: Record<string, unknown>,
  context: BuildCommandContext = {},
): ResolvedCommand {
  const labName = String(fieldValues.lab_name ?? '');
  const cliRunLabel = context.cliRunLabel ?? generateCliRunLabel(labName, context.now);
  const resolved: Record<string, unknown> = {
    ...fieldValues,
    cliRunLabel,
    fhir_base_url: context.fhirBaseUrl ?? fieldValues.fhir_base_url ?? 'http://localhost:8080/fhir',
  };
  const { argv, env } = provider.buildCommand(actionName, resolved);
  return { argv, env, cliRunLabel };
}

/** Interpolates an ActionDef.confirmationMessage template's `{field_key}`
 * placeholders against a specific lab's live field values (FR-012). Never
 * shows the raw template -- always call this before surfacing a
 * confirmationMessage to an operator or over the API. */
export function resolveConfirmationMessage(
  action: ActionDef,
  fieldValues: Record<string, unknown>,
): string | null {
  if (action.confirmationMessage === null) return null;
  return action.confirmationMessage.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = fieldValues[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

/** Renders a resolved command as the exact shell invocation shown in the
 * command preview (FR-003) and used for logging, e.g.
 * `FHIR_BASE_URL=... K6_SCRIPT=... scripts/lab benchmark --profile load ...`. */
export function formatCommandPreview(cmd: ResolvedCommand): string {
  const envPrefix = Object.entries(cmd.env)
    .map(([k, v]) => `${k}=${shellQuoteIfNeeded(v)}`)
    .join(' ');
  const args = cmd.argv.map(shellQuoteIfNeeded).join(' ');
  return [envPrefix, 'scripts/lab', args].filter(Boolean).join(' ');
}

function shellQuoteIfNeeded(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_.:/=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
