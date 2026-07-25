# Contract: Pooled Connection Budget Formula

This is the interface the new CI guardrail step ("Check PgBouncer connection budget") enforces. It is additive to, and must never be merged into, the existing native-tier formula contract already enforced by `.github/workflows/ci.yml`'s "Check Rev2 baseline decisions" step.

## Inputs

| Name | Source | Type |
| --- | --- | --- |
| `postgres_max_connections` | Terraform `db_max_connections` variable (`infra/terraform/{aws,azure,gcp}`), documented in `docs/autoscaling.md` | integer |
| `reserved_connections` | Documented constant in `docs/autoscaling.md` (mirrors the native tier's existing `reserved_connections = 50`) | integer |
| `pgbouncer_default_pool_size` | `ansible/group_vars/lab.yml` (`pgbouncer_default_pool_size`) — the single source of truth, templated into the PgBouncer Deployment's `DEFAULT_POOL_SIZE`/`MAX_DB_CONNECTIONS` env vars by `ansible/templates/pgbouncer-deployment.runtime.yaml.j2` | integer |
| `pgbouncer_replica_count` | `ansible/group_vars/lab.yml` (`pgbouncer_replica_count`) — templated into the same Deployment template's `spec.replicas` | integer |
| `pgbouncer_max_client_conn` | `ansible/group_vars/lab.yml` (`pgbouncer_max_client_conn`) — templated into the Deployment's `MAX_CLIENT_CONN` env var | integer |
| `hikari_maximum_pool_size` | `charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml` `extraConfig` (`spring.datasource.hikari.maximumPoolSize`) | integer |
| `maxReplicas_pooled` (declared) | `manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml` `spec.maxReplicaCount` | integer |

Note: there is deliberately no static `manifests/pgbouncer/deployment.yaml` or `configmap.yaml` — the Deployment is rendered per-lab by Ansible (it needs the per-lab DB endpoint), and pool-sizing settings are templated directly from `ansible/group_vars/lab.yml` into that same Deployment to avoid a second, driftable source of truth. A future CI guardrail (T027, deferred) reads `pgbouncer_default_pool_size`/`pgbouncer_replica_count`/`pgbouncer_max_client_conn` from `ansible/group_vars/lab.yml` directly, not from a rendered manifest.

## Invariants (CI MUST fail the build if violated)

1. `pgbouncer_default_pool_size * pgbouncer_replica_count <= (postgres_max_connections - reserved_connections)`
2. `maxReplicas_pooled <= floor(pgbouncer_max_client_conn / hikari_maximum_pool_size)`
3. `manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml`'s `minReplicaCount >= 2` (Constitution V, same floor as the native ScaledObject)
4. The pooled ScaledObject and the native ScaledObject (`manifests/autoscaling/hapi-fhir-scaledobject.yaml`) MUST NOT both target the same Deployment when rendered together — the pooled tier replaces the native ScaledObject's role, it does not run alongside it.
5. `docs/autoscaling.md` MUST contain the pooled formula text, marked provisional, in addition to (not replacing) the existing native formula text already asserted by the pre-existing CI step.

## Behavior when the pooled-tier files are absent

If `charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml` and `manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml` do not exist in a given checkout state (i.e., before this feature's manifests are added, or in a checkout that never opts in), this check MUST be a no-op pass, not a failure — it only activates once the pooled-tier files are present. This preserves the "opt-in, zero regression when disabled" requirement (spec FR-001).

## Non-goals

- This contract does not alter `.github/workflows/ci.yml`'s existing native-tier assertions (`postgres_max_connections = 100`, `reserved_connections = 50`, `maxReplicaCount <= floor((100-50)/10)` against the base `values.yaml`/`hapi-fhir-scaledobject.yaml`). Those remain exactly as implemented under spec 003.
