---
applyTo: '.github/workflows/**/*.yml,.github/workflows/**/*.yaml'
description: 'Repository-specific GitHub Actions guidance for deterministic YAML and Helm validation workflows'
---

# GitHub Actions workflow instructions

## Workflow goals

- Keep CI focused on deterministic validation of YAML, Helm rendering, and repository guardrails.
- Prefer simple built-in shell, Ruby, and Helm commands over custom helper tooling for this repository.

## Rules

- Use least-privilege `permissions`.
- Keep workflow versions pinned to major or explicit versions already accepted in the repo.
- Validate the same files and constraints that operators rely on locally.
- For Helm-based checks, make upstream dependency fetching explicit and fail loudly when the chart repository is unreachable.
- Avoid workflows that would require committing secrets or environment-specific credentials into the repository.

## Guardrails to preserve

- Explicit datasource configuration must remain validated.
- Image tags must stay pinned and must not drift to `latest`.
- Bundled PostgreSQL resources must not be rendered.
- YAML parsing should remain part of the workflow to catch syntax regressions early.
