# Hibernate Search Strategy Memo

Status: Accepted for the starter baseline

Issue: #4

Decision: Option A, keep advanced Hibernate Search indexing disabled for now.

## Context

The current deployment starts multiple HAPI FHIR replicas. Embedded Lucene indexes are local filesystem state inside each pod, so enabling embedded Lucene in this topology would create per-pod index divergence and inconsistent query behavior. The chart values therefore keep `hibernate.search.enabled: false` explicit until a shared indexing backend is designed and implemented.

## Options

### Option A: Disable Advanced Indexing

Keep `spring.jpa.properties.hibernate.search.enabled: false` in `charts/hapi-fhir-deploy/values.yaml`.

Operational complexity and cost:

- Lowest operational complexity. No extra search cluster, storage class, credentials, backups, shard sizing, or JVM tuning are required.
- Lowest platform cost. The deployment continues to rely on HAPI FHIR and PostgreSQL only.

Query consistency under replica scaling:

- Avoids inconsistent embedded Lucene state across replicas because no per-pod advanced search index is maintained.
- Search behavior is limited to capabilities available without Hibernate Search advanced indexing.

Performance considerations:

- Avoids additional write amplification from maintaining a secondary search index.
- Terminology-heavy and full-text workloads may be less capable or slower than a tuned shared search backend.

Security and data governance:

- Keeps PHI-bearing indexed content out of an additional datastore.
- Avoids a new access-control surface, network path, backup set, encryption domain, and retention policy.

Migration path:

- Continue operating with explicit disabled indexing.
- Revisit when a workload requires terminology or full-text search behavior that the disabled baseline cannot support.

Rollback plan:

- No runtime rollback is required because no new indexing infrastructure is introduced.
- If a later experiment enables shared search, rollback returns `hibernate.search.enabled` to `false` and removes backend connection settings after validating HAPI startup.

### Option B: Shared Elasticsearch/OpenSearch Backend

Provision a shared Elasticsearch or OpenSearch cluster and configure HAPI FHIR to use it as the Hibernate Search backend.

Operational complexity and cost:

- Adds a stateful search platform with capacity planning, upgrades, snapshot/restore, shard lifecycle, alerting, and incident response.
- Increases infrastructure cost through search nodes, persistent volumes, backup storage, and operational support.

Query consistency under replica scaling:

- Provides a shared indexing target, so HAPI replicas do not rely on per-pod filesystem indexes.
- Requires operational care around index refresh, reindexing, and backend availability during HAPI writes.

Performance considerations:

- Can improve full-text and terminology-oriented workloads when sized and tuned correctly.
- Adds indexing write overhead and can introduce backpressure if the backend is undersized or unavailable.

Security and data governance:

- Indexed FHIR content can contain sensitive clinical data and must be treated as PHI-bearing data.
- Requires encryption, authentication, authorization, network policy, audit logging, backup governance, retention rules, and secret management.

Migration path:

- Create a dedicated implementation issue before enabling this option.
- Provision the backend with production storage, snapshots, network controls, credentials, and monitoring.
- Add Secret-backed HAPI backend settings through chart values.
- Run a controlled reindexing plan and compare query behavior before routing production traffic.

Rollback plan:

- Stop writes or place the system in a controlled maintenance window if required by the migration procedure.
- Disable Hibernate Search in chart values, remove backend settings, redeploy HAPI, and verify startup, metadata, readiness, and representative searches.
- Preserve backend snapshots until data owners approve deletion.

## Recommendation

Choose Option A for the starter baseline.

Rationale:

- The current architecture prioritizes a reproducible Helm-first HAPI FHIR deployment with external PostgreSQL and multiple application replicas.
- Embedded Lucene would be inconsistent across replicas, and a shared Elasticsearch/OpenSearch backend is too large to introduce without a separate design for cost, security, migration, rollback, and operations.
- Keeping `hibernate.search.enabled: false` explicit avoids accidental H2-like fallback behavior and makes the current capability limit visible in code review.

## Follow-Up Path for Option B

Option B is not selected in this memo, so no implementation issues are created by this change.

If a future workload requires shared search, create follow-up issues for:

- Elasticsearch/OpenSearch backend provisioning, sizing, backup, and restore.
- Secret-backed HAPI Hibernate Search backend configuration.
- Network policy, authentication, encryption, audit logging, and data retention controls.
- Reindexing, performance validation, and representative query acceptance tests.
- Rollback runbook and production migration plan.

## Current Guardrails

- `charts/hapi-fhir-deploy/values.yaml` keeps `hibernate.search.enabled: false` explicit.
- CI requires an explicit Hibernate Search setting.
- CI rejects enabling Hibernate Search for a multi-replica deployment unless shared backend type and hosts are configured.
- No repository manifests provision Lucene, Elasticsearch, or OpenSearch resources in the starter baseline.
