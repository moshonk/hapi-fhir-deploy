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

## Working Rules

- Prefer chart values and supported Helm features before adding handwritten manifests.
- Keep secret material out of the repo; use `ExternalSecret`, sealed secret workflows, or documented secret references.
- Keep README and docs synchronized with the actual chart values, manifests, image pins, and issue status.
- When working from an issue, keep changes scoped to that workstream and preserve the other roadmap items.
- For operational changes, document rollout verification and rollback expectations.

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

These Awesome Copilot resources are a good fit for this repository's work:

- `agents/platform-sre-kubernetes.agent.md`: for Kubernetes reliability, rollout, and security-heavy changes.
- `skills/documentation-writer`: for README, memo, and runbook work.
- `skills/security-review`: for changes involving secrets, ingress, auth, or exposure risk.
- `skills/acquire-codebase-knowledge`: for future onboarding or repository mapping tasks.
- `instructions/kubernetes-manifests.instructions.md`, `instructions/kubernetes-deployment-best-practices.instructions.md`, `instructions/devops-core-principles.instructions.md`, and `instructions/markdown-gfm.instructions.md`: baseline patterns adapted into this repository's local Copilot instructions.
