# HAPI FHIR Deploy Claude Guide

This repository manages a Helm-first Kubernetes deployment baseline for HAPI FHIR JPA Server with external PostgreSQL.

Claude Code should treat this file as its entry point, then read `AGENTS.md` for shared repository rules and `.specify/memory/constitution.md` before planning or implementing any Spec Kit work.

## Required Context Order

1. `CLAUDE.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. The relevant `specs/*/spec.md`
5. Path-specific guidance under `.github/instructions/` when editing matching files

## Architecture Guardrails

- Preserve issue #1 as the Rev2 roadmap and keep work aligned with child issues #2-#7.
- Use the official HAPI FHIR Helm chart through the wrapper chart.
- Do not enable Kafka, Zookeeper, embedded H2 fallback, bundled PostgreSQL, or unreviewed embedded Lucene.
- Keep PostgreSQL external and target version 16 or 17.
- Keep `spring.datasource.*` explicit and Secret-backed.
- Pin chart, image, workflow, and tooling versions; never use `latest`.
- Keep docs synchronized with committed manifests, values, names, ports, and Secret contracts.

## Spec Kit Commands

Claude Code Spec Kit skills are installed in `.claude/skills/`.

- Use `/speckit-constitution` for constitution updates.
- Use `/speckit-specify` for new or updated feature specs.
- Use `/speckit-plan` for implementation planning.
- Use `/speckit-tasks` for task generation.
- Use `/speckit-implement` for implementation.
- Use `/speckit-converge` to assess the codebase and append remaining work.

The repository default Spec Kit integration remains `generic`; generic command definitions are also available under `.specify/commands/`. Claude command names use hyphens, not dots.

## Validation

Run relevant checks before finishing changes:

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

If Helm dependency resolution cannot reach the upstream chart repository, report the network failure clearly.
