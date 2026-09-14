// Provider extension point (specs/009-lab-control-ui/data-model.md).
//
// All provider-agnostic backend code (routes, the action runner, the
// command builder, the DB layer) consumes only these interfaces. A future
// non-GCP provider is added by writing one new module that implements
// ProviderAdapter and registering it in ./registry.ts -- no other file in
// this codebase should ever branch on a provider id (see
// test/unit/no-provider-leakage.test.ts, T047).

export type ConfigFieldScope = 'common' | 'provider';
export type ConfigFieldType = 'string' | 'number' | 'enum' | 'boolean';

export interface ConfigField {
  key: string;
  label: string;
  scope: ConfigFieldScope;
  type: ConfigFieldType;
  /** Only meaningful when type === 'enum'. */
  enumValues?: string[];
  /** `null` marks the field as blocking (spec.md FR-002) -- editable but required. */
  default: string | number | boolean | null;
  helpText: string;
  /**
   * How this field becomes a CLI flag/env var, e.g. "--var node_size={value}"
   * or "env:FHIR_BASE_URL". Documentation only (contracts/cli-action-map.md
   * is the executable source of truth via commandBuilder.ts); surfaced to
   * operators in the command preview UI.
   */
  cliMapping: string;
}

export function isFieldRequired(field: ConfigField): boolean {
  return field.default === null;
}

export type PrerequisiteSeverity = 'blocking' | 'warning';

export interface PrerequisiteCheckDef {
  id: string;
  label: string;
  severity: PrerequisiteSeverity;
}

/**
 * Logical grouping for action buttons in the UI -- a provider-agnostic
 * workflow concept ("these buttons all relate to X"), not a
 * `scripts/lab`/CLI one. Kept as a small fixed set (rather than a free
 * string) so the frontend's ACTION_GROUP_LABELS/ACTION_GROUP_ORDER stay
 * exhaustive and a typo here is a compile error, not a silently-dropped
 * heading.
 */
export type ActionGroupId = 'lifecycle' | 'data' | 'scaling' | 'benchmark' | 'exposure';

export interface ActionDef {
  name: string;
  label: string;
  /**
   * Plain-language, jargon-free explanation of what clicking this button
   * does -- shown as a hover tooltip on the action button (a layman-facing
   * companion to `label`/`confirmationMessage`, neither of which is written
   * for someone unfamiliar with this toolchain). Optional so a provider
   * that hasn't filled it in yet just renders no tooltip rather than an
   * `undefined` string.
   */
  description?: string;
  /**
   * Which section of the action list this button renders under (e.g.
   * "Infrastructure lifecycle", "Data"), so operators can find related
   * actions at a glance instead of scanning one long flat list. Optional --
   * an action without one renders in a catch-all "Other" section rather
   * than being dropped.
   */
  group?: ActionGroupId;
  /** The literal `scripts/lab` subcommand invoked. */
  cliSubcommand: string;
  scope: ConfigFieldScope;
  requiresConfirmation: boolean;
  /**
   * States the concrete consequence (billable resources / destructive
   * teardown / public exposure). Required when requiresConfirmation is true.
   * May contain `{field_key}` placeholders referencing this provider's own
   * ConfigField keys (e.g. `{expose_source_ranges}`); resolveConfirmationMessage
   * (commandBuilder.ts) interpolates them against a specific lab's live field
   * values at trigger time (FR-012 -- name the actual configured value, not
   * a generic warning). The raw template is what `/api/providers` serves;
   * only the trigger endpoint's 409 response carries the resolved text.
   */
  confirmationMessage: string | null;
  /** PrerequisiteCheckDef ids that must be passing (or explicitly overridden)
   * before this action is triggerable (spec.md FR-011). */
  requiredPrerequisiteIds: string[];
  /**
   * Provider-agnostic sequencing hint (spec.md Edge Case 3): this action's
   * UI button stays disabled until the named action's most recent run for
   * this lab succeeded. Purely a UI convenience derived from run history
   * the backend already owns -- NOT a re-implementation of any CLI-enforced
   * guard (those, like the T2-before-T3 eCHIS tier guard, are surfaced via
   * FR-006's refusal passthrough instead, never gated here).
   */
  sequenceAfter?: string;
  /**
   * Relaxes sequenceAfter from "most recent run succeeded" to "any run has
   * ever succeeded". Use for actions gated on a durable side effect (e.g.
   * backup-db only needs a database to exist -- a seed that already
   * succeeded left one, and a later, unrelated failed run doesn't erase it)
   * rather than on the freshness of the prior action's own outcome.
   * Defaults to false (the Edge Case 3 "most recent" semantics above).
   */
  sequenceAfterAnySuccess?: boolean;
}

export interface ProviderAdapter {
  id: string;
  label: string;
  configFields: ConfigField[];
  actions: ActionDef[];
  prerequisiteChecks: PrerequisiteCheckDef[];
  /**
   * Builds the argv (excluding the `scripts/lab` binary itself) and any
   * extra environment variables for a given action against a resolved set
   * of field values. This is the ONLY place provider-specific CLI mapping
   * logic may live -- see contracts/cli-action-map.md for the exact,
   * per-action mapping this must implement.
   */
  buildCommand(
    actionName: string,
    fieldValues: Record<string, unknown>,
  ): {
    argv: string[];
    env: Record<string, string>;
  };
}

/** Public shape served by GET /api/providers (contracts/api.md). Omits
 * buildCommand, which is a backend-only implementation detail. */
export interface ProviderPublicShape {
  id: string;
  label: string;
  configFields: ConfigField[];
  actions: Omit<ActionDef, never>[];
}

export function toPublicShape(provider: ProviderAdapter): ProviderPublicShape {
  return {
    id: provider.id,
    label: provider.label,
    configFields: provider.configFields,
    actions: provider.actions,
  };
}
