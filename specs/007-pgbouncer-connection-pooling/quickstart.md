# Quickstart: Validating the PgBouncer Pooled Connection Tier

Prerequisites: same as the existing benchmark lab (`docs/getting-started-benchmark-lab.md`) — Terraform `>=1.9.0,<2.0.0`, Helm 3.x, kubectl, Ruby, cloud credentials for one provider — plus this feature's new manifests, overlay, and playbook applied.

## 1. Confirm zero regression with pooling disabled (default)

```sh
helm template hapi-fhir charts/hapi-fhir-deploy --namespace fhir \
  --values charts/hapi-fhir-deploy/values.yaml > /tmp/native-tier.yaml
```

Diff this against a render taken before this feature's changes landed — it MUST be identical. This is the concrete check behind spec 007's SC-001.

## 2. Provision with an enforced connection limit

```sh
scripts/lab up --cloud <gcp|aws|azure> --name <lab-name> --auto-approve \
  --var db_max_connections=200 \
  ... # other existing --var flags per docs/benchmark-lab-runbook.md
```

Inspect the provisioned instance directly (cloud console or CLI) and confirm its live `max_connections` matches `200` — not just the Terraform plan. This validates `contracts/terraform-max-connections.md` invariant 2.

## 3. Enable the pooled tier and deploy

```sh
# ansible/group_vars/lab.yml or -e override:
enable_pgbouncer: true
```

```sh
scripts/lab deploy --cloud <gcp|aws|azure> --name <lab-name>
```

Confirm:
- `manifests/pgbouncer/deployment.yaml` pods are `Running` and pass readiness.
- HAPI FHIR pods' `spring.datasource.url` resolves to the PgBouncer Service, not the raw Postgres endpoint (`kubectl -n fhir exec` into a HAPI pod and inspect resolved config, or check `hapi-fhir-values.runtime.yaml.j2` render output).

## 4. Verify the pooled connection budget holds under load

```sh
kubectl -n fhir exec deploy/pgbouncer -- psql -h 127.0.0.1 -p 6432 pgbouncer -c "SHOW POOLS;"
```

Run the `smoke` then `baseline` k6 profiles (`scripts/lab benchmark --profile smoke|baseline`) and confirm `SHOW POOLS`'s server-connection count never exceeds `pgbouncer_default_pool_size * pgbouncer_replica_count`, and that the real Postgres instance's active-connection count never exceeds `postgres_max_connections - reserved_connections`.

## 5. Run the new CI guardrail locally

```sh
# once implemented under .github/workflows/ci.yml's new step:
ruby -e '<pooled-formula check script>' \
  charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml \
  manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml
```

Confirm it fails when `maxReplicaCount` exceeds the derived ceiling, and passes (as a no-op) when the pooled-tier files are absent (see `contracts/connection-budget-formula.md`, "Behavior when the pooled-tier files are absent").

## 6. Validate prepared-statement compatibility

Run a representative write-heavy workload (the sibling `008-echis-workload-benchmark` spec's `household_sync_write` operation, once available, or any repeated parameterized-query workload in the interim) against the pooled tier and confirm zero query errors attributable to prepared-statement mismatches. Record the validated PgBouncer version and Hikari/JDBC settings in `docs/autoscaling.md` per spec 007 SC-006.

## 7. Validate the bulk-load / serving separation

Run a data-seed operation with a temporarily raised manual replica/pool count (autoscaling paused), then confirm the deployment returns to the committed pooled-tier ceiling before starting a benchmark profile. This validates spec 007 User Story 3 / SC-005.

## 8. Tear down

```sh
scripts/lab down --cloud <gcp|aws|azure> --name <lab-name> --yes
```
