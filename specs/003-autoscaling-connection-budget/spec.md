# Feature Specification: Autoscaling Connection Budget

**Feature Branch**: `003-autoscaling-connection-budget`

**Created**: 2026-07-18

**Status**: Draft

**Input**: GitHub issue #5, issue #1 epic, docs/external-postgres.md, and repository constitution.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scale on Request Rate Safely (Priority: P1)

As an SRE, I can configure HAPI FHIR autoscaling from Prometheus request-rate metrics while preserving a minimum of two replicas.

**Why this priority**: Request-rate scaling is the primary throughput goal from issue #5 and must not introduce scale-to-zero behavior.

**Independent Test**: Apply the autoscaling configuration in a test cluster and confirm desired replicas increase when the Prometheus RPS trigger exceeds the configured threshold.

**Acceptance Scenarios**:

1. **Given** steady request traffic above the configured threshold, **When** Prometheus reports increased `http_server_requests_seconds_count` rate, **Then** the autoscaler increases HAPI FHIR replicas.
2. **Given** traffic drops, **When** the autoscaler evaluates scale-down, **Then** it keeps at least two replicas.

---

### User Story 2 - Enforce PostgreSQL Connection Ceiling (Priority: P1)

As a database owner, I can verify autoscaling will not exceed the PostgreSQL connection budget implied by HAPI replicas and Hikari pool size.

**Why this priority**: Preventing database connection exhaustion is the central safety constraint for scaling.

**Independent Test**: Inspect committed autoscaling limits and docs to confirm `maxReplicas <= floor((max_connections - reserved) / hikari_maximum_pool_size)`.

**Acceptance Scenarios**:

1. **Given** concrete environment values for `max_connections`, `reserved`, and Hikari maximum pool size, **When** the replica ceiling is calculated, **Then** autoscaler `maxReplicas` is less than or equal to the calculated ceiling.
2. **Given** desired capacity exceeds the native PostgreSQL budget, **When** the spec is planned, **Then** PgBouncer transaction pooling is documented as required before raising the ceiling.

---

### User Story 3 - Preserve Secondary CPU Protection (Priority: P2)

As an operator, I can use a CPU trigger as a secondary signal so pods scale when CPU pressure rises even if request-rate signals lag.

**Why this priority**: CPU is a useful fallback but must not override the database connection cap.

**Independent Test**: Simulate CPU pressure and verify the autoscaler can increase replicas only up to the configured maximum.

**Acceptance Scenarios**:

1. **Given** CPU utilization exceeds the target, **When** autoscaling evaluates, **Then** desired replicas may increase.
2. **Given** CPU remains high after reaching `maxReplicas`, **When** autoscaling evaluates, **Then** the autoscaler does not exceed the connection-budget ceiling.

### Edge Cases

- Prometheus metrics are missing, stale, or labeled differently from the expected query.
- Hikari maximum pool size changes in runtime tuning work before autoscaling is implemented.
- PostgreSQL reserved connection assumptions differ by managed service.
- Desired RPS requires more replicas than the native database budget allows.
- KEDA CRDs are unavailable and native HPA must be used instead.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Autoscaling MUST use either KEDA or HPA with `minReplicaCount` or equivalent set to at least 2.
- **FR-002**: The primary scaling signal MUST be a Prometheus query based on `rate(http_server_requests_seconds_count{job="hapi-fhir-actuator"}[2m])` or a documented equivalent metric/query produced by the observability spec.
- **FR-003**: Autoscaling MUST include a secondary CPU trigger with a target near 70 percent unless load testing documents a better threshold.
- **FR-004**: `maxReplicas` MUST be derived from `floor((max_connections - reserved) / hikari_maximum_pool_size)`.
- **FR-005**: The committed docs MUST include concrete environment values used for `max_connections`, `reserved`, `hikari_maximum_pool_size`, and resulting `maxReplicas`.
- **FR-006**: The implementation MUST state when PgBouncer transaction pooling becomes required and MUST NOT silently exceed the native PostgreSQL connection budget.
- **FR-007**: Final per-pod RPS threshold MUST be documented after load testing; before load testing, a conservative placeholder MUST be marked as provisional.
- **FR-008**: Autoscaling MUST preserve the external PostgreSQL and no scale-to-zero architecture constraints.
- **FR-009**: Autoscaler scale-down behavior MUST align with the runtime rollout controls spec.

### Key Entities

- **Autoscaler**: KEDA ScaledObject or Kubernetes HPA controlling HAPI FHIR replicas.
- **Prometheus RPS Trigger**: Request-rate query used as the primary scale-out signal.
- **CPU Trigger**: Secondary scale-out signal for CPU pressure.
- **Connection Budget**: The maximum allowed HAPI database connections after reserved PostgreSQL capacity is subtracted.
- **PgBouncer Requirement**: The documented condition for adding transaction pooling.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Autoscaler configuration never permits fewer than two HAPI FHIR replicas.
- **SC-002**: `maxReplicas` is mathematically justified in committed docs and cannot exceed the calculated database connection ceiling.
- **SC-003**: Both request-rate and CPU triggers can be verified in a test cluster or clearly documented with blocked validation reasons.
- **SC-004**: The docs identify the load-tested per-pod RPS threshold or mark it as provisional pending load testing.
- **SC-005**: Operators can recalculate the replica ceiling in under 10 minutes using only committed documentation and known database values.

## Assumptions

- Observability work has made the HAPI FHIR request-rate metric available before autoscaling is enabled in production.
- Initial deployments keep Hikari maximum pool size at the currently documented value unless runtime tuning updates it.
- PgBouncer is out of scope unless the target environment's required replicas exceed native PostgreSQL capacity.

## Source Context

- GitHub issues: #1, #5.
- Related specs: `002-observability-pipeline`, `004-runtime-rollout-controls`.
