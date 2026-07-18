# Feature Specification: Documentation Handoff

**Feature Branch**: `006-documentation-handoff`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: GitHub issue #6, issue #1 epic, merged PR #10, PR review feedback from #8 and #10, and repository docs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bootstrap From README (Priority: P1)

As a new engineer, I can read the README and install the current baseline without needing the Rev2 handoff PDF.

**Why this priority**: Issue #6 explicitly requires runbook-level clarity for incoming engineers.

**Independent Test**: Follow the README from a fresh checkout and identify prerequisites, install commands, database contract, and verification steps.

**Acceptance Scenarios**:

1. **Given** a fresh checkout, **When** a new engineer reads the README, **Then** they can identify the chart path, namespace, Secret contract, PostgreSQL requirements, and install commands.
2. **Given** the target cluster is prepared, **When** commands are followed, **Then** the HAPI FHIR metadata endpoint can be verified.
3. **Given** deployment fails to start, **When** the engineer follows failure-investigation guidance, **Then** datasource and PostgreSQL authentication errors are the first documented checks.

---

### User Story 2 - Understand Rev2 Decisions and Non-Goals (Priority: P1)

As a maintainer, I can understand the authoritative architecture decisions and non-goals without reading issue history.

**Why this priority**: The repo must preserve D1-D6 and avoid reintroducing rejected prototype patterns.

**Independent Test**: Review README and linked docs to confirm D1-D6, non-goals, and deferred decisions are clearly stated.

**Acceptance Scenarios**:

1. **Given** README is updated, **When** decisions are reviewed, **Then** D1-D6 are visible and consistent with AGENTS.md and the constitution.
2. **Given** non-goals are reviewed, **When** an engineer plans changes, **Then** Kafka/Zookeeper, scale-to-zero, and implicit embedded Lucene are clearly out of scope.

---

### User Story 3 - Operate and Evolve the Deployment (Priority: P2)

As an operator, I can find rollout, rollback, observability, autoscaling, connection-budget, and search-indexing guidance from the docs.

**Why this priority**: Future workstreams need docs that remain accurate as the baseline evolves.

**Independent Test**: Use docs to locate verification commands and the connection-budget equation, then identify which open issues/specs track unfinished work.

**Acceptance Scenarios**:

1. **Given** autoscaling is not fully implemented, **When** README is read, **Then** it describes the current state and points to the autoscaling spec or issue instead of implying completion.
2. **Given** observability or runtime rollout work changes values, **When** docs are reviewed, **Then** resource names, ports, metrics paths, and verification commands match committed files.
3. **Given** external Awesome Copilot resources are mentioned, **When** guidance is read, **Then** external references are labeled as external and local paths point to real repository files.

### Edge Cases

- README drifts from chart values after image, Hikari, service, or secret changes.
- Verification commands fetch resources by invalid names or selectors.
- Repository description update requires GitHub maintainer permissions.
- Docs imply unfinished observability, autoscaling, runtime tuning, or indexing work is already complete.
- External guidance references look like local repository paths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: README MUST include D1-D6 architecture decisions.
- **FR-002**: README MUST list pinned chart, image, workflow/tooling, and relevant component versions currently committed.
- **FR-003**: README MUST preserve the official Helm chart-first deployment path.
- **FR-004**: README MUST document the external PostgreSQL contract, Secret shape, and environment-specific values to update using actionable file paths.
- **FR-005**: README MUST include autoscaling and connection-budget equation with sample math and must label unimplemented autoscaling work as pending.
- **FR-006**: README or linked docs MUST include rollout, rollback, and graceful shutdown verification guidance.
- **FR-007**: README or linked docs MUST include observability verification for Actuator, Prometheus, and exporter status, while accurately marking incomplete work.
- **FR-008**: Docs MUST include known non-goals: no Kafka/Zookeeper tier, no scale-to-zero, and no implicit embedded-Lucene multi-replica indexing.
- **FR-009**: Repository description/tagline MUST be updated through GitHub settings or documented as requiring maintainer permissions.
- **FR-010**: Documentation MUST match committed manifests, chart values, image pins, Secret names, namespaces, and ports.
- **FR-011**: Local and external guidance references MUST be clearly distinguished, especially in AGENTS.md.
- **FR-012**: Documentation MUST not include production-looking plaintext secrets or kubeconfig material.

### Key Entities

- **README Runbook**: Main onboarding and operation entry point.
- **Architecture Decision**: D1-D6 baseline constraint inherited from Rev2.
- **Known Non-Goal**: Explicitly rejected or deferred architecture behavior.
- **Repository Description**: GitHub repo metadata describing the project focus.
- **Operational Verification**: Commands and checks for install, rollout, rollback, metrics, and failure diagnosis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new engineer can identify prerequisites, install commands, verification commands, and failure checks from README in under 15 minutes.
- **SC-002**: Docs contain zero references to local paths that do not exist unless explicitly labeled external.
- **SC-003**: Every documented command that references repository files points to an existing path.
- **SC-004**: README accurately distinguishes implemented baseline features from pending workstreams #2, #4, #5, #6, and #7.
- **SC-005**: Repository description is updated or a maintainer-permission note is committed.

## Assumptions

- The README remains concise and links to deeper docs when detail would make it hard to scan.
- GitHub repository settings may require owner permissions unavailable to some contributors.
- Documentation updates should not change deployment behavior unless a referenced spec requires it.
- The GitHub repository description is set to `Scalable HAPI FHIR Kubernetes deployment baseline with external PostgreSQL`.

## Source Context

- GitHub issues: #1, #6.
- Historical PRs: #8 review feedback on README commands, #10 review feedback on local-vs-external guidance references.
