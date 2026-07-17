# Feature Specification: Indexing Strategy Memo

**Feature Branch**: `005-indexing-strategy-memo`

**Created**: 2026-07-18

**Status**: Draft

**Input**: GitHub issue #4, issue #1 epic, docs/external-postgres.md, CI review feedback from PR #9, and repository constitution.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Decide the D6 Indexing Posture (Priority: P1)

As a technical decision maker, I can read a repository memo that compares keeping advanced indexing disabled with provisioning shared Elasticsearch/OpenSearch and states a recommendation.

**Why this priority**: The current multi-replica baseline disables Hibernate Search to avoid inconsistent per-pod embedded Lucene indexes.

**Independent Test**: Review the committed memo and confirm it covers all required comparison dimensions and states an explicit recommendation.

**Acceptance Scenarios**:

1. **Given** the memo is committed, **When** a maintainer reads it, **Then** it compares disabled advanced indexing against shared Elasticsearch/OpenSearch.
2. **Given** the comparison is complete, **When** the recommendation is reviewed, **Then** rationale is clear enough to guide implementation or deferral.

---

### User Story 2 - Prevent Accidental Embedded Lucene Across Replicas (Priority: P1)

As a maintainer, I can prevent repository changes from silently enabling embedded Lucene in a horizontally scaled deployment.

**Why this priority**: Embedded Lucene indexes are per-pod filesystem state and can create inconsistent search behavior across replicas.

**Independent Test**: Inspect values, docs, and CI guardrails to confirm the search setting is explicit and any enablement requires a documented decision.

**Acceptance Scenarios**:

1. **Given** multiple HAPI replicas, **When** search settings are inspected, **Then** embedded Lucene is not silently enabled.
2. **Given** a future PR enables Hibernate Search, **When** CI and review run, **Then** it requires explicit documentation of the selected shared backend strategy.

---

### User Story 3 - Create Follow-Up Work for Shared Search Backend (Priority: P2)

As a project maintainer, I can turn a decision to use Elasticsearch/OpenSearch into scoped follow-up issues without bundling unreviewed infrastructure into the memo.

**Why this priority**: Choosing shared search has operational, security, cost, and migration consequences that should be implemented deliberately.

**Independent Test**: If the memo recommends shared search, confirm follow-up issues exist or are drafted for backend provisioning, HAPI configuration, migration, rollback, security, and operations.

**Acceptance Scenarios**:

1. **Given** Option B is selected, **When** the memo is merged, **Then** follow-up implementation issues are created or listed.
2. **Given** Option A remains selected, **When** docs are reviewed, **Then** they clearly state advanced indexing is disabled by design.

### Edge Cases

- Workloads require terminology or full-text search features that disabled advanced indexing cannot support.
- Shared search backend availability or cost is unacceptable for the starter architecture.
- Enabling search requires secrets, network policy, or data governance controls not yet in scope.
- CI over-constrains D6 by requiring `hibernate.search.enabled: false` even after an approved shared backend decision.
- Operators misinterpret disabled advanced indexing as a HAPI FHIR deployment failure.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A documentation memo MUST compare Option A, disabled advanced indexing, and Option B, shared Elasticsearch/OpenSearch.
- **FR-002**: The memo MUST cover operational complexity, cost, query consistency under replica scaling, performance considerations, security/data governance, migration path, and rollback plan.
- **FR-003**: The memo MUST state a recommendation and rationale.
- **FR-004**: Repository values MUST keep `hibernate.search.enabled` explicit.
- **FR-005**: Embedded Lucene MUST NOT be enabled for multi-replica deployments.
- **FR-006**: If shared search is recommended, follow-up implementation issues MUST be created or explicitly listed in the memo.
- **FR-007**: CI guardrails MUST require an explicit Hibernate Search setting without permanently blocking a future approved shared backend.
- **FR-008**: README or linked docs MUST communicate current search capability limits and the D6 decision state.
- **FR-009**: The memo MUST avoid committing credentials, endpoint secrets, or environment-specific backend values.

### Key Entities

- **Indexing Decision Memo**: Repository document capturing the D6 decision and rationale.
- **Option A**: Advanced indexing disabled; current default baseline.
- **Option B**: Shared Elasticsearch/OpenSearch backend configured for consistent multi-replica search.
- **Hibernate Search Setting**: Explicit HAPI configuration key that controls search behavior.
- **Follow-Up Implementation Issue**: Scoped work item created if shared search is selected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The memo covers all seven required comparison dimensions.
- **SC-002**: The recommendation can be identified in under two minutes by a new maintainer.
- **SC-003**: No repository path silently enables embedded Lucene for multi-replica HAPI FHIR.
- **SC-004**: CI and docs allow an approved shared backend decision without weakening the requirement for explicit search configuration.
- **SC-005**: Any decision to adopt shared search has at least one tracked follow-up implementation path.

## Assumptions

- The default starter architecture keeps advanced indexing disabled until the memo is merged.
- Elasticsearch/OpenSearch deployment, sizing, credentials, and network controls are separate implementation concerns.
- The repository has no handoff PDF committed, so the memo must be self-contained.

## Source Context

- GitHub issues: #1, #4.
- Historical PRs: #9 review feedback on not hard-coding D6 as permanently false in CI.
