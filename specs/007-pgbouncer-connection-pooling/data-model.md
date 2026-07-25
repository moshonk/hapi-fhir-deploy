# Phase 1 Data Model: PgBouncer Connection Pooling and Revised Connection Budget

This feature has no application data model — it is infrastructure/deployment configuration. The "entities" below are configuration objects and their relationships, derived from the spec's Key Entities section.

## PgBouncer Deployment

- **Represents**: The standalone connection-pooling component sitting between HAPI FHIR pods and external PostgreSQL.
- **Key attributes**: replica count (>= 2, mirrors HAPI's own minimum per Constitution V), `pool_mode` (fixed: `transaction`), `default_pool_size`, `max_client_conn`, pinned container image digest.
- **Relationships**: Reuses the existing `hapi-fhir-postgres` Secret's `DB_PASSWORD` for its upstream PostgreSQL connection; the pinned image (`edoburu/pgbouncer`) auto-derives its own client-auth list from `DB_USER`/`DB_PASSWORD` at startup, so no separate ExternalSecret is needed. Is the upstream target of the HAPI FHIR datasource URL when pooling is enabled. Is fronted by its own Kubernetes Service.
- **Validation rules**: `pgbouncer_server_connections = default_pool_size * replica_count` MUST be `<= (postgres_max_connections - reserved_connections)` (see Connection Budget Formula below).
- **State**: Not present at all when `enable_pgbouncer: false` (default) — this is a presence/absence toggle, not a runtime state machine.

## Native Connection Budget (unchanged, spec 003)

- **Represents**: The existing, already-Implemented formula governing HAPI FHIR replica count when pooling is disabled.
- **Key attributes**: `postgres_max_connections`, `reserved_connections`, `hikari_maximum_pool_size`, derived `maxReplicas_native`.
- **Relationships**: Enforced today by `.github/workflows/ci.yml`'s "Check Rev2 baseline decisions" step against `charts/hapi-fhir-deploy/values.yaml` and `manifests/autoscaling/hapi-fhir-scaledobject.yaml`.
- **Validation rules**: `maxReplicas_native <= floor((postgres_max_connections - reserved_connections) / hikari_maximum_pool_size)`. This spec does not change this formula, its inputs, or its enforcement.

## Pooled Connection Budget (new)

- **Represents**: The formula and configured limits governing HAPI FHIR replica count once pooling is enabled.
- **Key attributes**: `pgbouncer_default_pool_size`, `pgbouncer_replica_count`, `pgbouncer_max_client_conn`, derived `maxReplicas_pooled`.
- **Relationships**: Additive to, documented alongside, the Native Connection Budget in `docs/autoscaling.md`. Enforced by the new, separate "Check PgBouncer connection budget" CI step against `charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml` and `manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml`.
- **Validation rules**:
  - `pgbouncer_server_connections = pgbouncer_default_pool_size * pgbouncer_replica_count <= (postgres_max_connections - reserved_connections)`
  - `maxReplicas_pooled <= floor(pgbouncer_max_client_conn / hikari_maximum_pool_size)`
  - Marked provisional (analogous to the existing provisional per-pod RPS threshold) until validated by T4-tier load testing.

## Bulk-Load Allowance (new, procedural)

- **Represents**: A temporary, time-boxed, operator-controlled connection budget used only during one-time large dataset imports (see Decision 6 in `research.md`).
- **Key attributes**: Manually set replica/pool counts for the load window; a documented start/end procedure; autoscaling paused for the duration.
- **Relationships**: Precedes, and is fully retired before, steady-state serving under either the Native or Pooled Connection Budget. Used by the `seed` phase of the sibling `008-echis-workload-benchmark` spec's tier data generation.
- **Validation rules**: MUST NOT exceed real `postgres_max_connections` at any point, regardless of which tier (native or pooled) governs steady-state serving afterward.

## Terraform `db_max_connections` Variable

- **Represents**: The Terraform-enforced value of PostgreSQL's real connection limit, replacing today's unenforced "100" assumption.
- **Key attributes**: Integer, one instance per cloud module (`infra/terraform/{aws,azure,gcp}/variables.tf`), wired to a cloud-specific mechanism (see `contracts/terraform-max-connections.md`).
- **Relationships**: Is the authoritative source for `postgres_max_connections` in both the Native and Pooled Connection Budget formulas — both formulas MUST reference the same provisioned value, not a hardcoded literal, once this spec lands.

## Helm Values Overlay (`values-pgbouncer-tier.yaml`)

- **Represents**: The additive Helm values file applied alongside (not instead of) the base `charts/hapi-fhir-deploy/values.yaml` when the pooled tier is enabled.
- **Key attributes**: Raised `hikari.maximumPoolSize` / `replicaCount` guidance for the pooled tier, pointed at the PgBouncer Service instead of the raw database endpoint.
- **Relationships**: Applied as an additional entry in Ansible's `values_files` list, after the base file, so later values win per standard Helm overlay semantics. Base `values.yaml` is never edited by this feature.
