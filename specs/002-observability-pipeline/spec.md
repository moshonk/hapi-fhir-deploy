# Feature Specification: Observability Pipeline

**Feature Branch**: `002-observability-pipeline`

**Created**: 2026-07-18

**Status**: Draft

**Input**: GitHub issue #2, issue #1 epic, repository constitution, and merged PR history.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify HAPI Health Endpoints (Priority: P1)

As an operator, I can verify HAPI FHIR liveness and readiness through Actuator endpoints that reflect normal startup and runtime health.

**Why this priority**: Health endpoints are required before reliable scraping, rollout automation, or autoscaling decisions.

**Independent Test**: Deploy the release and confirm liveness and readiness endpoints return healthy status during normal operation.

**Acceptance Scenarios**:

1. **Given** HAPI FHIR is running normally, **When** `/actuator/health/liveness` is requested, **Then** it returns a healthy liveness response.
2. **Given** HAPI FHIR can reach PostgreSQL and has completed startup, **When** `/actuator/health/readiness` is requested, **Then** it returns a healthy readiness response.
3. **Given** PostgreSQL authentication is invalid, **When** readiness is requested, **Then** readiness does not falsely report a healthy state.

---

### User Story 2 - Scrape Micrometer Metrics (Priority: P1)

As an SRE, I can scrape HAPI FHIR Actuator Prometheus metrics using the cluster's Prometheus integration.

**Why this priority**: JVM, Hikari, and HTTP metrics are needed for runtime diagnosis and autoscaling.

**Independent Test**: Confirm Prometheus can scrape `/actuator/prometheus` and returns expected metric families.

**Acceptance Scenarios**:

1. **Given** ServiceMonitor support is available, **When** the chart or add-on manifests are applied, **Then** Prometheus discovers and scrapes the HAPI FHIR metrics endpoint.
2. **Given** metrics are scraped, **When** metric names are queried, **Then** JVM memory, Hikari connections, and HTTP server request metrics are present.

---

### User Story 3 - Scrape FHIR Server Exporter Metrics (Priority: P2)

As an SRE, I can deploy and scrape `fhir-server-exporter` in-cluster against the HAPI FHIR service URL.

**Why this priority**: The exporter supplements application metrics with FHIR-specific operational signals.

**Independent Test**: Deploy the exporter, point it at the HAPI service, and confirm Prometheus scrapes exporter metrics.

**Acceptance Scenarios**:

1. **Given** the HAPI FHIR service is reachable in-cluster, **When** the exporter starts, **Then** it targets the configured HAPI FHIR base URL.
2. **Given** Prometheus scrape integration is enabled, **When** exporter metrics are queried, **Then** exporter metrics are present and current.

### Edge Cases

- Actuator endpoints are disabled or exposed on a different management path.
- Prometheus Operator CRDs such as `ServiceMonitor` are not installed.
- The HAPI FHIR service DNS name changes after chart rendering.
- The exporter cannot authenticate if a future deployment adds FHIR endpoint authentication.
- Metrics exist but are not stable enough for autoscaling queries.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The deployment MUST expose or document access to `/actuator/health/liveness`, `/actuator/health/readiness`, and `/actuator/prometheus`.
- **FR-002**: Probes or verification checks MUST distinguish application liveness from database-dependent readiness.
- **FR-003**: Prometheus scraping MUST be enabled through ServiceMonitor or documented chart-supported annotations.
- **FR-004**: Scraping configuration MUST target the committed HAPI FHIR service name, namespace, and metrics path.
- **FR-005**: Runtime verification MUST confirm presence of `jvm_memory_used_bytes`, `hikaricp_connections_active`, and `http_server_requests_seconds_*` or their documented HAPI/Micrometer equivalents.
- **FR-006**: `fhir-server-exporter` MUST be deployed as an in-cluster Deployment and Service or explicitly documented as deferred with a tracked reason.
- **FR-007**: No custom JMX exporter sidecar or replacement HAPI image MAY be introduced.
- **FR-008**: README or linked docs MUST include observability verification commands and initial failure investigation steps.
- **FR-009**: Observability configuration MUST avoid committed credentials and environment-specific secrets.
- **FR-010**: CI or validation docs MUST include rendering/parsing coverage for any new manifests.

### Key Entities

- **Actuator Endpoint**: HAPI FHIR runtime endpoint for health and Prometheus metrics.
- **ServiceMonitor or Scrape Annotation**: Prometheus discovery configuration for the HAPI service.
- **FHIR Server Exporter**: Supplemental in-cluster metrics exporter targeting HAPI FHIR.
- **Metric Family**: JVM, Hikari, HTTP, and exporter metrics used for operations and future autoscaling.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Liveness, readiness, and Prometheus endpoints are verifiable with documented commands after deployment.
- **SC-002**: Prometheus can scrape HAPI FHIR metrics without custom HAPI images or JMX sidecars.
- **SC-003**: Required JVM, Hikari, and HTTP metric families are visible in Prometheus after normal traffic.
- **SC-004**: `fhir-server-exporter` is scraped successfully or its deferral is documented with a follow-up issue.
- **SC-005**: A new operator can diagnose a missing metrics scrape using repository docs without the handoff PDF.

## Assumptions

- Target production clusters have Prometheus Operator or a comparable scraping mechanism.
- The HAPI FHIR upstream chart supports enough service metadata or extension points to avoid rewriting core Deployment manifests.
- Authentication for Actuator and FHIR endpoints is out of scope for this baseline unless a future issue adds it.

## Source Context

- GitHub issues: #1, #2.
- Architecture decision: D3 Actuator/Micrometer first.
