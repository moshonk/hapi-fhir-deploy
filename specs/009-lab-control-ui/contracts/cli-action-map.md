# Contract: UI Action → `scripts/lab` Invocation Map

This is the single place mapping each `ActionDef` (data-model.md) to the
exact `scripts/lab` invocation it produces, so the argument-builder code and
this doc cannot silently diverge from each other during implementation
(a task in `tasks.md` should assert this table against the argument-builder
via a unit test, one case per row).

All invocations run with `cwd` = repository root. `{field}` interpolates a
`ConfigField` value from the triggering `lab_configurations` row.

| Action | `scripts/lab` invocation | Confirmation required |
|---|---|---|
| `up` | `up --cloud gcp --name {lab_name} --auto-approve --var project_id={project_id} --var region={region} --var zone={zone} --var kubernetes_version={kubernetes_version} --var node_size={node_size} --var cluster_node_count={cluster_node_count} --var cluster_min_nodes={cluster_min_nodes} --var cluster_max_nodes={cluster_max_nodes} --var db_edition={db_edition} --var db_sku={db_sku} --var db_disk_size_gb={db_disk_size_gb} --var ttl_hours={ttl_hours}` | Yes — billable resource creation |
| `deploy` | `deploy --cloud gcp --name {lab_name} --extra-vars enable_pgbouncer={enable_pgbouncer} --extra-vars pgbouncer_default_pool_size={pgbouncer_default_pool_size}` | No |
| `expose-fhir` | `expose-fhir --cloud gcp --name {lab_name} --var project_id={project_id} --source-ranges {expose_source_ranges}` (env: `KUBECONFIG` set from this lab's saved kubeconfig path) | Yes — names the exposure scope |
| `unexpose-fhir` | `unexpose-fhir --cloud gcp --name {lab_name} --var project_id={project_id}` (env: `KUBECONFIG` as above) | No |
| `expose-prometheus` | `expose-prometheus --cloud gcp --name {lab_name} --var project_id={project_id} --source-ranges {expose_source_ranges}` (env: `KUBECONFIG` as above) | Yes — names the exposure scope |
| `unexpose-prometheus` | `unexpose-prometheus --cloud gcp --name {lab_name} --var project_id={project_id}` (env: `KUBECONFIG` as above) | No |
| `expose-grafana` | `expose-grafana --cloud gcp --name {lab_name} --var project_id={project_id} --source-ranges {expose_source_ranges}` (env: `KUBECONFIG` as above) | Yes — names the exposure scope and notes Grafana (unlike FHIR/Prometheus) requires login |
| `unexpose-grafana` | `unexpose-grafana --cloud gcp --name {lab_name} --var project_id={project_id}` (env: `KUBECONFIG` as above) | No |
| `pause-autoscaling` | `pause-autoscaling --replicas {pause_replicas}` (env: `KUBECONFIG` set from this lab's saved kubeconfig path) | No |
| `resume-autoscaling` | `resume-autoscaling` (env: `KUBECONFIG` as above) | No |
| `provision-shard-storage` | `provision-shard-storage --cloud gcp --name {lab_name} --auto-approve --var project_id={project_id} --capacity-gb {shard_output_capacity_gb}` (env: `KUBECONFIG` set from this lab's saved kubeconfig path -- its PV/PVC apply step shells out to `kubectl`, same requirement as `expose-fhir`/`pause-autoscaling`) | Yes — billable Filestore instance creation |
| `seed` | `seed --households {households} --individuals-per-household {individuals_per_household} --seed {echis_seed} --run {cliRunLabel}` (env: `FHIR_BASE_URL`, `LAB_SEED_GENERATOR_MODE=native`) | No |
| `benchmark` | `benchmark --profile {k6_profile} [--echis-tier {echis_tier}] --run {cliRunLabel}` (env: `FHIR_BASE_URL`, `K6_SCRIPT` per tier, `KUBECONFIG` set from this lab's saved kubeconfig path) | No |
| `report` | `report --run {cliRunLabel} --cloud gcp --name {lab_name} --profile {k6_profile}` | No |
| `down` | `down --cloud gcp --name {lab_name} --yes --var project_id={project_id} --var region={region} --var zone={zone} --var kubernetes_version={kubernetes_version}` | Yes — destroys infrastructure |
| `doctor` (prerequisites) | `doctor --cloud gcp --format json` | No — read-only (research.md §5; this is a new subcommand this feature adds to `scripts/lab` itself) |
| `exposures` (`GET /api/labs/:id/exposures`, `contracts/api.md`) | `exposures --cloud gcp --name {lab_name} --format json` (env: `KUBECONFIG` as above) | No — read-only, like `doctor`; not in `GCP_ACTIONS` (no trigger/confirm/log-stream/run-history), just a status query the UI polls |

Notes:

- `cliRunLabel` for `seed`/`benchmark`/`report` is derived from `lab_name`
  plus a short suffix disambiguating repeated runs against the same lab
  (e.g. `{lab_name}-{short-timestamp}`), not a separate form field — matches
  the runbook's own `--run` convention without adding operator-facing
  complexity. **Distinct from `actionRunId`** (`contracts/api.md`): this is
  a human-readable string passed to the CLI's `--run` flag, not the
  `action_runs` table's UUID primary key.
- `FHIR_BASE_URL` for `seed`/`benchmark` is not itself a `ConfigField`
  value the operator sets: per the runbook, it depends on whichever of
  `kubectl port-forward` (loopback) or `expose-fhir` (public IP) the
  operator is using for that lab at that moment. The UI resolves it from
  the last successful `expose-fhir` run's printed URL when present, falling
  back to `http://localhost:8080/fhir` (the documented port-forward
  default) — recorded as an implementation task, not a new form field.
- `pause_replicas` is deliberately not autofilled past the documented
  ceiling — `docs/autoscaling.md`'s native-tier `maxReplicaCount: 5` is
  shown as the default with the same ceiling warning the runbook itself
  gives (Step 8), rather than silently letting the field drift from that
  doc if the ceiling ever changes.
- `benchmark`'s `KUBECONFIG` isn't needed by `benchmark` itself (only
  `FHIR_BASE_URL` is) -- it's for `scripts/lab`'s
  `ensure_local_prometheus_remote_write`, which auto-detects a kubeconfig
  to open a local-only port-forward into Prometheus's remote-write
  endpoint, streaming live k6 metrics into Grafana by default regardless
  of which tier/profile is running (`docs/lab-cli.md`'s "Live k6 metrics
  in Grafana" section). Without it, every UI-triggered benchmark would
  silently run without live metrics.
- eCHIS tier selection (`echis_tier`) drives which `K6_SCRIPT` is passed for
  `benchmark` (`echis_load_100.js` for T2, `echis_load_1000.js` for T3, per
  `docs/echis-benchmark-tiers.md`) — this mapping lives in the GCP
  `ProviderAdapter`, not hardcoded in the generic action-trigger code.
- `report`'s `{cliRunLabel}` is **not** freshly generated like `seed`/
  `benchmark`'s — it MUST reuse the `cliRunLabel` of the run whose artifacts
  it's reporting on (a fresh label would point `--run` at a directory that
  was never written). The trigger endpoint resolves it, in order: an
  explicit `targetRunId` in the request body (that run's stored
  `cli_run_label`), or, if omitted, the lab's most recent **succeeded**
  `benchmark` run. If neither resolves, the trigger is refused with `400`
  rather than silently generating a label that doesn't exist on disk.
- `enable_pgbouncer` (`deploy`) is always passed explicitly, true or false,
  never conditionally omitted -- so toggling it OFF on a later redeploy of
  an already-pooled lab actually disables the tier again (`ansible/
  group_vars/lab.yml`'s own `enable_pgbouncer: false` default only applies
  when the extra-var is absent entirely). Spec 007's opt-in pooled
  connection tier: swaps in the pooled `ScaledObject` in place of the
  native one (`docs/autoscaling.md`), required for eCHIS tiers T4/T5 and
  recommended before `load`/`stress` k6 profiles.
- `provision-shard-storage` is the UI's entry point for the ReadWriteMany
  PVC `benchmark --in-cluster --parallel-shards N` (N > 1) requires --
  `manifests/k6-shard-job/README.md`'s documented prerequisite. GCP-only,
  same as the `expose-*` actions; a targeted Terraform apply against the
  lab's existing `up` workspace (no other resource touched), then a static
  PV/PVC applied via `kubectl`. Torn down automatically by `down`'s
  `terraform destroy` -- no separate unprovision action.
- `ActionDef.confirmationMessage` (`up`, `down`, `expose-fhir`,
  `expose-prometheus`, `expose-grafana`, `provision-shard-storage`) may contain `{field_key}`
  placeholders referencing this provider's own `ConfigField` keys (e.g.
  `{expose_source_ranges}`). `expose-grafana`'s message also contains a
  literal `{.data.admin-password}` kubectl jsonpath expression, which is
  **not** a placeholder — the interpolation regex only matches
  `[a-zA-Z0-9_]+` between braces, so dots/hyphens pass through untouched.
  `GET /api/providers` serves the raw, unresolved template; only the
  trigger endpoint's `409` response carries the value interpolated against
  the triggering lab's live field values (FR-012 — name the actual
  configured value, e.g. the real source-range CIDR, not a generic
  warning). The frontend never shows the raw template.
