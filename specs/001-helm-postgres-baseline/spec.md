# Feature Specification: Helm PostgreSQL Baseline

**Feature Branch**: `001-helm-postgres-baseline`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: GitHub issue #3, issue #1 epic, merged PR #8, and PR #8 review comments.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install HAPI FHIR Against External PostgreSQL (Priority: P1)

As a platform engineer, I can install the HAPI FHIR release from the official Helm chart wrapper and point it at an externally managed PostgreSQL 16 or 17 database without the application falling back to H2.

**Why this priority**: This is the foundation for every Rev2 workstream and is partly implemented in the current repository.

**Independent Test**: Render the chart with repository values and verify the resulting application configuration contains explicit PostgreSQL datasource settings, external database secret references, and no bundled PostgreSQL resources.

**Acceptance Scenarios**:

1. **Given** the repository values and runtime Secret contract, **When** the chart is rendered, **Then** the Deployment receives a JDBC URL, username, password reference, PostgreSQL driver, and HAPI PostgreSQL dialect.
2. **Given** the chart is rendered, **When** manifests are inspected, **Then** no Kafka, Zookeeper, bundled PostgreSQL, or H2 configuration is present.
3. **Given** a target cluster has the documented Secret available, **When** the release is installed, **Then** the HAPI FHIR metadata endpoint responds through the configured service.

---

### User Story 2 - Update Environment-Specific Database Settings (Priority: P2)

As an operator, I can update the database host, database name, username, and Secret source using actionable file paths and resource names.

**Why this priority**: PR #8 review identified README guidance that referenced a non-actionable `extraEnv.HAPI_FHIR_POSTGRES_JDBC_URL` path.

**Independent Test**: Follow the documentation to change the database endpoint and confirm every referenced value exists at the named path in repository files.

**Acceptance Scenarios**:

1. **Given** an environment-specific PostgreSQL hostname, **When** an operator follows the docs, **Then** they can identify and update both `externalDatabase.host` and the `extraEnv` list item named `HAPI_FHIR_POSTGRES_JDBC_URL`.
2. **Given** a different secret store/key path, **When** an operator follows the docs, **Then** they can update the ExternalSecret without committing secret material.

---

### User Story 3 - Verify Ownership and Runtime Resources (Priority: P3)

As a maintainer, I can verify namespace, pod, service, and Secret resources with commands that work as written and do not imply incorrect ownership.

**Why this priority**: PR #8 review found misleading namespace ownership metadata and a verification command that fetched unrelated resource names.

**Independent Test**: Run documented verification commands against a deployed namespace and confirm each command targets real resource types and names.

**Acceptance Scenarios**:

1. **Given** the namespace is applied with `kubectl apply`, **When** metadata is inspected, **Then** labels do not falsely identify Helm as the namespace manager.
2. **Given** a deployed release, **When** the verification commands are executed, **Then** pods, services, and the `hapi-fhir-postgres` Secret can be inspected without using invalid mixed-name selectors.

### Edge Cases

- The runtime Secret is missing or the password key is absent.
- The external PostgreSQL server is version 13, 14, 15, or otherwise outside the supported 16/17 target.
- The chart repository is unreachable during dependency build.
- A future HAPI image tag changes the reviewed `v8.10.0-2` digest pin.
- A future chart release changes the rendered Deployment resource names or supported values.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST keep using the official HAPI FHIR Helm chart through `charts/hapi-fhir-deploy/Chart.yaml`.
- **FR-002**: The chart values MUST disable bundled PostgreSQL.
- **FR-003**: The chart values MUST configure an external PostgreSQL 16 or 17 target.
- **FR-004**: The application configuration MUST include explicit `spring.datasource.url`, `spring.datasource.username`, `spring.datasource.password`, `spring.datasource.driverClassName`, and HAPI PostgreSQL dialect settings.
- **FR-005**: Database credentials MUST be provided through a Kubernetes Secret reference, not committed plaintext values.
- **FR-006**: The HAPI image MUST be pinned to a reviewed tag and digest.
- **FR-007**: Kafka, Zookeeper, embedded H2, bundled PostgreSQL, and hand-rolled PostgreSQL StatefulSets MUST remain absent.
- **FR-008**: Documentation MUST identify exact file paths and value locations for changing database host, JDBC URL, database name, username, Secret name, and Secret key.
- **FR-009**: Verification commands MUST use resource names and selectors that work as written.
- **FR-010**: Namespace metadata MUST not claim Helm ownership when the namespace is applied outside Helm.
- **FR-011**: CI MUST preserve guardrails for pinned images, disabled bundled PostgreSQL, explicit datasource settings, and safe YAML parsing.

### Key Entities

- **Helm Wrapper Chart**: The repository-owned chart that pins the upstream chart dependency and stores deployment values.
- **External PostgreSQL Contract**: Database hostname, port, database name, username, supported version, Secret name, and password key expected before install.
- **Runtime Secret**: Kubernetes Secret `fhir/hapi-fhir-postgres` with key `password`.
- **HAPI FHIR Release**: The Helm release serving FHIR endpoints through the Kubernetes service.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Helm rendering produces zero bundled PostgreSQL, Kafka, or Zookeeper resources.
- **SC-002**: The rendered application configuration contains all required datasource properties and Secret references.
- **SC-003**: An operator can identify every environment-specific database setting from the README in under 10 minutes without inspecting chart internals.
- **SC-004**: The metadata endpoint verification path succeeds after deployment against a prepared PostgreSQL 16 or 17 database.
- **SC-005**: CI rejects PRs that remove explicit datasource settings, remove digest pinning, enable bundled PostgreSQL, or introduce unsafe YAML object loading.

## Assumptions

- External PostgreSQL is provisioned before the HAPI FHIR Helm release is installed.
- External Secrets Operator or an equivalent secret management process is available in the target cluster.
- The repository keeps the `fhir` namespace and `hapi-fhir-postgres` Secret contract unless a tracked issue changes it.
- The baseline spec documents current behavior and remaining deltas; it does not automatically close issue #3 until implementation and docs are reconciled.

## Source Context

- GitHub issues: #1, #3.
- Historical PRs: #8.
- Review constraints: actionable README value paths, valid verification commands, and namespace ownership metadata.
