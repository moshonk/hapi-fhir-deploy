# External PostgreSQL Wiring

The HAPI FHIR Helm release uses the upstream chart's `externalDatabase` values and an explicit Spring Boot datasource override.

The target database must be an externally managed PostgreSQL 16 or 17 instance, including a managed service or a CloudNativePG-managed cluster. This repository does not ship a PostgreSQL StatefulSet.

## Why Both Are Set

The chart uses `externalDatabase` for its database connection wiring and wait-for-database behavior. The baseline also sets `spring.datasource.*` through `extraConfig` so the application fails against the intended PostgreSQL target instead of silently running with its embedded H2 defaults.

## Runtime Secret Shape

The HAPI release expects this Kubernetes Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: hapi-fhir-postgres
  namespace: fhir
type: Opaque
stringData:
  password: replace-me
```

Do not commit a real Secret manifest. Use the External Secrets manifest in `manifests/external-secrets/hapi-fhir-postgres.yaml`, Sealed Secrets, or the platform's native secret injection mechanism.

## Environment Overrides

Update these locations when moving between environments:

- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.externalDatabase.host`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.externalDatabase.port`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.externalDatabase.user`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.externalDatabase.database`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.externalDatabase.existingSecret`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.externalDatabase.existingSecretKey`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.extraEnv[]` item named `HAPI_FHIR_POSTGRES_JDBC_URL`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.extraEnv[]` item named `HAPI_FHIR_POSTGRES_USERNAME`
- `charts/hapi-fhir-deploy/values.yaml`: `hapi-fhir-jpaserver.extraEnv[]` item named `HAPI_FHIR_POSTGRES_PASSWORD`
- `manifests/external-secrets/hapi-fhir-postgres.yaml`: `spec.secretStoreRef.name`
- `manifests/external-secrets/hapi-fhir-postgres.yaml`: `spec.data[]` entry with `secretKey: password`

Keep `externalDatabase` and the `extraEnv` datasource values aligned. The chart uses `externalDatabase` for database wait behavior, while `extraConfig` consumes the Secret-backed environment variables as explicit `spring.datasource.*` settings.

## Connection Budget

The baseline sets `spring.datasource.hikari.maximumPoolSize` to `10` and starts with `replicaCount: 2`, so the steady-state HAPI application budget is:

```text
max_app_connections = replicaCount * hikari.maximumPoolSize
max_app_connections = 2 * 10 = 20
```

The issue #5 autoscaling baseline in `manifests/autoscaling/hapi-fhir-scaledobject.yaml` assumes PostgreSQL `max_connections: 100` with `50` reserved connections, so it caps scale-out at:

```text
maxReplicas <= floor((max_connections - reserved) / hikari.maximumPoolSize)
maxReplicas <= floor((100 - 50) / 10)
maxReplicas <= 5
```

Keep application connections below the PostgreSQL `max_connections` budget after subtracting reserved admin, migration, monitoring, maintenance, and provider-overhead connections. PgBouncer transaction pooling is required before raising desired replicas beyond the native PostgreSQL budget. See `docs/autoscaling.md` for the rollout and recalculation workflow.

Issue #7 requested keeping `hikari.maximum-pool-size=20` unless load tests justify a change. The committed baseline keeps `maximumPoolSize: 10` because issue #5's autoscaling ceiling is based on the native PostgreSQL budget above. Raising Hikari to `20` without changing the database or adding PgBouncer would reduce the safe native ceiling to `floor((100 - 50) / 20) = 2` replicas. See `docs/runtime-rollout.md` for the runtime tuning decision.

## Search Indexing

`hibernate.search.enabled: false` is deliberate. The D6 memo in `docs/indexing-strategy.md` selects disabled advanced indexing for the starter baseline. Do not introduce Lucene, Elasticsearch, or OpenSearch dependencies unless a follow-up issue changes that decision and provides shared-backend configuration, migration, and rollback plans.
