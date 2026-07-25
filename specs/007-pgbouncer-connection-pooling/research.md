# Phase 0 Research: PgBouncer Connection Pooling and Revised Connection Budget

All technical unknowns below were resolved during specification and validated against the current repository state (`charts/hapi-fhir-deploy/values.yaml`, `manifests/autoscaling/hapi-fhir-scaledobject.yaml`, `docs/autoscaling.md`, `infra/terraform/{aws,azure,gcp}/main.tf`, `.github/workflows/ci.yml`) rather than left as open `NEEDS CLARIFICATION` markers.

## Decision 1: Deployment topology — standalone Deployment, not a sidecar

- **Decision**: PgBouncer runs as its own Kubernetes Deployment (2+ replicas) with its own Service, not as a sidecar container in each HAPI FHIR pod.
- **Rationale**: A centralized pooler means adding HAPI replicas never adds real Postgres backend connections beyond the pooler's own fixed pool size — this is what actually breaks the current 1-replica-adds-10-connections math. A sidecar would add its own backend-connection floor per HAPI replica, defeating the purpose. A standalone Deployment is also portable across AWS/Azure/GCP, consistent with this repo's cloud-neutral wrapper-chart design (Constitution Principle I).
- **Alternatives considered**:
  - *Sidecar per HAPI pod*: rejected — each replica would still add its own backend-connection floor, reproducing the current scaling problem one layer down.
  - *Cloud-managed connection proxy* (e.g., a cloud-specific pooling add-on): rejected — ties the deployment to one cloud's product, breaking the existing three-cloud-portable Terraform/Ansible/Helm design.

## Decision 2: Pooling mode — `transaction`

- **Decision**: Configure PgBouncer in `pool_mode = transaction`.
- **Rationale**: HAPI's Hikari-pooled connections are held only for the duration of individual transactions (typical FHIR REST request/response), so transaction-mode pooling gets the multiplexing ratio needed to turn e.g. 100 Hikari-side connections into a small, bounded number of real Postgres backend connections. Session-mode pooling would not reduce backend connection count enough to matter.
- **Alternatives considered**:
  - *Session pooling*: rejected — a pooled server connection is held for the life of the client session, which for a long-lived HAPI Hikari connection provides no multiplexing benefit over the native (unpooled) tier.
  - *Statement pooling*: rejected — breaks multi-statement transactions, which HAPI's JPA layer relies on.

## Decision 3: Prepared-statement compatibility

- **Decision**: Pin a PgBouncer version that supports protocol-level prepared-statement pooling in transaction mode (PgBouncer >= 1.21), and validate Hikari/PostgreSQL-JDBC `prepareThreshold`/`cachePrepStmts` settings against it before promoting past the T4 benchmark tier. If the pinned version or validated configuration cannot avoid the incompatibility, the documented fallback is `prepareThreshold=0` (disable server-side prepare) on the JDBC side.
- **Rationale**: Classic PgBouncer transaction-mode pooling has documented friction with JDBC server-side prepared statements (a statement prepared on one backend connection may not exist on the next one a transaction is routed to). Newer PgBouncer versions added protocol support that avoids this; validating it explicitly (rather than assuming it works) avoids a class of hard-to-diagnose production query failures.
- **Alternatives considered**:
  - *Ignore and hope*: rejected — this is a known, documented failure mode, not a hypothetical one; silently shipping it would violate the "fail loudly" spirit of Constitution Principle III.
  - *Always disable prepared statements* (`prepareThreshold=0`) as the primary approach rather than a fallback: rejected as the primary choice — it forgoes a real performance benefit when the pinned PgBouncer version does support prepared-statement pooling, so it is kept as a documented fallback only.

## Decision 4: Enforcing `max_connections` in Terraform

- **Decision**: Add a `db_max_connections` variable to each of `infra/terraform/{aws,azure,gcp}/variables.tf`, wired through the cloud-appropriate mechanism: GCP `google_sql_database_instance.settings.database_flags`, a new `aws_db_parameter_group` resource referenced by `aws_db_instance.parameter_group_name`, and a new `azurerm_postgresql_flexible_server_configuration` resource named `max_connections`.
- **Rationale**: None of the three modules currently set this today (confirmed by reading all three `main.tf` files) — the "100" in the existing native-tier formula (`docs/autoscaling.md`, `.github/workflows/ci.yml:290`) is an assumption about cloud-default behavior, not an enforced value. Any revised formula built on top of an unenforced assumption would be unsafe. This closes that gap for both the native and pooled tiers.
- **Alternatives considered**:
  - *Leave as a documentation-only assumption, same as today*: rejected — this is precisely the gap User Story 2 exists to close; raising a ceiling on top of an unverified assumption compounds the risk.

## Decision 5: CI guardrail approach — new, separate step

- **Decision**: Add a new, independent CI step ("Check PgBouncer connection budget") that reads the new overlay file (`charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml`) and the new sibling ScaledObject (`manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml`), asserting the pooled formula only when those files are present, modeled on but structurally independent from the existing "Check Rev2 baseline decisions" step (`.github/workflows/ci.yml:140-390`, which asserts `maxReplicaCount <= floor((100-50)/10)` against the base `values.yaml` and `manifests/autoscaling/hapi-fhir-scaledobject.yaml`).
- **Rationale**: The existing step's assertions (`.github/workflows/ci.yml:342-344`) are hardcoded to the native-tier files and values; editing it in place to branch on pooling would blur the boundary this spec is designed to preserve — spec 003 stays "Implemented" and its guardrail stays provably unchanged. A separate step is also easier to reason about in review: a diff to the new step cannot silently weaken the existing native-tier assertions.
- **Alternatives considered**:
  - *Modify the existing step to branch on `enable_pgbouncer`*: rejected — increases coupling and risk of accidentally weakening the existing, working guardrail; harder to review in isolation.

## Decision 6: Bulk-load vs. serving connection allowance

- **Decision**: For this iteration, the distinction between the temporary bulk-load connection allowance and the committed steady-state serving ceiling is a documented, operator-run procedure (pause the ScaledObject or manually set replica/pool counts for the load window, then restore the committed configuration before serving traffic begins) rather than new automation.
- **Rationale**: Building an automated "bulk mode" toggle is meaningfully more implementation complexity (a new controller or job that mutates the ScaledObject) than this spec's core scope justifies for a first iteration, and the existing lab tooling (`scripts/lab`) already separates a `seed` phase from a `benchmark` phase, giving operators a natural point to apply this procedure manually. If the progressive benchmark's later tiers show this manual step is error-prone or frequently needed, automating it is a reasonable follow-up, not a blocker for this spec.
- **Alternatives considered**:
  - *Automate the bulk-mode toggle now*: deferred, not rejected outright — revisit if manual operation proves unreliable across T4/T5 runs.
