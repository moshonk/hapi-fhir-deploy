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
| `deploy` | `deploy --cloud gcp --name {lab_name}` | No |
| `expose-fhir` | `expose-fhir --cloud gcp --name {lab_name} --var project_id={project_id} --source-ranges {expose_source_ranges}` | Yes — names the exposure scope |
| `unexpose-fhir` | `unexpose-fhir --cloud gcp --name {lab_name} --var project_id={project_id}` | No |
| `expose-prometheus` | `expose-prometheus --cloud gcp --name {lab_name} --var project_id={project_id} --source-ranges {expose_source_ranges}` | Yes — names the exposure scope |
| `unexpose-prometheus` | `unexpose-prometheus --cloud gcp --name {lab_name} --var project_id={project_id}` | No |
| `pause-autoscaling` | `pause-autoscaling --replicas {pause_replicas}` (env: `KUBECONFIG` set from this lab's saved kubeconfig path) | No |
| `resume-autoscaling` | `resume-autoscaling` (env: `KUBECONFIG` as above) | No |
| `seed` | `seed --households {households} --individuals-per-household {individuals_per_household} --seed {echis_seed} --run {cliRunLabel}` (env: `FHIR_BASE_URL`, `LAB_SEED_GENERATOR_MODE=native`) | No |
| `benchmark` | `benchmark --profile {k6_profile} [--echis-tier {echis_tier}] --run {cliRunLabel}` (env: `FHIR_BASE_URL`, `K6_SCRIPT` per tier) | No |
| `report` | `report --run {cliRunLabel} --cloud gcp --name {lab_name} --profile {k6_profile}` | No |
| `down` | `down --cloud gcp --name {lab_name} --yes --var project_id={project_id} --var region={region} --var zone={zone} --var kubernetes_version={kubernetes_version}` | Yes — destroys infrastructure |
| `doctor` (prerequisites) | `doctor --cloud gcp --format json` | No — read-only (research.md §5; this is a new subcommand this feature adds to `scripts/lab` itself) |

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
- eCHIS tier selection (`echis_tier`) drives which `K6_SCRIPT` is passed for
  `benchmark` (`echis_load_100.js` for T2, `echis_load_1000.js` for T3, per
  `docs/echis-benchmark-tiers.md`) — this mapping lives in the GCP
  `ProviderAdapter`, not hardcoded in the generic action-trigger code.
