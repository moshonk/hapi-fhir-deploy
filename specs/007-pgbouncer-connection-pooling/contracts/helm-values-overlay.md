# Contract: `charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml`

## Purpose

An additive Helm values file. Applied as an *extra* `--values` entry after the base `charts/hapi-fhir-deploy/values.yaml`, never as a replacement for it. Standard Helm overlay semantics apply: keys present in this file override the base file's values for the same key; keys absent from this file fall through to the base file unchanged.

## Required keys

```yaml
hapi-fhir-jpaserver:
  replicaCount: <int>        # MUST be <= maxReplicas_pooled from the connection-budget-formula contract
  extraConfig: |
    spring:
      datasource:
        url: <PgBouncer Service JDBC URL, not the raw Postgres endpoint>
        hikari:
          maximumPoolSize: <int>   # same key path as the base file; this value is what the pooled formula's
                                     # hikari_maximum_pool_size input reads
```

## Invariants

1. This file MUST NOT redefine `hibernate.search.enabled`, `spring.jpa.properties.hibernate.dialect`, or any other key already asserted by the existing native-tier CI check (`.github/workflows/ci.yml:263-283`) unless the override is identical in effect — the pooled tier changes *scale*, not the JPA/Lucene/dialect decisions already made under specs 003/005.
2. `charts/hapi-fhir-deploy/values.yaml` (the base file) MUST remain byte-for-byte unchanged by this feature. Diff review of any PR implementing this contract MUST show zero changes to that file.
3. The Hikari `prepareThreshold`/`cachePrepStmts`-equivalent JDBC URL parameters (see `research.md` Decision 3) MUST be set consistently with the validated PgBouncer prepared-statement configuration when pooling is enabled.

## Consumers

- Ansible's `values_files` list in the deploy playbook (`ansible/playbooks/20-deploy-hapi-fhir.yml` and the new `ansible/playbooks/15-deploy-pgbouncer.yml`), gated by `enable_pgbouncer: true` in `ansible/group_vars/lab.yml`.
- The new CI guardrail step (`contracts/connection-budget-formula.md`), which reads this file's `hikari.maximumPoolSize` and `replicaCount` as formula inputs.
