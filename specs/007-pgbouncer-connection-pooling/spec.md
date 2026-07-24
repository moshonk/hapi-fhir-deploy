# Feature Specification: PgBouncer Connection Pooling and Revised Connection Budget

**Feature Branch**: `007-pgbouncer-connection-pooling`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "PgBouncer transaction pooling and revised PostgreSQL connection-budget ceiling for HAPI FHIR JPA Server, to unblock a progressive eCHIS benchmark peaking at 100,000 concurrent users. Additive extension of specs/003-autoscaling-connection-budget: new opt-in pooled tier, revised documented formula, Terraform-enforced max_connections across all three cloud modules, additive Helm values overlay, separate CI guardrail, explicit bulk-load-vs-serving distinction, and documented prepared-statement compatibility risk."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Raise the Safe Replica Ceiling Without Regressing Today's Behavior (Priority: P1)

As a platform operator, I can enable a pooled connection tier that raises the safe HAPI FHIR replica ceiling beyond the current native-database limit, so the system can serve significantly higher concurrent load without exceeding the PostgreSQL connection budget.

**Why this priority**: This is the core capability that unblocks every higher-scale benchmark tier and any real deployment beyond today's ~50-connection ceiling. Without it, nothing else in the progressive benchmark can proceed past today's proven scale.

**Independent Test**: Enable the pooled tier in a test cluster with a documented pool size and confirm the derived replica ceiling is correctly computed and enforced, and that PostgreSQL server-side connections never exceed the configured budget under sustained load.

**Acceptance Scenarios**:

1. **Given** the pooled tier is disabled, **When** the system is deployed, **Then** behavior and connection ceiling are identical to today's native tier (zero regression).
2. **Given** the pooled tier is enabled with a documented pool size and replica count, **When** HAPI FHIR scales to its configured maximum replicas, **Then** total PostgreSQL server-side connections remain within the configured budget.
3. **Given** the pooled tier is enabled, **When** load exceeds the previous native-tier ceiling, **Then** the system continues serving without connection-exhaustion errors up to the new documented ceiling.

---

### User Story 2 - Enforce the Connection Limit Infrastructure Actually Provisions (Priority: P1)

As a database owner, I can confirm the PostgreSQL connection limit assumed by the budget formula is actually enforced by provisioned infrastructure, not merely assumed in documentation, so the connection-budget math is trustworthy.

**Why this priority**: The current formula relies on an unverified assumption that no cloud environment actually enforces today. Raising any ceiling on top of an unenforced assumption would be unsafe.

**Independent Test**: Inspect the provisioned PostgreSQL instance configuration in each supported cloud and confirm the configured connection limit matches the value the connection-budget formula assumes.

**Acceptance Scenarios**:

1. **Given** a freshly provisioned PostgreSQL instance in any supported cloud, **When** its configuration is inspected, **Then** its maximum-connections value matches the documented value used in the connection-budget formula.
2. **Given** an operator changes the target maximum-connections value, **When** infrastructure is reprovisioned, **Then** the new value is enforced by the database configuration itself, not merely referenced in documentation.

---

### User Story 3 - Separate Bulk Data-Load Capacity From Steady-State Serving Capacity (Priority: P2)

As an operator running a one-time bulk data-load, I can temporarily exceed the steady-state serving ceiling in a controlled, time-boxed way, so large datasets can be loaded quickly without permanently oversizing the serving tier.

**Why this priority**: Bulk loading and steady-state serving have different, legitimate connection needs. Conflating them either makes loading too slow (constrained to the serving ceiling) or makes the permanent footprint unnecessarily large and expensive.

**Independent Test**: Run a bulk data-load with a temporarily raised connection allowance, confirm the system returns to the committed steady-state ceiling before serving traffic begins, and confirm the temporary allowance never exceeds real database connection limits.

**Acceptance Scenarios**:

1. **Given** a bulk data-load is in progress, **When** the temporary allowance is active, **Then** it does not exceed real database connection limits regardless of tier.
2. **Given** a bulk data-load completes, **When** serving traffic begins, **Then** the system operates within the committed steady-state ceiling, not the temporary loading allowance.

### Edge Cases

- What happens when the pooled tier is enabled but the pooler itself becomes unavailable (introducing a new single point of failure)?
- How does the system handle a mismatch between the documented connection-limit assumption and the actual provisioned value (e.g., a cloud default changes)?
- What happens when application-level prepared-statement caching conflicts with transaction-mode pooling (query failures or silently incorrect results)?
- How does the system behave during a scale-up event that would briefly exceed the pooled ceiling before backpressure takes effect?
- What happens if an operator enables the pooled tier without first raising the underlying database's connection limit?
- What happens when both the native and pooled tiers are accidentally enabled at the same time?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an opt-in pooled connection tier that MUST NOT alter default (pooling-disabled) behavior when not enabled.
- **FR-002**: When the pooled tier is enabled, the system MUST derive and document a maximum safe HAPI FHIR replica count from a formula based on pooler capacity and the real database connection budget, additive to and clearly distinguished from the existing native-tier formula.
- **FR-003**: The pooled-tier connection-budget formula MUST be documented alongside, not replacing, the existing native-tier formula, and MUST be marked provisional until validated by load testing at a defined higher-concurrency benchmark tier.
- **FR-004**: Provisioning MUST enforce the assumed PostgreSQL maximum-connections value on the actual database instance in every supported cloud environment, rather than leaving it as a documentation-only assumption.
- **FR-005**: The system MUST distinguish between a temporary, time-boxed bulk data-load connection allowance and the committed steady-state serving ceiling, and MUST document that the bulk-load allowance is not sustained during normal serving.
- **FR-006**: The pooled tier MUST NOT allow total PostgreSQL server-side connections to exceed the configured database connection budget under any documented operating condition (steady-state serving or bulk load).
- **FR-007**: The system MUST document known compatibility risks between transaction-mode connection pooling and application-level prepared-statement caching, and MUST specify the validated configuration that avoids them.
- **FR-008**: Enabling the pooled tier MUST preserve existing safety properties already required of the deployment (minimum replica count, no scale-to-zero, graceful shutdown).
- **FR-009**: The pooled tier's automated validation MUST run independently of, and MUST NOT cause regressions in, the existing native-tier connection-budget validation.

### Key Entities

- **Connection Pooler**: Intermediary component that multiplexes many application-level database connections onto a smaller, bounded number of real PostgreSQL server connections.
- **Pooled Connection Budget**: The formula and configured limits governing how many HAPI FHIR replicas can safely run once pooling is enabled.
- **Native Connection Budget**: The existing, unmodified formula and ceiling that governs behavior when pooling is disabled (defined in spec 003, unchanged here).
- **Bulk-Load Allowance**: A temporary, time-boxed, operator-controlled connection budget used only during one-time large dataset imports.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With pooling disabled, system behavior and connection ceiling are unchanged from today — verified by all existing automated connection-budget checks continuing to pass unmodified.
- **SC-002**: With pooling enabled, the system supports at least 10,000 concurrent users' worth of request load without exceeding the documented PostgreSQL connection budget or breaching existing latency/error-rate thresholds.
- **SC-003**: The actual provisioned database connection limit matches the documented assumption in 100% of supported cloud environments, verifiable by inspection.
- **SC-004**: Operators can recalculate the pooled-tier replica ceiling in under 10 minutes using only committed documentation and known configuration values, matching the existing standard for the native tier.
- **SC-005**: A bulk data-load of a large dataset completes without ever exceeding real database connection limits, and the system returns to its committed serving ceiling before benchmark traffic begins, in 100% of observed runs.
- **SC-006**: The compatibility validation for prepared-statement caching under transaction pooling is completed and recorded before the pooled tier is used above the 10,000-concurrent-user benchmark tier.

## Assumptions

- The pooled tier is validated primarily against a 10,000-concurrent-user benchmark tier before being trusted at higher scale; validation at 100,000 concurrent users is a follow-on activity dependent on this spec's completion.
- The existing native-tier connection budget and its automated validation (spec 003) remain the default, unmodified behavior; this spec only adds an opt-in alternative alongside it.
- A companion spec (eCHIS household/CHW workload benchmark) provides the load-generation capability used to exercise this spec's Success Criteria at scale; this spec defines the connection-pooling capability itself, not the workload that validates it.
- Interim values for pooler capacity and reserved connections will be documented as provisional and revised after load-test evidence, consistent with how the existing per-pod request-rate threshold is already handled.

## Source Context

- GitHub issues: #1 (Rev2 roadmap epic, referenced for context), #18 (benchmark-lab epic, referenced for context), #5 (original connection-budget requirement, amended by this spec). A new tracking issue should be filed that cross-references both #1 and #18 without nesting under either, since this work spans both.
- Related specs: `003-autoscaling-connection-budget` (this spec is an additive amendment — the native tier it defines remains Implemented and unchanged), `008-echis-workload-benchmark` (sibling spec; provides the load-generation capability used to validate this spec's Success Criteria).
