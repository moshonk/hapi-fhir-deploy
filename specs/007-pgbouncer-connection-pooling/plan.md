# Implementation Plan: PgBouncer Connection Pooling and Revised Connection Budget

**Branch**: `007-pgbouncer-connection-pooling` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-pgbouncer-connection-pooling/spec.md`

## Summary

Add an opt-in PgBouncer transaction-pooling tier in front of the external PostgreSQL database so HAPI FHIR can scale to more replicas than the current native connection budget allows (today: `maxReplicas <= floor((100-50)/10) = 5`, enforced by `.github/workflows/ci.yml`'s "Check Rev2 baseline decisions" step). The pooled tier is entirely additive: a new standalone PgBouncer Deployment, a new Helm values overlay applied on top of (never replacing) `charts/hapi-fhir-deploy/values.yaml`, a new documented pooled-tier formula alongside the existing native formula in `docs/autoscaling.md`, Terraform-enforced `max_connections` across all three cloud modules, and a new, separate CI guardrail step. When disabled (the default), behavior is byte-for-byte identical to today.

## Technical Context

**Language/Version**: Bash (`scripts/lab`), Ruby 3.x (CI guardrail scripts, loader/report scripts), HCL/Terraform `>=1.9.0,<2.0.0` (`infra/terraform/{aws,azure,gcp}`), YAML (Helm values, Kubernetes manifests, Ansible playbooks)

**Primary Dependencies**: PgBouncer (new, pinned container image/digest per Constitution III), Kubernetes 1.3x, KEDA (`keda.sh/v1alpha1` `ScaledObject`), External Secrets Operator, Helm 3.x, Ansible, Terraform providers `google`/`aws`/`azurerm`

**Storage**: External PostgreSQL 16/17 — unchanged. This feature adds a connection-pooling layer in front of it; it does not introduce a new datastore.

**Testing**: `helm lint` / `helm template` rendering, `ruby -rpsych` YAML-safe-load checks, `bash -n` / bundled Ansible/Terraform syntax checks, a new Ruby-based CI guardrail step (modeled on the existing "Check Rev2 baseline decisions" step at `.github/workflows/ci.yml:140`) asserting the pooled-tier formula against the new overlay files, and manual load-test validation at the T4 benchmark tier (10,000 concurrent users, from the sibling `008-echis-workload-benchmark` spec).

**Target Platform**: Kubernetes clusters on AWS, Azure, and GCP (the three existing `infra/terraform/` lab targets), namespace `fhir`.

**Project Type**: Infrastructure/deployment configuration (Helm chart overlay + Kubernetes manifests + Terraform + Ansible) — not an application; there is no `src/`/application test suite to extend.

**Performance Goals**: Support at least 10,000 concurrent users' worth of request load (T4) without exceeding the documented PostgreSQL connection budget or breaching existing latency/error-rate thresholds; the pooled-tier ceiling is provisional pending that load-test evidence, matching the existing provisional-RPS-threshold convention already used for the native tier.

**Constraints**: MUST NOT modify base `charts/hapi-fhir-deploy/values.yaml` or the existing native-formula CI guardrail assertion (spec 003 stays "Implemented" and green, unchanged). MUST preserve `minReplicaCount >= 2`, no scale-to-zero, and PodDisruptionBudget alignment per Constitution Principle V — including for the new PgBouncer Deployment itself. PgBouncer `transaction` pooling mode has known friction with JDBC/HikariCP server-side prepared statements and must be validated before use above T4.

**Scale/Scope**: 3 Terraform cloud modules gain one new variable each; ~10 new/changed manifest, chart-overlay, Ansible, and doc files; one new CI step; the feature is opt-in (`enable_pgbouncer: false` by default) so scope of behavior change when disabled is zero.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Chart-First Deployment | PASS | PgBouncer is a standalone Deployment for a resource the upstream `hapi-fhir-jpaserver` chart does not own — an explicitly allowed exception under this principle, matching the existing precedent of `manifests/autoscaling/hapi-fhir-scaledobject.yaml` and `manifests/runtime-rollout/hapi-fhir-deployment-rollout-patch.yaml` (both non-chart-owned resources living under `manifests/`). |
| II. Explicit External PostgreSQL | PASS | PgBouncer sits in front of, and does not replace, the external PostgreSQL 16/17 instance. `spring.datasource.*` remains explicit and Secret-backed; when pooling is enabled it points at the PgBouncer Service instead of the raw DB endpoint, but the Secret contract (`hapi-fhir-postgres`) is unchanged. |
| III. Version Pinning and Reproducibility | PASS (new obligation) | The new PgBouncer container image MUST be pinned to a reviewed digest (no `latest`), consistent with the existing HAPI image/chart pinning pattern in `charts/hapi-fhir-deploy/values.yaml` and `Chart.yaml`. |
| IV. Observable and Operable Runtime | PASS (new obligation) | PgBouncer must expose a liveness/readiness path and its own connection-pool stats (PgBouncer's built-in `SHOW POOLS`/`SHOW STATS` admin console, or a scrape-compatible exporter) so operators have a verification path for pool saturation, mirroring the existing Actuator/Micrometer pattern for HAPI itself. This is a design requirement carried into Phase 1, not a principle violation. |
| V. Bounded Scale and Safe Rollouts | PASS (core principle this spec extends) | The pooled tier still enforces a hard, documented ceiling (`maxReplicas_pooled <= floor(pgbouncer_max_client_conn / hikari_maximum_pool_size)`, itself bounded by real Postgres `max_connections`); no scale-to-zero; the new PgBouncer Deployment gets its own PodDisruptionBudget and conservative scale-down, consistent with the existing HAPI ScaledObject pattern. |
| Rev2 D1 (no Kafka/ZK) | PASS | Unaffected. |
| Rev2 D2 (`spring.datasource.*` explicit) | PASS | Unaffected — see Principle II above. |
| Rev2 D3 (Actuator/Micrometer over custom exporters) | PASS (new obligation) | This principle governs HAPI's own observability, not PgBouncer's; PgBouncer's stats surface should stay minimal (built-in admin console) rather than introducing a new bespoke exporter without justification. |
| Rev2 D4 (Postgres 16/17 only) | PASS | Unaffected. |
| Rev2 D5 (pinned versions) | PASS (new obligation) | See Principle III above. |
| Rev2 D6 (Hibernate Search stays disabled) | PASS | Unrelated / unaffected. |

No violations requiring justification — see Complexity Tracking below (empty).

## Project Structure

### Documentation (this feature)

```text
specs/007-pgbouncer-connection-pooling/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/             # Phase 1 output
│   ├── connection-budget-formula.md
│   ├── helm-values-overlay.md
│   └── terraform-max-connections.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

This is a deployment-configuration repository (Helm charts + Kubernetes manifests + Terraform + Ansible), not an application — there is no `src/`/`tests/` split to choose between. New and changed files fit the repo's existing per-concern directory convention:

```text
manifests/pgbouncer/                                  # NEW: standalone Deployment, Service, ConfigMap, PDB
manifests/external-secrets/hapi-fhir-pgbouncer-userlist.yaml   # NEW: mirrors hapi-fhir-postgres.yaml pattern
manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml    # NEW: sibling ScaledObject for the pooled ceiling
charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml     # NEW: additive overlay, applied alongside values.yaml
infra/terraform/{aws,azure,gcp}/{main,variables}.tf    # EXTENDED: new db_max_connections variable per module
ansible/group_vars/lab.yml                             # EXTENDED: enable_pgbouncer flag (default false)
ansible/playbooks/lab.yml                              # EXTENDED: import new playbook when flag is set
ansible/playbooks/15-deploy-pgbouncer.yml              # NEW: inserted between 00-install-addons and 20-deploy-hapi-fhir
ansible/templates/hapi-fhir-values.runtime.yaml.j2      # EXTENDED: point datasource at PgBouncer Service when enabled
docs/autoscaling.md                                    # EXTENDED: new "PgBouncer-Pooled Connection Budget" section
.github/workflows/ci.yml                               # EXTENDED: new, separate "Check PgBouncer connection budget" step
```

**Structure Decision**: Follow the existing per-concern `manifests/<topic>/` convention already established by `manifests/autoscaling/` and `manifests/runtime-rollout/` for chart-external resources, and the existing three-cloud `infra/terraform/{aws,azure,gcp}` layout for provisioning changes. No new top-level directories are introduced.

## Complexity Tracking

*No constitution violations requiring justification — table intentionally empty.*
