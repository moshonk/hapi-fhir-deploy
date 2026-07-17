---
applyTo: 'charts/**/*.yaml,charts/**/*.yml,manifests/**/*.yaml,manifests/**/*.yml'
description: 'Repository-specific rules for Helm values and Kubernetes manifests used to deploy HAPI FHIR with external PostgreSQL'
---

# Kubernetes and Helm instructions

## Core rules

- Prefer upstream chart values and supported chart extension points before adding new standalone manifests.
- Preserve the wrapper-chart approach in `charts/hapi-fhir-deploy`.
- Do not enable bundled PostgreSQL, Kafka, or Zookeeper.
- Keep database configuration explicit with `spring.datasource.*` and PostgreSQL driver/dialect settings.
- Keep `hibernate.search.enabled: false` unless the D6 indexing decision is documented and implemented together.
- Pin images and chart dependencies to explicit versions or digests; never use `latest`.

## Secrets and configuration

- Store sensitive values in Secret references, not plaintext YAML.
- Reuse the established `hapi-fhir-postgres` secret contract unless an issue explicitly changes it.
- Prefer `ExternalSecret` or another documented secret-management integration over committed `Secret` manifests.

## Reliability and operations

- Keep manifests compatible with the roadmap issues for observability, autoscaling, runtime tuning, and safe rollouts.
- When changing replica counts, Hikari settings, or autoscaling, document or preserve the PostgreSQL connection-budget math.
- Favor production-safe defaults: health probes, PodDisruptionBudget, conservative rollout behavior, and explicit resources.
- Preserve or improve standard Kubernetes labels and `app.kubernetes.io/*` metadata.

## Validation

- Parse edited YAML before finishing.
- Run `helm lint` and `helm template` for chart changes when dependency resolution is available.
- If a validation step is blocked by upstream network access, report the exact failure.
