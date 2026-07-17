---
applyTo: 'README.md,docs/**/*.md'
description: 'Repository-specific documentation guidance for HAPI FHIR deployment runbooks, memos, and architecture notes'
---

# Markdown documentation instructions

## Audience and style

- Write for engineers operating or extending this deployment baseline.
- Prefer concise, task-oriented Markdown with GitHub-flavored formatting.
- Keep claims anchored to committed manifests, chart values, and open issues.

## Content rules

- Treat the README as an onboarding and runbook entry point for the current baseline.
- Document architecture decisions, constraints, and non-goals that affect safe deployment behavior.
- When an issue tracks unfinished work, describe the current state and avoid implying the work is already complete.
- Use exact resource names, namespaces, secret names, ports, and chart paths from the repository.
- When documenting validation or rollout steps, include both verification and failure-investigation guidance.

## Formatting

- Use clear heading hierarchy and fenced code blocks with language identifiers.
- Prefer bullet lists and short sections over long narrative paragraphs.
- Keep terminology consistent with the repo: HAPI FHIR, external PostgreSQL, wrapper chart, External Secrets, Actuator, ServiceMonitor, HPA/KEDA.
