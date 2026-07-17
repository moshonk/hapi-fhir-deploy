# Feature Specification: Runtime Rollout Controls

**Feature Branch**: `004-runtime-rollout-controls`

**Created**: 2026-07-18

**Status**: Draft

**Input**: GitHub issue #7, issue #1 epic, current values.yaml, and repository constitution.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tune JVM and Memory Behavior (Priority: P1)

As an operator, I can deploy HAPI FHIR with explicit JVM memory and garbage collection options that match the documented resource assumptions.

**Why this priority**: Predictable memory behavior reduces runtime instability under load.

**Independent Test**: Render the chart and inspect the resulting pod environment/command configuration for the required JVM flags.

**Acceptance Scenarios**:

1. **Given** repository values are rendered, **When** the HAPI FHIR pod configuration is inspected, **Then** JVM options include `-XX:MaxRAMPercentage=75`, `-XX:+UseG1GC`, and `-XX:MaxGCPauseMillis=200`.
2. **Given** resource requests and limits are documented, **When** JVM memory assumptions are reviewed, **Then** the max heap percentage is consistent with the configured memory limit.

---

### User Story 2 - Shutdown Gracefully During Rollouts (Priority: P1)

As an SRE, I can roll the HAPI FHIR Deployment without abruptly terminating in-flight requests.

**Why this priority**: Safe rolling updates and scale-down are required before increasing production traffic.

**Independent Test**: Trigger a rolling restart and confirm pods enter graceful termination, wait for preStop, and complete within the termination grace period.

**Acceptance Scenarios**:

1. **Given** a pod is serving traffic, **When** it is terminated during a rollout, **Then** graceful shutdown is enabled and in-flight requests have the configured shutdown phase timeout.
2. **Given** a pod receives termination, **When** the preStop hook runs, **Then** it delays termination for the documented drain period.
3. **Given** termination starts, **When** Kubernetes evaluates the pod, **Then** `terminationGracePeriodSeconds` is at least 60 seconds.

---

### User Story 3 - Preserve Availability Across Zones (Priority: P2)

As a platform engineer, I can keep replicas available during disruptions and spread them across topology zones when the cluster supports it.

**Why this priority**: Multi-replica deployments need placement and disruption controls before production operations.

**Independent Test**: Render and inspect PDB and topology spread constraints, then verify scheduling behavior in a multi-zone test cluster.

**Acceptance Scenarios**:

1. **Given** at least two replicas, **When** voluntary disruption occurs, **Then** the PodDisruptionBudget preserves at least one available pod.
2. **Given** nodes have topology zone labels, **When** pods are scheduled, **Then** topology spread constraints distribute replicas across zones where feasible.
3. **Given** autoscaler scale-down occurs, **When** replica count decreases, **Then** scale-down stabilization prevents rapid oscillation.

### Edge Cases

- The upstream chart lacks direct values for lifecycle hooks, topology spread, or termination grace.
- A single-zone cluster cannot satisfy zone spread constraints.
- Hikari maximum pool size differs between issue #7 and current repository values.
- Rolling restart validation requires a live cluster and cannot run in CI.
- Autoscaling is not implemented yet but must reserve scale-down stabilization requirements.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Runtime values MUST include JVM options for max RAM percentage, G1GC, and target GC pause.
- **FR-002**: Runtime docs MUST explain the memory assumptions that justify the JVM settings.
- **FR-003**: Hikari maximum pool size MUST be explicitly set and its connection-budget impact MUST be documented.
- **FR-004**: The discrepancy between issue #7's requested `hikari.maximum-pool-size=20` and the current baseline `maximumPoolSize: 10` MUST be resolved by load testing or explicit documented decision.
- **FR-005**: Graceful shutdown MUST configure `SERVER_SHUTDOWN=graceful` or equivalent Spring Boot behavior.
- **FR-006**: Graceful shutdown MUST configure `spring.lifecycle.timeout-per-shutdown-phase` or equivalent runtime setting.
- **FR-007**: Pod lifecycle MUST include a preStop drain delay of 10 to 15 seconds where chart support allows it.
- **FR-008**: Pod termination grace period MUST be at least 60 seconds.
- **FR-009**: PodDisruptionBudget MUST remain enabled and aligned with replica strategy.
- **FR-010**: Topology spread constraints MUST be configured for zone resilience where the target cluster exposes topology labels.
- **FR-011**: Autoscaler scale-down stabilization MUST be at least 300 seconds when autoscaling is implemented.
- **FR-012**: Rollout and rollback verification steps MUST be documented.

### Key Entities

- **JVM Runtime Options**: Memory and GC flags supplied to HAPI FHIR.
- **Hikari Pool Configuration**: Database connection pool settings that affect PostgreSQL capacity.
- **Graceful Shutdown Controls**: Spring Boot shutdown, lifecycle timeout, preStop, and termination grace settings.
- **Availability Controls**: PodDisruptionBudget and topology spread constraints.
- **Autoscaler Scale-Down Policy**: Stabilization behavior that prevents abrupt replica reductions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Rendered pod configuration includes all required JVM and graceful shutdown settings.
- **SC-002**: Rolling restart verification confirms pods terminate gracefully within the documented grace period.
- **SC-003**: PDB configuration preserves availability for the committed minimum replica count.
- **SC-004**: Topology spread constraints are present and documented with single-zone fallback behavior.
- **SC-005**: Connection-budget docs reflect the final Hikari maximum pool size and replica strategy.

## Assumptions

- The target production cluster has at least two schedulable nodes and may have zone labels.
- Some rollout behavior can only be validated in a live cluster, not purely through Helm rendering.
- Autoscaling stabilization may be implemented in the autoscaling spec but is governed by this runtime spec.

## Source Context

- GitHub issues: #1, #7.
- Related specs: `003-autoscaling-connection-budget`, `006-documentation-handoff`.
