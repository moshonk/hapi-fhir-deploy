# HAPI FHIR Deploy

Helm-first Kubernetes deployment baseline for a scalable HAPI FHIR JPA Server using external PostgreSQL.

This repository implements the Rev2 handoff tracked by issue #1. It is intended to be enough for an incoming engineer to install, validate, operate, and extend the baseline without re-reading the handoff document.

## Current Baseline

- Runtime: HAPI FHIR JPA Server `8.10.0`.
- Deployment path: wrapper chart in `charts/hapi-fhir-deploy` with the official upstream HAPI FHIR chart.
- Namespace: `fhir`.
- Release name: `hapi-fhir`.
- Service: `hapi-fhir-hapi-fhir-jpaserver`.
- FHIR HTTP port: `8080`.
- Actuator metrics port: `8081`.
- Replicas: `2` steady-state minimum.
- Database: external PostgreSQL `16` or `17`; no in-chart PostgreSQL.
- Runtime Secret: `fhir/hapi-fhir-postgres`, key `password`.
- Observability: built-in Actuator and Micrometer with Prometheus `ServiceMonitor`; no custom JMX exporter image.
- Autoscaling: KEDA `ScaledObject` with Prometheus request-rate and CPU triggers, capped by PostgreSQL connection-budget math.
- Search indexing: Hibernate Search advanced indexing is disabled by design; see [docs/indexing-strategy.md](docs/indexing-strategy.md).

## Rev2 Decisions

- D1: Kafka and Zookeeper are not part of the OSS starter architecture.
- D2: HAPI FHIR is configured with explicit `spring.datasource.*` settings so it cannot silently fall back to embedded H2.
- D3: Observability uses built-in Actuator and Micrometer before custom exporter images.
- D4: PostgreSQL support targets version `16` or `17` only.
- D5: Charts, images, and workflow/tool versions are pinned; `latest` is prohibited.
- D6: Hibernate Search remains disabled unless a future memo and implementation choose shared Elasticsearch/OpenSearch.

## Known Non-Goals

- No Kafka or Zookeeper tier.
- No scale-to-zero behavior.
- No bundled PostgreSQL StatefulSet.
- No H2 fallback.
- No implicit embedded-Lucene indexing across multiple replicas.
- No committed plaintext Secrets, kubeconfigs, passwords, or production-looking credentials.

## Pinned Versions

| Component | Pin |
| --- | --- |
| Wrapper chart | `charts/hapi-fhir-deploy` version `0.1.0` |
| HAPI chart | `hapifhir/hapi-fhir-jpaserver` chart `0.23.0` |
| HAPI image | `docker.io/hapiproject/hapi:v8.10.0-2@sha256:c5e53fb34bf39958c336837795f504673103f212e179ced14c8f7b96b585a182` |
| FHIR exporter chart | `fhir-server-exporter` chart `1.2.35` |
| FHIR exporter image | `ghcr.io/chgl/fhir-server-exporter:v3.0.15@sha256:d2f34aa65bc7e65de5073864d03907759979f477ed06460061d3eb9c23d64408` |
| GitHub Actions checkout | `actions/checkout@v4` |
| GitHub Actions Ruby setup | `ruby/setup-ruby@v1`, Ruby `3.3` |
| GitHub Actions Helm setup | `azure/setup-helm@v4`, Helm `v3.15.4` |
| KEDA API | `keda.sh/v1alpha1` `ScaledObject`; install KEDA `2.20.x` CRDs/controller |

## Repository Map

- `charts/hapi-fhir-deploy/Chart.yaml`: Helm wrapper chart with pinned upstream dependencies.
- `charts/hapi-fhir-deploy/values.yaml`: baseline values for replicas, external PostgreSQL, Hikari, probes, resources, PodDisruptionBudget, ServiceMonitors, and image pins.
- `manifests/namespace.yaml`: namespace bootstrap manifest.
- `manifests/external-secrets/hapi-fhir-postgres.yaml`: External Secrets manifest that creates the runtime database Secret.
- `manifests/autoscaling/hapi-fhir-scaledobject.yaml`: KEDA autoscaler for the HAPI FHIR deployment.
- `docs/external-postgres.md`: database contract, Secret shape, environment overrides, and connection budget.
- `docs/observability.md`: Actuator, Prometheus, exporter, rollout, and rollback checks.
- `docs/autoscaling.md`: KEDA rollout, connection-budget math, PgBouncer threshold, verification, and rollback.
- `docs/indexing-strategy.md`: D6 decision memo for disabled advanced indexing.
- `specs/`: Spec Kit workstream specs for the Rev2 child issues.

## Prerequisites

- Kubernetes cluster with permission to manage resources in namespace `fhir`.
- Helm `3.x`.
- External Secrets Operator and a `ClusterSecretStore` named `platform-secrets`, or an equivalent secret-management process.
- External PostgreSQL `16` or `17`.
- Prometheus Operator `ServiceMonitor` CRDs for observability.
- KEDA `2.20.x` and Metrics Server before applying autoscaling.

## Database Contract

Provision PostgreSQL outside this chart before installing HAPI FHIR:

- Database host: `hapi-fhir-postgres-rw.postgres.svc.cluster.local`
- Port: `5432`
- Database name: `hapi_fhir`
- Database user: `hapi_fhir`
- Runtime Secret: `fhir/hapi-fhir-postgres`
- Secret key: `password`

The runtime Secret shape is:

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

Do not commit a real Secret manifest. Use [manifests/external-secrets/hapi-fhir-postgres.yaml](manifests/external-secrets/hapi-fhir-postgres.yaml), Sealed Secrets, or platform-native secret injection.

Update these file-backed values when moving between environments:

- [charts/hapi-fhir-deploy/values.yaml](charts/hapi-fhir-deploy/values.yaml): `hapi-fhir-jpaserver.externalDatabase.*`.
- [charts/hapi-fhir-deploy/values.yaml](charts/hapi-fhir-deploy/values.yaml): `hapi-fhir-jpaserver.extraEnv[]` entries for `HAPI_FHIR_POSTGRES_JDBC_URL`, `HAPI_FHIR_POSTGRES_USERNAME`, and `HAPI_FHIR_POSTGRES_PASSWORD`.
- [manifests/external-secrets/hapi-fhir-postgres.yaml](manifests/external-secrets/hapi-fhir-postgres.yaml): `spec.secretStoreRef.name`, `spec.data[].remoteRef.key`, and `spec.data[].remoteRef.property`.

## Install

Install the namespace and reconcile the database Secret:

```sh
kubectl apply -f manifests/namespace.yaml
kubectl apply -f manifests/external-secrets/hapi-fhir-postgres.yaml
```

Build dependencies and install or upgrade HAPI FHIR:

```sh
helm dependency update charts/hapi-fhir-deploy
helm upgrade --install hapi-fhir charts/hapi-fhir-deploy \
  --namespace fhir \
  --values charts/hapi-fhir-deploy/values.yaml
```

After the HAPI rollout is healthy, apply the autoscaler if KEDA and Metrics Server are installed:

```sh
kubectl apply -f manifests/autoscaling/hapi-fhir-scaledobject.yaml
```

## Rollout Verification

Check deployment, service, and Secret state:

```sh
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir rollout status deploy/hapi-fhir-fhir-server-exporter
kubectl -n fhir get pods -l app.kubernetes.io/instance=hapi-fhir
kubectl -n fhir get svc hapi-fhir-hapi-fhir-jpaserver hapi-fhir-fhir-server-exporter
kubectl -n fhir get secret hapi-fhir-postgres
```

Verify the FHIR endpoint:

```sh
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080
curl -fsS http://localhost:8080/fhir/metadata
```

If the deployment does not start, inspect datasource and PostgreSQL errors first:

```sh
kubectl -n fhir logs deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir describe pod -l app.kubernetes.io/instance=hapi-fhir
```

H2 fallback is not acceptable for this baseline.

## Observability Checklist

Actuator and Prometheus surfaces are documented in [docs/observability.md](docs/observability.md).

```sh
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8081:8081
curl -fsS http://localhost:8081/actuator/health/liveness
curl -fsS http://localhost:8081/actuator/health/readiness
curl -fsS http://localhost:8081/actuator/prometheus | grep -E 'jvm_memory_used_bytes|hikaricp_connections_active|http_server_requests_seconds'
```

Check Prometheus discovery:

```sh
kubectl get servicemonitor -A | grep -E 'hapi-fhir-hapi-fhir-jpaserver|hapi-fhir-fhir-server-exporter'
```

Prometheus queries:

```promql
up{namespace="fhir",service=~"hapi-fhir-hapi-fhir-jpaserver|hapi-fhir-fhir-server-exporter"}
hikaricp_connections_active{namespace="fhir"}
http_server_requests_seconds_count{namespace="fhir"}
```

Exporter check:

```sh
kubectl -n fhir port-forward svc/hapi-fhir-fhir-server-exporter 8082:8080
curl -fsS http://localhost:8082/metrics | grep fhir
```

## Autoscaling And Connection Budget

KEDA scales `deploy/hapi-fhir-hapi-fhir-jpaserver` with:

- Minimum replicas: `2`
- Maximum replicas: `5`
- Primary trigger: `sum(rate(http_server_requests_seconds_count{job="hapi-fhir-actuator"}[2m]))`
- Provisional per-pod RPS threshold: `5`
- Secondary trigger: CPU utilization at `70%`
- Scale-down stabilization: `300` seconds

Connection-budget equation:

```text
maxReplicas <= floor((postgres_max_connections - reserved_connections) / hikari_maximum_pool_size)
maxReplicas <= floor((100 - 50) / 10)
maxReplicas <= 5
```

The committed values assume PostgreSQL `max_connections: 100`, reserved connections `50`, and Hikari `maximumPoolSize: 10`. PgBouncer transaction pooling is required before raising desired replicas above the native PostgreSQL budget. See [docs/autoscaling.md](docs/autoscaling.md) before changing `maxReplicaCount`, Hikari pool size, Prometheus address, or the RPS threshold.

## Rollback And Graceful Shutdown

Remove autoscaling before forcing a manual replica count:

```sh
kubectl delete -f manifests/autoscaling/hapi-fhir-scaledobject.yaml
kubectl -n fhir scale deploy/hapi-fhir-hapi-fhir-jpaserver --replicas=2
```

Roll back the Helm release:

```sh
helm -n fhir history hapi-fhir
helm -n fhir rollback hapi-fhir
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
```

During planned maintenance, keep at least two replicas and respect the `PodDisruptionBudget`:

```sh
kubectl -n fhir get pdb
kubectl -n fhir get deploy hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
```

Do not scale HAPI FHIR to zero. If a shutdown is required, first drain traffic at the ingress or service-routing layer, confirm no active rollout is in progress, remove the KEDA autoscaler, then scale down only as far as the approved maintenance procedure allows.

## Repository Metadata

GitHub repository description:

```text
Scalable HAPI FHIR Kubernetes deployment baseline with external PostgreSQL
```

This description should stay aligned with issue #6 and the current README tagline.

## Validation

Run the local YAML parser:

```sh
ruby -rpsych -e 'ARGV.each { |path| Psych.parse_stream(File.read(path)); puts "ok #{path}" }' \
  .github/workflows/ci.yml \
  charts/hapi-fhir-deploy/Chart.yaml \
  charts/hapi-fhir-deploy/values.yaml \
  manifests/namespace.yaml \
  manifests/autoscaling/hapi-fhir-scaledobject.yaml \
  manifests/external-secrets/hapi-fhir-postgres.yaml
```

Run Helm validation when `helm` is installed and upstream chart repositories are reachable:

```sh
helm dependency build charts/hapi-fhir-deploy
helm lint charts/hapi-fhir-deploy --values charts/hapi-fhir-deploy/values.yaml
helm template hapi-fhir charts/hapi-fhir-deploy \
  --namespace fhir \
  --values charts/hapi-fhir-deploy/values.yaml > /tmp/hapi-fhir-rendered.yaml
ruby -rpsych -e 'Psych.parse_stream(File.read("/tmp/hapi-fhir-rendered.yaml")); puts "ok rendered manifests"'
```

CI also checks pinned images, chart dependencies, excluded Kafka/Zookeeper/H2 resources, datasource rendering, indexing guardrails, autoscaling guardrails, and README handoff sections.
