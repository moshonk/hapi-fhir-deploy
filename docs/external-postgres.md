# External PostgreSQL Wiring

The HAPI FHIR Helm release uses the upstream chart's `externalDatabase` values and an explicit Spring Boot datasource override.

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

## Connection Budget

The baseline sets `spring.datasource.hikari.maximumPoolSize` to `10` and starts with `replicaCount: 2`, so the HAPI application budget is:

```text
max_app_connections = replicaCount * hikari.maximumPoolSize
max_app_connections = 2 * 10 = 20
```

Keep this below the PostgreSQL `max_connections` budget after subtracting reserved admin, migration, monitoring, and maintenance connections. Any autoscaling workstream must update this math before increasing replicas or pool size.

## Search Indexing

`hibernate.search.enabled: false` is deliberate. The D6 memo must decide whether this deployment keeps Lucene disabled or adds Elasticsearch/OpenSearch. Do not introduce an Elasticsearch/OpenSearch dependency in this baseline until that decision is recorded.
