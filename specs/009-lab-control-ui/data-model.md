# Phase 1 Data Model: Lab Control UI

Entities as introduced in `spec.md`'s "Key Entities" section, made concrete.
Storage per `research.md` §3: SQLite (`node:sqlite`) for structured records,
flat append-only files for log bodies.

## ProviderAdapter (code construct, not a stored row)

Not persisted — a static, in-code registry (`{ gcp: GcpAdapter }` for this
feature). Documented here because every other entity below is shaped by it.

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `"gcp"`. Matches `scripts/lab --cloud` values. |
| `label` | string | Display name, e.g. "Google Cloud (GKE + Cloud SQL)". |
| `configFields` | `ConfigField[]` | This provider's field schema (below). |
| `actions` | `ActionDef[]` | This provider's available actions (below). |
| `prerequisiteChecks` | `PrerequisiteCheckDef[]` | Provider-specific checks layered on top of the provider-agnostic list (Ruby/k6/Java/Terraform/Helm/kubectl/Ansible apply to every provider; `gcloud`/`gke-gcloud-auth-plugin`/ADC are GCP-only). |

### ConfigField

| Field | Type | Notes |
|---|---|---|
| `key` | string | e.g. `"node_size"`, `"project_id"`. |
| `label` | string | Form label. |
| `scope` | `"common" \| "provider"` | Satisfies FR-017: common fields (name, ttl_hours, k6 profile, eCHIS tier/households/individuals/seed) render identically across providers; provider fields render only for the selected provider. |
| `type` | `"string" \| "number" \| "enum" \| "boolean"` | Drives form control. |
| `enumValues` | string[] | Only for `type: "enum"`. |
| `default` | value \| `null` | `null` marks the field as blocking (FR-002) — only `project_id` has `default: null` for the GCP adapter at launch. |
| `required` | boolean | Derived as `default === null`, kept explicit for clarity. |
| `helpText` | string | Short inline guidance, sourced from `docs/gcp-echis-t3-lab-runbook.md`/`docs/lab-cli.md`. |
| `cliMapping` | string | How this field becomes a CLI flag/env var, e.g. `"--var node_size={value}"` or `"env:FHIR_BASE_URL"`. Documented in full in `contracts/cli-action-map.md`. |

GCP adapter's `configFields` (defaults sourced from
`docs/gcp-echis-t3-lab-runbook.md` Steps 3/5 and `docs/lab-cli.md`):

| key | scope | default |
|---|---|---|
| `lab_name` | common | `"hapi-fhir-lab"` (pattern `^[a-z][a-z0-9-]{2,31}$`, validated client-side to match the CLI's own naming rule, not re-validated server-side beyond passing it through) |
| `ttl_hours` | common | `4` |
| `echis_tier` | common | `null` selection defaulting to a "custom households" mode; when a tier (`T2`/`T3`) is picked, `households`/`individuals_per_household`/`seed` autofill from `docs/echis-benchmark-tiers.md`'s published tier shapes |
| `households` | common | `33333` (T2 shape) |
| `individuals_per_household` | common | `3` |
| `echis_seed` | common | `12345` |
| `k6_profile` | common | `"load"` |
| `project_id` | provider | `null` (blocking) |
| `region` | provider | `"us-central1"` |
| `zone` | provider | `"us-central1-a"` |
| `kubernetes_version` | provider | `"1.35.6-gke.1250000"` |
| `node_size` | provider | `"e2-standard-4"` |
| `cluster_node_count` | provider | `3` |
| `cluster_min_nodes` | provider | `3` |
| `cluster_max_nodes` | provider | `6` |
| `db_edition` | provider | `"ENTERPRISE"` |
| `db_sku` | provider | `"db-custom-2-7680"` |
| `db_disk_size_gb` | provider | `256` |
| `expose_source_ranges` | provider | `"0.0.0.0/0"` (matches the CLI's own default; the confirmation dialog for `expose-fhir`/`expose-prometheus`/`expose-grafana` names this value explicitly per FR-012) |
| `shard_output_capacity_gb` | provider | `1024` (Filestore BASIC_HDD's billed floor; `provision-shard-storage`'s confirmation dialog names this value explicitly per FR-012) |
| `enable_pgbouncer` | common | `false` (spec 007's opt-in pooled connection tier; `deploy` always passes this explicitly via `--extra-vars`, true or false, per `contracts/cli-action-map.md`) |
| `pgbouncer_default_pool_size` | common | `20` (real Postgres connections per PgBouncer replica; total = this * `pgbouncer_replica_count`, must stay within the budget in `docs/autoscaling.md`) |

### ActionDef

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `"up"`, `"expose-fhir"`. |
| `label` | string | Display name/verb, e.g. "Provision infrastructure". |
| `cliSubcommand` | string | The literal `scripts/lab` subcommand invoked. |
| `scope` | `"common" \| "provider"` | `expose-fhir`/`expose-prometheus`/`expose-grafana`/`unexpose-fhir`/`unexpose-prometheus`/`unexpose-grafana`/`provision-shard-storage` are `"provider"` (GCP-only per `docs/lab-cli.md`); the rest are `"common"`. |
| `requiresConfirmation` | boolean | True for `up`, `down`, `expose-fhir`, `expose-prometheus`, `expose-grafana`, `provision-shard-storage` (FR-012). |
| `confirmationMessage` | string \| `null` | States the concrete consequence (billable resources / destructive teardown / public 0.0.0.0/0 exposure), populated with the live config values (e.g. actual `source_ranges`) at confirm time. |
| `requiredPrerequisiteIds` | string[] | Which `PrerequisiteCheckDef`s must be passing (or explicitly overridden) before this action is triggerable (FR-011). |

### PrerequisiteCheckDef

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `"terraform"`, `"gcloud-adc"`. |
| `label` | string | Display name. |
| `severity` | `"blocking" \| "warning"` | Mirrors `scripts/lab doctor`'s own pass/warn/fail classification (research.md §5) — the UI does not re-derive severity independently. |

## Stored entities (SQLite)

### lab_configurations

| Column | Type | Notes |
|---|---|---|
| `id` | text (uuid), PK | |
| `provider` | text | `"gcp"` for this feature. |
| `name` | text | Operator-facing label for this saved configuration (defaults to the `lab_name` field value). |
| `fields_json` | text (JSON) | Serialized `{ [ConfigField.key]: value }` map — the actual values (defaults + edits), not the schema. |
| `created_at` | text (ISO 8601) | |
| `updated_at` | text (ISO 8601) | |

A "Lab" in this UI is identified by its `lab_name` value, matching how
`scripts/lab` itself scopes state (Terraform workspace name, artifact
directory `ansible/artifacts/lab/<cloud>/<name>/`); `lab_configurations`
rows are the editable form state that produces the `--name` used in every
action invocation for that lab.

### action_runs

| Column | Type | Notes |
|---|---|---|
| `id` | text (uuid), PK | Also used as the SSE stream path segment. |
| `lab_configuration_id` | text, FK → `lab_configurations.id` | |
| `action_name` | text | Matches `ActionDef.name`. |
| `status` | text | `pending \| running \| succeeded \| failed`. |
| `command_preview` | text | The exact resolved command line (FR-003), captured at trigger time. |
| `log_file_path` | text | Path to this run's append-only stdout/stderr capture file, under `ansible/artifacts/lab/ui/runs/<id>.log`. |
| `started_at` | text (ISO 8601, nullable) | |
| `ended_at` | text (ISO 8601, nullable) | |
| `exit_code` | integer, nullable | |

Run history (FR-009) is simply the set of `action_runs` rows for a given
`lab_configuration_id`, newest first, each linking back to the exact
configuration values used (`fields_json` at that point — see note below).

**Note on configuration snapshotting**: because `lab_configurations` is
mutable (the operator keeps editing the same saved form) but `action_runs`
must remain accurate to what actually ran, `command_preview` captures the
fully-resolved command at trigger time, which is sufficient to answer "what
configuration produced this run" (FR-009) without needing to snapshot the
entire `fields_json` blob per run.

### operator_sessions (in-memory, not SQLite)

Per `research.md` §6, sessions are intentionally not persisted to SQLite —
an in-memory `Map<sessionToken, { createdAt, expiresAt }>` is sufficient
(single operator, same-host, restart-clears-session is an accepted
trade-off recorded in `spec.md`'s Assumptions).

## State transitions

`action_runs.status`: `pending → running → (succeeded | failed)`, set solely
by the spawned child process's lifecycle (spawn = `running`; exit code `0` =
`succeeded`; nonzero = `failed`). No other transition path exists — in
particular, there is no UI-initiated "cancel" transition in this feature's
scope (not requested by the spec; an operator who needs to stop a running
`scripts/lab` step still does so as documented today, e.g. Ctrl-C on the
underlying process is out of scope for a v1 focused on getting started
simply).

`lab_configurations` has no status of its own beyond the per-field validity
implied by `ConfigField.required` (a configuration is "launchable" exactly
when every required field is non-null — this is a derived, not stored,
property).
