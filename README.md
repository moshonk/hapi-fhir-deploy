# HAPI FHIR Deploy

Kubernetes deployment baseline for a scalable HAPI FHIR JPA Server using the official HAPI FHIR Helm chart and an external PostgreSQL database.

This repository tracks the Rev2 handoff baseline in issue #1. The first implemented workstream is Helm values and external PostgreSQL wiring.

## Baseline

- HAPI FHIR chart: `hapifhir/hapi-fhir-jpaserver` pinned through `charts/hapi-fhir-deploy/Chart.yaml`.
- HAPI FHIR image: `docker.io/hapiproject/hapi:v8.8.0-1@sha256:34c86fd5805df77c2b9d9c10538050b16ac3dc244352da0ebe4717f931330775`.
- PostgreSQL: external service only, PostgreSQL 16 or 17.
- Database configuration: explicit `spring.datasource.*` settings through chart `extraConfig`.
- Search indexing: Hibernate Search is disabled until the D6 indexing memo decides between Lucene disabled and Elasticsearch/OpenSearch.
- Messaging: no Kafka or Zookeeper in this starter architecture.

## Files

- `charts/hapi-fhir-deploy/Chart.yaml`: Helm wrapper chart with the official HAPI FHIR chart dependency pinned to `0.23.0`.
- `charts/hapi-fhir-deploy/values.yaml`: baseline values for external PostgreSQL, Hikari pool sizing, pinned image, resources, and PodDisruptionBudget.
- `manifests/namespace.yaml`: namespace expected by the example install commands.
- `manifests/external-secrets/hapi-fhir-postgres.yaml`: External Secrets manifest that creates the `hapi-fhir-postgres` runtime Secret.

## Database Contract

Provision PostgreSQL outside this chart before installing HAPI FHIR:

- Version must be PostgreSQL 16 or 17.
- Database name: `hapi_fhir`.
- Database user: `hapi_fhir`.
- Runtime Secret: `fhir/hapi-fhir-postgres`.
- Secret key: `password`.
- Service DNS used by default values: `hapi-fhir-postgres-rw.postgres.svc.cluster.local`.

Update both `externalDatabase` and `extraEnv.HAPI_FHIR_POSTGRES_JDBC_URL` in `charts/hapi-fhir-deploy/values.yaml` if your host, database, or username differs.

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
kubectl -n fhir get pods,svc,secret hapi-fhir-postgres
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080
curl -fsS http://localhost:8080/fhir/metadata
```

If the deployment does not start, inspect the HAPI pod logs first for `spring.datasource` or PostgreSQL authentication errors. H2 fallback should not be considered acceptable for this baseline.
