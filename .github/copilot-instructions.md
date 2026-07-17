# HAPI FHIR deploy Copilot instructions

This repository is a Helm-wrapper and Kubernetes manifests baseline for deploying HAPI FHIR JPA Server with external PostgreSQL.

These are the GitHub Copilot entry-point instructions. Keep them aligned with `AGENTS.md`, `CLAUDE.md`, and `.specify/memory/constitution.md`.

## Repository-wide expectations

- Treat issue #1 as the roadmap and keep changes aligned with the active child issue scope.
- For Spec Kit work, read `.specify/memory/constitution.md` first, then the relevant `specs/*/spec.md`.
- Preserve the Rev2 decisions already documented in the repository:
  - no Kafka/Zookeeper
  - explicit `spring.datasource.*` configuration
  - PostgreSQL 16/17 only
  - pinned image and chart versions
  - `hibernate.search.enabled: false` until the D6 memo says otherwise
- Prefer changing `charts/hapi-fhir-deploy/values.yaml` before adding standalone manifests.
- Do not commit plaintext secrets, passwords, kubeconfigs, or example values that look usable in production.
- Keep docs consistent with the actual manifests, chart pins, secret names, and operational steps in the repo.

## Agent compatibility

- Codex uses `AGENTS.md` as its repository entry point.
- Claude Code uses `CLAUDE.md` and the generated `.claude/skills/speckit-*` Spec Kit skills.
- GitHub Copilot uses this file, path-specific instructions in `.github/instructions/`, agents in `.github/agents/`, and prompts in `.github/prompts/`.
- Spec Kit's repository default integration is `generic`; command definitions live in `.specify/commands/`, while Claude-native skills live in `.claude/skills/`.
- All agents should preserve the same architecture guardrails and validation expectations.

## Kubernetes and Helm guidance

- Keep the official upstream HAPI FHIR chart as the base deployment path.
- Use Secret-backed configuration for database credentials and other sensitive runtime values.
- Avoid changes that would allow embedded H2 fallback.
- Pin all images to explicit versions or digests; never use `latest`.
- Favor safe rollout defaults, observability hooks, and clear connection-budget math when changing runtime behavior.

## Documentation guidance

- Write docs as operator-focused runbooks, not generic product marketing.
- Call out non-goals and deferred decisions when they matter for safe implementation.
- When documenting commands, prefer commands that match committed manifests and values exactly.

## Validation guidance

Before finishing changes, run the repository's existing YAML parse and Helm validation commands.
If Helm dependency resolution fails because the upstream chart repository is unreachable, state that clearly in the final summary.
