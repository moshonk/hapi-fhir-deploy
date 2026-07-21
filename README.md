# HAPI FHIR Deploy

Scalable HAPI FHIR Kubernetes deployment baseline with external PostgreSQL.

This repository implements the Rev2 handoff tracked by issue #1 through a Helm-first deployment path. It is intended to be enough for an incoming engineer to install, validate, operate, and extend the baseline without re-reading the handoff document.

## Current Baseline

- Runtime: HAPI FHIR JPA Server `8.10.0`.
- Deployment path: wrapper chart in `charts/hapi-fhir-deploy` with the official upstream HAPI FHIR chart.
- Namespace: `fhir`.
- Release name: `hapi-fhir`.
- Service: `hapi-fhir-hapi-fhir-jpaserver`.
- FHIR HTTP port: `8080`.
- Actuator metrics port: `8081`.
- Replicas: `2` steady-state minimum.
- Runtime tuning: `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75 -XX:+UseG1GC -XX:MaxGCPauseMillis=200`.
- Graceful shutdown: `SERVER_SHUTDOWN=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s`, 15-second `preStop`, and 60-second termination grace.
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
| Ansible core | `ansible-core==2.19.1` |
| Python Kubernetes client | `kubernetes==36.0.3` |
| Ansible Kubernetes collection | `kubernetes.core` collection `6.5.0` |
| KEDA Helm chart | `kedacore/keda` chart `2.20.1` |
| Metrics Server Helm chart | `metrics-server/metrics-server` chart `3.13.1` |
| Prometheus Operator Helm chart | `prometheus-community/kube-prometheus-stack` chart `87.17.0` |

## Repository Map

- `charts/hapi-fhir-deploy/Chart.yaml`: Helm wrapper chart with pinned upstream dependencies.
- `charts/hapi-fhir-deploy/values.yaml`: baseline values for replicas, external PostgreSQL, Hikari, probes, resources, PodDisruptionBudget, ServiceMonitors, and image pins.
- `manifests/namespace.yaml`: namespace bootstrap manifest.
- `manifests/external-secrets/hapi-fhir-postgres.yaml`: External Secrets manifest that creates the runtime database Secret.
- `manifests/autoscaling/hapi-fhir-scaledobject.yaml`: KEDA autoscaler for the HAPI FHIR deployment.
- `manifests/runtime-rollout/hapi-fhir-deployment-rollout-patch.yaml`: strategic merge patch for lifecycle fields the upstream chart does not expose.
- `ansible/`: provider-neutral lab orchestration for add-ons, runtime Secret creation, Helm deployment, readiness waits, and metadata collection.
- `infra/terraform/`: multi-cloud benchmark lab infrastructure modules for AWS, Azure, and GCP.
- `benchmarks/k6/`: k6 FHIR benchmark profiles for smoke, baseline, load, and stress workloads.
- `benchmarks/synthea/`: Synthea configuration for deterministic FHIR R4 transaction-bundle seed data.
- `scripts/lab`: ephemeral benchmark lab wrapper for provision, deploy, seed, benchmark, report, and destroy workflows.
- `scripts/publish_results.rb`: local benchmark result publisher for ignored `results/YYYYMMDD-HHMMSS-provider-profile/` artifacts.
- `scripts/synthea_loader.rb`: FHIR R4 transaction-bundle loader and dataset metadata writer.
- `results/`: ignored local benchmark report publications; do not commit generated result artifacts.
- `docs/benchmark-lab-epic.md`: issue #18 acceptance mapping for the full benchmark lab workflow.
- `docs/benchmark-lab-runbook.md`: benchmark lab smoke-run, safety, methodology, interpretation, and teardown runbook.
- `docs/external-postgres.md`: database contract, Secret shape, environment overrides, and connection budget.
- `docs/lab-cli.md`: lab wrapper usage, artifact handling, and teardown procedure.
- `docs/observability.md`: Actuator, Prometheus, exporter, rollout, and rollback checks.
- `docs/autoscaling.md`: KEDA rollout, connection-budget math, PgBouncer threshold, verification, and rollback.
- `docs/runtime-rollout.md`: JVM flags, graceful shutdown, topology spread, PDB alignment, and rollout verification.
- `docs/indexing-strategy.md`: D6 decision memo for disabled advanced indexing.
- `specs/`: Spec Kit workstream specs for the Rev2 child issues.

## Prerequisites

- Kubernetes cluster with permission to manage resources in namespace `fhir`.
- Helm `3.x`.
- Ansible with pinned Python dependencies from `ansible/requirements.txt` and the pinned `kubernetes.core` collection from `ansible/requirements.yml` when using the lab orchestration playbooks.
- External Secrets Operator and a `ClusterSecretStore` named `platform-secrets`, or an equivalent secret-management process.
- External PostgreSQL `16` or `17`.
- Prometheus Operator `ServiceMonitor` CRDs for observability.
- KEDA `2.20.x` and Metrics Server before applying autoscaling.
- Kubernetes `1.30` or newer for the runtime rollout patch's `preStop.sleep` lifecycle hook.

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

Apply the runtime rollout patch after Helm install or upgrade to set lifecycle fields not exposed by chart `0.23.0`:

```sh
kubectl -n fhir patch deployment hapi-fhir-hapi-fhir-jpaserver \
  --type strategic \
  --patch-file manifests/runtime-rollout/hapi-fhir-deployment-rollout-patch.yaml
```

For ephemeral benchmark lab clusters, the Ansible workflow can install add-ons, create the runtime PostgreSQL Secret, run Helm, apply autoscaling/runtime manifests, wait for readiness, and collect non-sensitive deployment metadata:

```sh
python3 -m pip install -r ansible/requirements.txt
ansible-galaxy collection install -r ansible/requirements.yml
export KUBECONFIG=/path/to/lab.kubeconfig
terraform -chdir=infra/terraform/aws output -json > ansible/artifacts/terraform-aws.json
ansible-playbook -i ansible/inventory.ini ansible/playbooks/lab.yml \
  -e terraform_output_file=ansible/artifacts/terraform-aws.json
```

See [ansible/README.md](ansible/README.md) for provider-neutral runtime inputs and artifact handling. Do not commit generated kubeconfigs, Terraform output JSON, runtime values, metadata output, or real database passwords.

The lab wrapper runs the provision, deploy, seed, benchmark, report, and destroy stages consistently:

```sh
scripts/lab up --cloud aws --name hapi-bench --auto-approve
scripts/lab deploy --cloud aws --name hapi-bench
FHIR_BASE_URL=http://localhost:8080/fhir scripts/lab seed --patients 1000 --seed 12345 --run smoke-aws
FHIR_BASE_URL=http://localhost:8080/fhir scripts/lab benchmark --profile smoke --run smoke-aws
scripts/lab report --run smoke-aws
scripts/lab down --cloud aws --name hapi-bench --yes
```

Run `scripts/lab down --cloud aws|azure|gcp --name NAME --yes` promptly after each lab run to destroy cloud resources and control cost. See [docs/lab-cli.md](docs/lab-cli.md) for wrapper options and [docs/benchmark-lab-runbook.md](docs/benchmark-lab-runbook.md) for the smoke benchmark path, safety checklist, methodology, result interpretation, and teardown details.

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

Runtime rollout assumptions are documented in [docs/runtime-rollout.md](docs/runtime-rollout.md). The baseline uses a 15-second `preStop` drain, 30-second Spring shutdown phase timeout, and 60-second pod termination grace period.

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
  manifests/runtime-rollout/hapi-fhir-deployment-rollout-patch.yaml \
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
