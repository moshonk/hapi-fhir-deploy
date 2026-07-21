# Lab Utility CLI

The `scripts/lab` wrapper coordinates the ephemeral benchmark workflow:

```sh
scripts/lab up --cloud aws --name hapi-bench --auto-approve
scripts/lab deploy --cloud aws --name hapi-bench
FHIR_BASE_URL=http://localhost:8080/fhir scripts/lab seed --patients 1000 --seed 12345 --run smoke-aws
FHIR_BASE_URL=http://localhost:8080/fhir scripts/lab benchmark --profile smoke --run smoke-aws
scripts/lab report --run smoke-aws
scripts/lab down --cloud aws --name hapi-bench --yes
```

## Cost Safety

Run `scripts/lab down --cloud aws|azure|gcp --name NAME --yes` as soon as a benchmark run is complete. The `down` command runs Terraform destroy for the named lab workspace, and the wrapper asks for confirmation unless `--yes` is supplied.

Generated Terraform outputs, kubeconfigs, Synthea datasets, and benchmark run artifacts are written under ignored `ansible/artifacts/lab/` paths by default. Published benchmark reports are written under ignored `results/` paths by default. These local files can contain kubeconfig, database secret material, endpoint names, or benchmark data, so do not move them into tracked documentation or source files.

## Commands

### Provision

```sh
scripts/lab up --cloud aws|azure|gcp --name NAME [--auto-approve] [--var key=value]
```

`up` runs Terraform in `infra/terraform/<cloud>`, selects or creates a Terraform workspace named after the lab, applies `lab_name=NAME`, then saves ignored outputs to:

- `ansible/artifacts/lab/<cloud>/<name>/terraform-output.json`
- `ansible/artifacts/lab/<cloud>/<name>/kubeconfig`

Use repeated `--var key=value` flags for provider settings such as region, node size, cluster size, DB SKU, TTL, and tags.

### Deploy

```sh
scripts/lab deploy --cloud aws|azure|gcp --name NAME [--extra-vars key=value]
```

`deploy` installs pinned Ansible collections into `.ansible/collections`, exports the generated kubeconfig and Terraform output file, and runs `ansible/playbooks/lab.yml`. The playbook installs add-ons, creates the runtime PostgreSQL Secret, deploys the Helm chart, waits for readiness, and collects deployment metadata.

By default, `deploy` uses `ansible/artifacts/lab/<cloud>/<name>/kubeconfig`. Set `LAB_KUBECONFIG=/path/to/kubeconfig` when you need an explicit override; this avoids accidentally treating an ambient colon-separated `KUBECONFIG` list as a single file.

### Seed

```sh
FHIR_BASE_URL=https://example/fhir scripts/lab seed --patients N --seed S [--run RUN_ID]
```

`seed` calls Synthea through `SYNTHEA_CMD`, a `synthea` executable on `PATH`, or `$SYNTHEA_HOME/run_synthea`. It applies `benchmarks/synthea/synthea.properties` by default and passes `patients`, `seed`, transaction-bundle export settings, and the ignored output directory at runtime.

After generation, `seed` calls `scripts/synthea_loader.rb` by default to POST FHIR R4 JSON transaction bundles to `FHIR_BASE_URL`. The loader writes `dataset-metadata.json` below `ansible/artifacts/lab/runs/<run-id>/` with the population size, seed, transaction bundle count, generated FHIR resource counts, import duration, HTTP/FHIR response status counts, imported entry count, and import errors.

Run IDs may contain only letters, numbers, dots, underscores, and hyphens.

Use `--generate-only` when you want to create and count the deterministic dataset without importing it:

```sh
scripts/lab seed --patients 1000 --seed 12345 --run baseline-aws --generate-only
```

Set `LAB_SEED_LOADER_CMD` to replace the default loader with another command that accepts the same loader CLI flags.

### Benchmark

```sh
FHIR_BASE_URL=https://example/fhir scripts/lab benchmark --profile smoke|baseline|load|stress --run RUN_ID
```

`benchmark` calls k6 and writes `k6-summary.json`, `k6-fhir-summary.json`, `k6-raw.jsonl`, and `benchmark-metadata.json` to the run directory. By default it uses `benchmarks/k6/<profile>.js`; set `K6_SCRIPT` to use an external k6 script.

`k6-fhir-summary.json` reports p50, p95, and p99 HTTP latency, request throughput, HTTP failure rate, FHIR operation mix, and baseline gate rates.

Committed profiles are:

- `smoke`: short single-VU validation of FHIR reachability and operation shape.
- `baseline`: steady workload with health, HTTP error, pod restart, and Hikari headroom gates.
- `load`: ramping workload for expected load exploration.
- `stress`: higher ramping workload for saturation and failure-mode exploration.

The workload uses standard FHIR R4 HTTP APIs: `GET /metadata`, `Patient` read/search, `Observation` search by patient/date, `Encounter` search, `Condition` search, and optional HL7 Bulk Data `$export` when `BULK_EXPORT_ENABLED=true`. It does not call HAPI-only endpoints.

The baseline profile requires Prometheus for the pod-restart and Hikari gates:

```sh
FHIR_BASE_URL=https://example/fhir \
PROMETHEUS_BASE_URL=http://localhost:9090 \
scripts/lab benchmark --profile baseline --run baseline-aws
```

Defaults assume namespace `fhir`, HAPI pod names matching `hapi-fhir-hapi-fhir-jpaserver-.*`, Hikari pool size `10`, two replicas, and maximum Hikari utilization `0.8`. Override with `HAPI_NAMESPACE`, `HAPI_POD_REGEX`, `HIKARI_MAX_POOL_SIZE`, `HAPI_REPLICAS`, `HIKARI_MAX_UTILIZATION`, `POD_RESTARTS_QUERY`, `HIKARI_ACTIVE_QUERY`, or `HIKARI_MAX_QUERY` when the target environment differs.

### Report

```sh
scripts/lab report --run RUN_ID [--cloud aws|azure|gcp] [--name NAME] [--profile smoke|baseline|load|stress]
```

`report` publishes a result directory named `results/YYYYMMDD-HHMMSS-provider-profile/` by default. Pass `--cloud`, `--name`, and `--profile` when available so the report can include provider context and safely derive non-sensitive fields from `ansible/artifacts/lab/<cloud>/<name>/terraform-output.json`.

Each published result directory contains:

- `raw/`: copied raw benchmark artifacts such as k6 summary JSON, k6 raw JSONL, FHIR operation summary, dataset metadata, benchmark metadata, deployment metadata, and Prometheus snapshots when present.
- `environment.json`: cloud, region, node size, DB SKU, replicas, Hikari pool, chart/image pins, Synthea population/seed, and benchmark profile metadata.
- `summary.csv`: latency, throughput, HTTP failure, operation mix, and environment summary values for later analysis.
- `report.md`: Markdown report readable without external services.
- `index.html`: optional static HTML view of the Markdown report.
- `prometheus-snapshots.json`: captured Prometheus snapshots when available, or k6 gate-rate context when snapshots were not captured.

Raw Terraform output JSON is not copied into `results/raw/` because it can include kubeconfig and database credentials. Set `LAB_RESULTS_DIR` to publish somewhere other than `results/`, or set `LAB_RESULT_PUBLISHER_CMD` to replace the default `scripts/publish_results.rb` publisher. `LAB_REPORT_CMD` remains available as a legacy override that receives `RUN_DIR REPORT_PATH`.

### Destroy

```sh
scripts/lab down --cloud aws|azure|gcp --name NAME --yes
```

`down` selects the Terraform workspace for `NAME` and runs destroy with the same `lab_name` value used by `up`. Run this command even after failed deploy, seed, or benchmark steps so cloud resources do not continue to accrue cost.
