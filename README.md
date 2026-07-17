# HAPI FHIR Deploy

Kubernetes deployment baseline for a scalable HAPI FHIR JPA Server using the official HAPI FHIR Helm chart and an external PostgreSQL database.

This repository tracks the Rev2 handoff baseline in issue #1. Implemented workstreams include external PostgreSQL wiring and the Actuator/Micrometer observability baseline.

## Baseline

- HAPI FHIR chart: `hapifhir/hapi-fhir-jpaserver` pinned through `charts/hapi-fhir-deploy/Chart.yaml`.
- HAPI FHIR image: `docker.io/hapiproject/hapi:v8.10.0-2@sha256:c5e53fb34bf39958c336837795f504673103f212e179ced14c8f7b96b585a182`.
- Image review: `v8.10.0-2` is the reviewed 8.10 distroless build selected for issue #3.
- PostgreSQL: external service only, PostgreSQL 16 or 17.
- Database configuration: explicit `spring.datasource.*` settings through chart `extraConfig`.
- Observability: built-in Actuator health and Prometheus endpoints on the HAPI metrics port, plus `fhir-server-exporter` chart `1.2.35`.
- Search indexing: Hibernate Search advanced indexing is disabled by design; see [docs/indexing-strategy.md](docs/indexing-strategy.md).
- Messaging: no Kafka or Zookeeper in this starter architecture.

## Files

- `charts/hapi-fhir-deploy/Chart.yaml`: Helm wrapper chart with the official HAPI FHIR chart dependency pinned to `0.23.0` and `fhir-server-exporter` pinned to `1.2.35`.
- `charts/hapi-fhir-deploy/values.yaml`: baseline values for external PostgreSQL, Hikari pool sizing, pinned images, resources, PodDisruptionBudget, probes, ServiceMonitors, and the FHIR server exporter.
- `manifests/namespace.yaml`: namespace expected by the example install commands.
- `manifests/external-secrets/hapi-fhir-postgres.yaml`: External Secrets manifest that creates the `hapi-fhir-postgres` runtime Secret.
- `docs/observability.md`: monitoring rollout, scrape, metric continuity, and rollback checks.
- `docs/indexing-strategy.md`: D6 memo comparing disabled advanced indexing with shared Elasticsearch/OpenSearch.

## Database Contract

Provision PostgreSQL outside this chart before installing HAPI FHIR:

- Version must be PostgreSQL 16 or 17.
- Database name: `hapi_fhir`.
- Database user: `hapi_fhir`.
- Runtime Secret: `fhir/hapi-fhir-postgres`.
- Secret key: `password`.
- Service DNS used by default values: `hapi-fhir-postgres-rw.postgres.svc.cluster.local`.

Update these values in `charts/hapi-fhir-deploy/values.yaml` if your environment differs:

- `hapi-fhir-jpaserver.externalDatabase.host`
- `hapi-fhir-jpaserver.externalDatabase.port`
- `hapi-fhir-jpaserver.externalDatabase.user`
- `hapi-fhir-jpaserver.externalDatabase.database`
- `hapi-fhir-jpaserver.externalDatabase.existingSecret`
- `hapi-fhir-jpaserver.externalDatabase.existingSecretKey`
- `hapi-fhir-jpaserver.extraEnv[]` item named `HAPI_FHIR_POSTGRES_JDBC_URL`
- `hapi-fhir-jpaserver.extraEnv[]` item named `HAPI_FHIR_POSTGRES_USERNAME`
- `hapi-fhir-jpaserver.extraEnv[]` item named `HAPI_FHIR_POSTGRES_PASSWORD`

Update `manifests/external-secrets/hapi-fhir-postgres.yaml` if your External Secrets `ClusterSecretStore`, remote key, or remote property differs.

## Install

Install the namespace and reconcile the database Secret:

```sh
kubectl apply -f manifests/namespace.yaml
kubectl apply -f manifests/external-secrets/hapi-fhir-postgres.yaml
```

Install or upgrade HAPI FHIR:

```sh
helm dependency update charts/hapi-fhir-deploy
helm upgrade --install hapi-fhir charts/hapi-fhir-deploy \
  --namespace fhir \
  --values charts/hapi-fhir-deploy/values.yaml
```

The `ExternalSecret` references a placeholder `ClusterSecretStore` named `platform-secrets` and remote key `prod/hapi-fhir/postgres`. Replace those with the secret store and key path for the target cluster.

## Verification

After rollout:

```sh
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir get pods -l app.kubernetes.io/instance=hapi-fhir
kubectl -n fhir get svc hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir get secret hapi-fhir-postgres
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080
curl -fsS http://localhost:8080/fhir/metadata
```

If the deployment does not start, inspect the HAPI pod logs first for `spring.datasource` or PostgreSQL authentication errors. H2 fallback should not be considered acceptable for this baseline.

## Monitoring

The chart exposes HAPI Actuator probes at `/actuator/health/liveness` and `/actuator/health/readiness`, Prometheus metrics at `/actuator/prometheus`, and deploys `fhir-server-exporter` against the in-cluster HAPI FHIR service. See [docs/observability.md](docs/observability.md) for rollout checks, Prometheus scrape validation, metric continuity queries, and rollback guidance.
