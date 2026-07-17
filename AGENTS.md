# HAPI FHIR deploy agent guide

## Project Overview

This repository manages a Helm-first Kubernetes deployment baseline for HAPI FHIR JPA Server.
Keep the repository aligned with the Rev2 handoff epic in issue #1 and its child workstreams (#2-#7).

## Authoritative Architecture Decisions

Preserve these decisions unless an issue or ADR explicitly changes them:

- D1: No Kafka or Zookeeper in the OSS starter architecture.
- D2: Always configure the application with explicit `spring.datasource.*` settings so HAPI does not silently fall back to embedded H2.
- D3: Prefer built-in Actuator and Micrometer over custom JMX-exporter images.
- D4: Target PostgreSQL 16 or 17 only.
- D5: Pin chart, container, and workflow versions; never introduce `latest`.
- D6: Keep Hibernate Search disabled until the indexing strategy memo is recorded.

## Repository Map

- `charts/hapi-fhir-deploy/Chart.yaml`: wrapper chart pinning the upstream HAPI FHIR chart.
- `charts/hapi-fhir-deploy/values.yaml`: primary deployment baseline and most future work.
- `manifests/`: supporting Kubernetes manifests that the chart does not own.
- `docs/`: architecture and operational notes that should match committed manifests and values.
- `.github/workflows/ci.yml`: validation workflow for YAML parsing and Helm rendering.
- `.specify/`: Spec Kit project constitution, scripts, generic commands, workflow, and templates.
- `specs/`: Spec Kit feature specifications mapped to the Rev2 child workstreams.

## Working Rules

- Prefer chart values and supported Helm features before adding handwritten manifests.
- Keep secret material out of the repo; use `ExternalSecret`, sealed secret workflows, or documented secret references.
- Keep README and docs synchronized with the actual chart values, manifests, image pins, and issue status.
- When working from an issue, keep changes scoped to that workstream and preserve the other roadmap items.
- For operational changes, document rollout verification and rollback expectations.
- For Spec Kit work, start with `.specify/memory/constitution.md`, then the relevant `specs/*/spec.md`.

## Spec Kit Workflow

Spec Kit is initialized with the generic integration because the bundled Codex integration writes to `.agents/`, which is read-only in this workspace profile. Slash-command source files live under `.specify/commands/`.

- `001-helm-postgres-baseline`: issue #3 and PR #8 review deltas.
- `002-observability-pipeline`: issue #2.
- `003-autoscaling-connection-budget`: issue #5.
- `004-runtime-rollout-controls`: issue #7.
- `005-indexing-strategy-memo`: issue #4 and D6.
- `006-documentation-handoff`: issue #6 and PR #8/#10 documentation review deltas.

## Validation Expectations

Run the existing checks when your environment allows it:

```bash
ruby -rpsych -e 'ARGV.each { |path| Psych.parse_stream(File.read(path)); puts "ok #{path}" }' \
  .github/workflows/ci.yml \
  charts/hapi-fhir-deploy/Chart.yaml \
  charts/hapi-fhir-deploy/values.yaml \
  manifests/namespace.yaml \
  manifests/external-secrets/hapi-fhir-postgres.yaml

helm dependency build charts/hapi-fhir-deploy
helm lint charts/hapi-fhir-deploy --values charts/hapi-fhir-deploy/values.yaml
helm template hapi-fhir charts/hapi-fhir-deploy \
  --namespace fhir \
  --values charts/hapi-fhir-deploy/values.yaml > /tmp/hapi-fhir-rendered.yaml
ruby -rpsych -e 'Psych.parse_stream(File.read("/tmp/hapi-fhir-rendered.yaml")); puts "ok rendered manifests"'
```

If `helm dependency build` cannot reach the upstream chart repository, report the network failure instead of masking it.

## Recommended Copilot Artifacts

These external Awesome Copilot resources are a good fit for this repository's work when available outside this repository:

- External `agents/platform-sre-kubernetes.agent.md`: for Kubernetes reliability, rollout, and security-heavy changes.
- External `skills/documentation-writer`: for README, memo, and runbook work.
- External `skills/security-review`: for changes involving secrets, ingress, auth, or exposure risk.
- External `skills/acquire-codebase-knowledge`: for future onboarding or repository mapping tasks.
- Local `.github/instructions/kubernetes-manifests.instructions.md`, `.github/instructions/github-actions.instructions.md`, and `.github/instructions/markdown-docs.instructions.md`: repository-specific instruction files.
