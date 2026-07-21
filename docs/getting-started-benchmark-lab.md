# Getting Started With The Benchmark Lab

This guide is the first-run path for provisioning an ephemeral HAPI FHIR lab, deploying the Helm baseline, loading deterministic Synthea data, running k6 benchmarks, publishing local results, and destroying the cloud resources. Use [benchmark-lab-runbook.md](benchmark-lab-runbook.md) for deeper methodology and [lab-cli.md](lab-cli.md) for full command reference.

The lab creates billable cloud resources. Always finish with `scripts/lab down --cloud CLOUD --name LAB_NAME --yes`, including after failed deploy, seed, benchmark, or report steps.

## What The Helper Does

The `scripts/lab` helper wraps the full workflow:

| Stage | Command | What it runs |
| --- | --- | --- |
| Provision | `scripts/lab up` | Terraform in `infra/terraform/aws`, `infra/terraform/azure`, or `infra/terraform/gcp`. |
| Deploy | `scripts/lab deploy` | Ansible `ansible/playbooks/lab.yml`, Helm chart install, add-ons, runtime Secret creation, rollout patch, readiness waits, and metadata collection. |
| Seed | `scripts/lab seed` | Synthea data generation plus `scripts/synthea_loader.rb` transaction-bundle import. |
| Benchmark | `scripts/lab benchmark` | k6 profile from `benchmarks/k6/smoke.js`, `baseline.js`, `load.js`, or `stress.js`. |
| Report | `scripts/lab report` | `scripts/publish_results.rb` publication to ignored `results/YYYYMMDD-HHMMSS-provider-profile/`. |
| Destroy | `scripts/lab down` | Terraform destroy for the selected workspace and lab name. |

Generated Terraform outputs, kubeconfigs, Synthea bundles, benchmark raw data, and reports stay under ignored `ansible/artifacts/lab/` and `results/` paths. Do not copy kubeconfigs, Terraform output JSON, runtime values, database passwords, or raw generated artifacts into tracked files.

## Prerequisites

Install these locally:

- Terraform `>= 1.9.0, < 2.0.0`.
- Python `3`.
- Helm `3.x`.
- `kubectl`.
- Ruby.
- k6.
- Java `17` or newer.
- Synthea, available as `SYNTHEA_CMD`, a `synthea` executable on `PATH`, or `$SYNTHEA_HOME/run_synthea`.
- Cloud credentials for one provider.

Install the pinned Ansible dependencies from the repository root:

```sh
python3 -m pip install -r ansible/requirements.txt
ansible-galaxy collection install -r ansible/requirements.yml
```

Authenticate to one provider before running `up`:

- AWS: run `aws sso login` or provide standard AWS environment credentials. Set `AWS_PROFILE` and `AWS_REGION` when needed.
- Azure: run `az login`, then `az account set --subscription SUBSCRIPTION_ID` when your default subscription is not the target.
- GCP: run `gcloud auth application-default login` or use an approved service account flow. GCP also requires `--var project_id=PROJECT_ID`.

## Choose Run Settings

Use a short, unique lab name. It must match `^[a-z][a-z0-9-]{2,31}$` because the helper passes it to Terraform as `lab_name`.

```sh
export CLOUD=aws
export LAB_NAME=hapi-smoke
export RUN_ID=smoke-aws-001
export PATIENTS=25
export SYNTHEA_SEED=12345
```

For Azure or GCP, change `CLOUD` and the run ID:

```sh
export CLOUD=azure
export RUN_ID=smoke-azure-001
```

```sh
export CLOUD=gcp
export RUN_ID=smoke-gcp-001
```

## Provision The Lab

Start with a small smoke lab and a short TTL tag or label:

```sh
scripts/lab up --cloud "$CLOUD" --name "$LAB_NAME" --auto-approve \
  --var ttl_hours=4
```

The helper initializes Terraform, selects or creates a workspace named after `LAB_NAME`, applies `lab_name=LAB_NAME`, and writes ignored local outputs to:

- `ansible/artifacts/lab/$CLOUD/$LAB_NAME/terraform-output.json`
- `ansible/artifacts/lab/$CLOUD/$LAB_NAME/kubeconfig`

Common sizing overrides are `region`, `cluster_node_count`, `cluster_min_nodes`, `cluster_max_nodes`, `node_size`, `postgres_version`, `db_sku`, and `ttl_hours`.

Provider examples:

```sh
scripts/lab up --cloud aws --name "$LAB_NAME" --auto-approve \
  --var region=us-east-1 \
  --var node_size=m6i.large \
  --var db_sku=db.m6i.large \
  --var ttl_hours=4
```

```sh
scripts/lab up --cloud azure --name "$LAB_NAME" --auto-approve \
  --var region=eastus \
  --var node_size=Standard_D4s_v5 \
  --var db_sku=GP_Standard_D2ds_v5 \
  --var ttl_hours=4
```

```sh
scripts/lab up --cloud gcp --name "$LAB_NAME" --auto-approve \
  --var project_id=PROJECT_ID \
  --var region=us-central1 \
  --var zone=us-central1-a \
  --var node_size=e2-standard-4 \
  --var db_sku=db-custom-2-7680 \
  --var ttl_hours=4
```

## Deploy HAPI FHIR

Deploy the baseline to the new cluster:

```sh
scripts/lab deploy --cloud "$CLOUD" --name "$LAB_NAME"
```

The deploy stage uses the generated kubeconfig and Terraform output by default. It installs pinned Prometheus Operator, Metrics Server, and KEDA add-ons, creates the `fhir/hapi-fhir-postgres` runtime Secret from Terraform outputs, deploys the wrapper chart, applies the runtime rollout patch, applies autoscaling, waits for readiness, and writes deployment metadata.

Verify the rollout:

```sh
export KUBECONFIG="ansible/artifacts/lab/$CLOUD/$LAB_NAME/kubeconfig"
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir get pods -l app.kubernetes.io/instance=hapi-fhir
kubectl -n fhir get svc hapi-fhir-hapi-fhir-jpaserver
```

If deployment fails, inspect datasource and PostgreSQL connection errors first:

```sh
kubectl -n fhir logs deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir describe pod -l app.kubernetes.io/instance=hapi-fhir
```

H2 fallback is not acceptable for this baseline; the deployment should use the managed PostgreSQL instance from Terraform outputs.

## Expose The FHIR Endpoint

Run this in a dedicated terminal and keep it open during seed and benchmark commands:

Assuming the earlier `CLOUD` and `LAB_NAME` exports are still set:

```sh
export KUBECONFIG="ansible/artifacts/lab/$CLOUD/$LAB_NAME/kubeconfig"
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080
```

In a second terminal from the repository root:

```sh
export FHIR_BASE_URL=http://localhost:8080/fhir
curl -fsS "$FHIR_BASE_URL/metadata" >/dev/null
```

## Seed Deterministic Data

Generate and import a small Synthea population for the first smoke run:

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
scripts/lab seed --patients "$PATIENTS" --seed "$SYNTHEA_SEED" --run "$RUN_ID"
```

The seed stage writes generated FHIR bundles under `ansible/artifacts/lab/runs/$RUN_ID/synthea/` and dataset metadata to `ansible/artifacts/lab/runs/$RUN_ID/dataset-metadata.json`.

Use `--generate-only` to validate Synthea locally without importing:

```sh
scripts/lab seed --patients "$PATIENTS" --seed "$SYNTHEA_SEED" --run "$RUN_ID" --generate-only
```

Keep `PATIENTS`, `SYNTHEA_SEED`, cloud sizing, chart pins, and benchmark profile consistent when comparing runs.

## Run A Smoke Benchmark

Start with `smoke` to validate the end-to-end path:

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
scripts/lab benchmark --profile smoke --run "$RUN_ID"
```

The benchmark stage writes k6 and FHIR summary artifacts to `ansible/artifacts/lab/runs/$RUN_ID/`:

- `k6-summary.json`
- `k6-fhir-summary.json`
- `k6-raw.jsonl`
- `benchmark-metadata.json`

After a clean smoke run, move to profiles in this order:

| Profile | Use it for |
| --- | --- |
| `baseline` | Normal latency, throughput, HTTP failure, pod restart, and Hikari headroom checks. |
| `load` | Expected traffic exploration after a clean baseline. |
| `stress` | Saturation experiments where higher errors and cost are expected. |

For `baseline`, expose Prometheus in another terminal and pass `PROMETHEUS_BASE_URL`:

```sh
kubectl -n monitoring port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090
```

```sh
PROMETHEUS_BASE_URL=http://localhost:9090 \
FHIR_BASE_URL=http://localhost:8080/fhir \
scripts/lab benchmark --profile baseline --run "$RUN_ID"
```

If your Prometheus service name differs, find it with:

```sh
kubectl -n monitoring get svc
```

## Publish Results

Publish a local report:

```sh
scripts/lab report --run "$RUN_ID" --cloud "$CLOUD" --name "$LAB_NAME" --profile smoke
```

The report stage creates an ignored result directory under `results/`. Read these first:

- `report.md`: human-readable run summary.
- `summary.csv`: latency, throughput, failure rate, operation mix, and environment fields.
- `environment.json`: provider, region, node size, DB SKU, replicas, Hikari pool, chart pins, Synthea population and seed, and profile.
- `raw/`: copied raw artifacts for later analysis.

Before comparing two results, confirm both runs used the same profile, Synthea population, Synthea seed, chart pins, and similar cloud sizing.

## Destroy The Lab

Destroy the resources as soon as the benchmark or failed experiment is complete:

```sh
scripts/lab down --cloud "$CLOUD" --name "$LAB_NAME" --yes
```

Run `down` again before leaving the terminal if any earlier step failed. If Terraform destroy fails, use the provider console to remove resources tagged or labeled with the lab name and TTL, then keep the ignored local artifacts only for troubleshooting.

## Troubleshooting

Missing Terraform output or kubeconfig:

```sh
scripts/lab up --cloud "$CLOUD" --name "$LAB_NAME" --auto-approve --var ttl_hours=4
```

Synthea not found:

```sh
export SYNTHEA_CMD=/path/to/synthea-or-run_synthea
```

k6 not found:

```sh
export K6_BIN=/path/to/k6
```

Need to use a specific kubeconfig for deploy:

```sh
export LAB_KUBECONFIG=/path/to/kubeconfig
scripts/lab deploy --cloud "$CLOUD" --name "$LAB_NAME"
```

Need to inspect wrapper behavior before running it:

```sh
scripts/lab --help
```
