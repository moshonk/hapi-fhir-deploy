<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles:
- Template principle 1 -> Chart-First Deployment
- Template principle 2 -> Explicit External PostgreSQL
- Template principle 3 -> Version Pinning and Reproducibility
- Template principle 4 -> Observable and Operable Runtime
- Template principle 5 -> Bounded Scale and Safe Rollouts
Added sections:
- Rev2 Architecture Constraints
- Development Workflow and Quality Gates
Removed sections:
- Template placeholder sections
Templates requiring updates:
- .specify/templates/spec-template.md: pending; base template remains generic
- .specify/templates/plan-template.md: pending; base template remains generic
- .specify/templates/tasks-template.md: pending; base template remains generic
Follow-up TODOs:
- None
-->

# HAPI FHIR Deploy Constitution

## Core Principles

### I. Chart-First Deployment

All deployment behavior MUST prefer the official upstream HAPI FHIR Helm chart and
wrapper chart values before adding standalone manifests. Standalone Kubernetes
manifests are allowed only for resources the chart does not own, such as namespace
bootstrapping, External Secrets integration, observability add-ons, or autoscaling
objects that lack a chart-supported value path.

### II. Explicit External PostgreSQL

The runtime MUST use an external PostgreSQL 16 or 17 database and MUST configure
HAPI FHIR through explicit Secret-backed `spring.datasource.*` settings. Changes
MUST preserve the `hapi-fhir-postgres` runtime Secret contract unless a tracked
issue or architecture decision replaces it. Embedded H2 fallback, bundled
PostgreSQL, and hand-rolled PostgreSQL StatefulSets are not acceptable baseline
outcomes.

### III. Version Pinning and Reproducibility

Charts, container images, GitHub Actions, and tooling versions MUST be pinned to
reviewed versions or digests. `latest` tags are prohibited. Validation MUST be
deterministic and fail loudly when required upstream dependencies, such as the HAPI
FHIR Helm repository, cannot be resolved.

### IV. Observable and Operable Runtime

Observability MUST use HAPI FHIR's built-in Actuator and Micrometer capabilities
before custom exporter images. Runtime changes MUST include operator-facing
verification paths for health, Prometheus metrics, logs, rollout status, and
failure investigation.

### V. Bounded Scale and Safe Rollouts

Scaling behavior MUST be bounded by PostgreSQL connection budget math and MUST NOT
scale to zero. Runtime changes that affect replicas, Hikari pool size, autoscaling,
or shutdown behavior MUST preserve service availability through PodDisruptionBudget
alignment, graceful shutdown, conservative scale-down, and documented rollback.

## Rev2 Architecture Constraints

- D1: Kafka and Zookeeper are non-goals for the OSS starter architecture.
- D2: `spring.datasource.*` configuration is mandatory to avoid silent H2 fallback.
- D3: Actuator and Micrometer are preferred over custom JMX exporter images.
- D4: PostgreSQL support targets version 16 or 17 only.
- D5: Images, chart dependencies, and workflows must stay pinned.
- D6: Hibernate Search remains disabled until a repository memo explicitly chooses
  disabled advanced indexing or shared Elasticsearch/OpenSearch.

## Development Workflow and Quality Gates

- Specs MUST trace back to issue #1 or a child workstream issue when implementing
  Rev2 roadmap work.
- Changes MUST keep README, docs, manifests, and Helm values synchronized.
- Sensitive values MUST remain out of the repository; use references, External
  Secrets, sealed secret workflows, or documented platform secret injection.
- YAML MUST be parsed with safe loaders when validating PR-controlled content.
- Helm chart changes MUST run dependency build, lint, template rendering, and
  rendered-manifest parsing when network access to the upstream chart repository is
  available.
- Review feedback that identifies non-actionable commands or misleading ownership
  metadata MUST be treated as requirements for future specs and docs.

## Governance

This constitution supersedes informal guidance when planning or implementing specs
for this repository. Amendments require a repository change that updates this file,
explains the version bump, and identifies any affected specs, templates, docs, or
CI guardrails. Pull requests implementing specs MUST include a constitution check
covering the principles above. Major changes remove or redefine principles, minor
changes add or materially expand principles, and patch changes clarify wording
without changing obligations.

**Version**: 1.0.0 | **Ratified**: 2026-07-18 | **Last Amended**: 2026-07-18
