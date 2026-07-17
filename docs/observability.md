# Observability Runbook

This baseline uses the upstream HAPI FHIR chart's built-in Actuator and Micrometer support. It does not deploy a JMX exporter sidecar or custom HAPI image.

The monitoring integration expects Prometheus Operator `ServiceMonitor` CRDs to be installed in the cluster. If your Prometheus install filters ServiceMonitors by label, add the required selector labels under `hapi-fhir-jpaserver.metrics.serviceMonitor.additionalLabels` and `fhir-server-exporter.serviceMonitor.additionalLabels`.

## Runtime Surfaces

- HAPI HTTP service: `hapi-fhir-hapi-fhir-jpaserver:8080`
- HAPI Actuator metrics service port: `hapi-fhir-hapi-fhir-jpaserver:8081`
- Health probes:
  - `/actuator/health/liveness`
  - `/actuator/health/readiness`
- Prometheus metrics:
  - `/actuator/prometheus`
- FHIR server exporter:
  - chart: `fhir-server-exporter` `1.2.35`
  - image: `ghcr.io/chgl/fhir-server-exporter:v3.0.15@sha256:d2f34aa65bc7e65de5073864d03907759979f477ed06460061d3eb9c23d64408`
  - target: `http://hapi-fhir-hapi-fhir-jpaserver:8080/fhir`

## Rollout Verification

Wait for both deployments:

```sh
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir rollout status deploy/hapi-fhir-fhir-server-exporter
```

Check the rendered services and ServiceMonitors:

```sh
kubectl -n fhir get svc hapi-fhir-hapi-fhir-jpaserver hapi-fhir-fhir-server-exporter
kubectl get servicemonitor -A | grep -E 'hapi-fhir-hapi-fhir-jpaserver|hapi-fhir-fhir-server-exporter'
```

Port-forward the HAPI service and verify Actuator endpoints:

```sh
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8081:8081
curl -fsS http://localhost:8081/actuator/health/liveness
curl -fsS http://localhost:8081/actuator/health/readiness
curl -fsS http://localhost:8081/actuator/prometheus | grep -E 'jvm_memory_used_bytes|hikaricp_connections_active|http_server_requests_seconds'
```

Port-forward the exporter and verify it emits FHIR-specific metrics:

```sh
kubectl -n fhir port-forward svc/hapi-fhir-fhir-server-exporter 8082:8080
curl -fsS http://localhost:8082/metrics | grep fhir
```

In Prometheus, confirm the scrape targets are up:

```promql
up{namespace="fhir",service=~"hapi-fhir-hapi-fhir-jpaserver|hapi-fhir-fhir-server-exporter"}
```

Then check metric continuity:

```promql
jvm_memory_used_bytes{namespace="fhir"}
hikaricp_connections_active{namespace="fhir"}
http_server_requests_seconds_count{namespace="fhir"}
```

## Rollback

Roll back with Helm if either ServiceMonitor breaks scraping or the exporter creates unacceptable FHIR API load:

```sh
helm -n fhir rollback hapi-fhir
```

To disable only the exporter in a follow-up release while keeping HAPI Actuator scraping enabled, set:

```yaml
fhir-server-exporter:
  enabled: false
```
