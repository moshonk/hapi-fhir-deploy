# Benchmark Lab Runbook

This runbook is the operator path for the ephemeral multi-cloud HAPI FHIR benchmark lab. It assumes the repository defaults are acceptable for a smoke run and calls out where to override cloud size, region, Synthea population, and benchmark profile.

The lab creates billable cloud resources. Run `scripts/lab down --cloud aws|azure|gcp --name NAME --yes` as soon as the benchmark, report, or failed experiment is complete.

## Quick Smoke Benchmark

Use this path for a first run or for validating a new engineer workstation. Replace `aws` and `hapi-smoke` if you are using another provider or lab name.

Prerequisites:

- Terraform `1.9.x`.
- Python `3` with the pinned Ansible dependencies from `ansible/requirements.txt`.
- Ansible collections from `ansible/requirements.yml`.
- Helm `3.x`, `kubectl`, k6, Ruby, and Java `17` or newer for Synthea.
- Synthea available through `SYNTHEA_CMD`, a `synthea` executable on `PATH`, or `$SYNTHEA_HOME/run_synthea`.
- Cloud CLI credentials for exactly one target provider.

Install local orchestration dependencies:

```sh
python3 -m pip install -r ansible/requirements.txt
ansible-galaxy collection install -r ansible/requirements.yml
```

Set run variables:

```sh
export CLOUD=aws
export LAB_NAME=hapi-smoke
export RUN_ID=smoke-aws-001
export PATIENTS=25
export SYNTHEA_SEED=12345
```

Create, deploy, seed, benchmark, report, and destroy:

```sh
scripts/lab up --cloud "$CLOUD" --name "$LAB_NAME" --auto-approve \
  --var ttl_hours=4

scripts/lab deploy --cloud "$CLOUD" --name "$LAB_NAME"

export KUBECONFIG="ansible/artifacts/lab/$CLOUD/$LAB_NAME/kubeconfig"
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080
```

Keep the port-forward running in that terminal. In a second terminal from the repository root:

```sh
export CLOUD=aws
export LAB_NAME=hapi-smoke
export RUN_ID=smoke-aws-001
export PATIENTS=25
export SYNTHEA_SEED=12345
export FHIR_BASE_URL=http://localhost:8080/fhir

scripts/lab seed --patients "$PATIENTS" --seed "$SYNTHEA_SEED" --run "$RUN_ID"
scripts/lab benchmark --profile smoke --run "$RUN_ID"
scripts/lab report --run "$RUN_ID" --cloud "$CLOUD" --name "$LAB_NAME" --profile smoke
scripts/lab down --cloud "$CLOUD" --name "$LAB_NAME" --yes
```

If any command fails after `up`, still run:

```sh
scripts/lab down --cloud "$CLOUD" --name "$LAB_NAME" --yes
```

## Cloud Credentials

The wrapper delegates provider authentication to Terraform and the provider CLIs. Do not put secrets in `*.tfvars`, committed docs, or shell history.

AWS:

- Authenticate with `aws sso login`, environment variables, or an instance role that Terraform can use.
- Set `AWS_PROFILE` and `AWS_REGION` when your default profile is not the target account.
- The default region is `us-east-1`; override with `--var region=REGION`.

Azure:

- Authenticate with `az login`.
- Select the intended subscription with `az account set --subscription SUBSCRIPTION_ID`.
- The default region is `eastus`; override with `--var region=REGION`.

GCP:

- Authenticate with `gcloud auth application-default login` or an approved service account flow.
- Set the target project with `--var project_id=PROJECT_ID`; this variable is required.
- The default region and zone are `us-central1` and `us-central1-a`; override with `--var region=REGION --var zone=ZONE`.

## Provider Setup

The same lab wrapper drives all providers:

```sh
scripts/lab up --cloud aws|azure|gcp --name NAME [--auto-approve] [--var key=value]
scripts/lab deploy --cloud aws|azure|gcp --name NAME
```

Common Terraform overrides:

- `region`: provider region.
- `cluster_node_count`: initial Kubernetes node count.
- `cluster_min_nodes` and `cluster_max_nodes`: cluster autoscaler bounds.
- `node_size`: worker node size.
- `postgres_version`: PostgreSQL `16` or `17`.
- `db_sku`: managed PostgreSQL SKU.
- `ttl_hours`: expected lab lifetime tag or label for cleanup automation.

Provider-specific notes:

- AWS uses EKS and RDS PostgreSQL. Tags come from `--var tags='{...}'` when needed.
- Azure uses AKS and Azure Database for PostgreSQL Flexible Server. Tags come from `--var tags='{...}'` when needed.
- GCP uses GKE and Cloud SQL for PostgreSQL. Labels come from `--var labels='{...}'`; `project_id` is required.

## Cost Controls

Required controls:

- Use a short `ttl_hours` value for every `up` command.
- Use the smallest node count and DB SKU that can answer the benchmark question.
- Keep smoke runs small, such as `25` to `100` Synthea patients.
- Stop port-forwards and local test loops after the run.
- Run `scripts/lab down --cloud CLOUD --name NAME --yes` even after failed deploy, seed, benchmark, or report steps.

Before leaving the terminal, verify teardown:

```sh
scripts/lab down --cloud "$CLOUD" --name "$LAB_NAME" --yes
```

If `down` fails, go to the provider console and delete resources tagged or labeled with the lab name and TTL. The generated Terraform state and kubeconfig remain under ignored `ansible/artifacts/lab/` paths for troubleshooting, but they must not be committed.

## Benchmark Methodology

Use profiles in increasing order. Do not start with `load` or `stress` on a new lab.

| Profile | Purpose | Typical use |
| --- | --- | --- |
| `smoke` | Prove deployment, seed data, endpoint reachability, and report generation. | First run, PR validation, workstation validation. |
| `baseline` | Establish normal latency, throughput, error rate, pod restart, and Hikari headroom signals. | Compare provider sizes or chart changes. |
| `load` | Explore expected traffic levels with ramping concurrency. | Capacity planning after a clean baseline. |
| `stress` | Push saturation and failure-mode behavior. | Controlled experiments only; expect higher cost and possible errors. |

The k6 workloads use standard FHIR R4 HTTP APIs: `GET /metadata`, Patient read/search, Observation search by patient/date, Encounter search, Condition search, mixed read/search traffic, and optional HL7 Bulk Data `$export` when `BULK_EXPORT_ENABLED=true`. They intentionally avoid non-standard HAPI-only APIs.

For `baseline`, expose Prometheus and pass `PROMETHEUS_BASE_URL` so k6 can evaluate pod restart and Hikari connection headroom gates:

```sh
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090
PROMETHEUS_BASE_URL=http://localhost:9090 \
FHIR_BASE_URL=http://localhost:8080/fhir \
scripts/lab benchmark --profile baseline --run "$RUN_ID"
```

## Synthea Usage

The seed stage generates deterministic synthetic FHIR R4 transaction bundles:

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
scripts/lab seed --patients 100 --seed 12345 --run "$RUN_ID"
```

Use the same `patients` and `seed` values when comparing infrastructure or chart changes. The loader records dataset metadata in `ansible/artifacts/lab/runs/RUN_ID/dataset-metadata.json`, including generated resource counts, import duration, imported entries, HTTP status counts, and import errors.

Use `--generate-only` when you need to validate local Synthea generation without importing to HAPI FHIR:

```sh
scripts/lab seed --patients 100 --seed 12345 --run "$RUN_ID" --generate-only
```

## Results And Interpretation

`scripts/lab report` publishes ignored local results under `results/YYYYMMDD-HHMMSS-provider-profile/`.

Read these files first:

- `report.md`: human-readable summary for the run.
- `summary.csv`: machine-readable latency, throughput, error, operation mix, and environment summary.
- `environment.json`: cloud, region, node size, DB SKU, replicas, Hikari pool, chart/image pins, Synthea seed/population, and profile.
- `prometheus-snapshots.json`: Prometheus context when available, or k6 gate-rate context when snapshots were not captured.
- `raw/`: raw k6, FHIR operation, dataset, benchmark, deployment, and Prometheus artifacts.

Interpretation checklist:

- Confirm `environment.json` matches the provider, region, node size, DB SKU, chart pins, Synthea seed, and Synthea population you intended to test.
- Treat HTTP failure rate above `1%` as a failed baseline unless the profile is intentionally stressing the system.
- Compare p50, p95, and p99 latency together; a stable p50 with a poor p99 usually points to saturation, GC, database waits, or connection pressure.
- For baseline runs, confirm pod restart and Hikari headroom gates stayed healthy.
- Compare only runs with the same dataset size, seed, benchmark profile, chart pins, and similar cloud sizing.
- Keep raw artifacts for later analysis, but do not commit `results/`.

## Conformance Tools Versus Load Benchmarks

This lab answers performance questions: latency, throughput, operation mix, HTTP failures, pod restarts, and database connection headroom under generated workload.

FHIR conformance tools answer different questions: whether a server conforms to a base FHIR specification, implementation guide, authorization profile, or TestScript suite. Passing `smoke`, `baseline`, `load`, or `stress` does not prove FHIR conformance. Likewise, passing a conformance suite does not prove the deployment can handle production load.

Use both categories when needed:

- Use this lab for repeatable load and capacity experiments.
- Use Inferno or Touchstone for FHIR conformance and interoperability test evidence.
- Run conformance tests against a stable, appropriately seeded endpoint before or after load tests, not during load tests unless the experiment explicitly requires mixed traffic.

## References

- [Synthea](https://github.com/synthetichealth/synthea): synthetic patient population generator used by this lab for deterministic FHIR R4 seed data.
- [HL7 FHIR Bulk Data Access](https://hl7.org/fhir/uv/bulkdata/): standard for asynchronous large dataset export, used by the optional `$export` benchmark path when enabled.
- [Inferno Framework](https://inferno-framework.github.io/about/): open-source FHIR testing framework for conformance-oriented test kits.
- [Touchstone](https://touchstone.aegis.net/touchstone/userguide/html/introduction.html): AEGIS testing service for FHIR conformance and interoperability against published specifications, standards, profiles, and implementation guides.
