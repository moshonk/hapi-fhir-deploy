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

Generated Terraform outputs, kubeconfigs, Synthea datasets, benchmark summaries, and reports are written under ignored `ansible/artifacts/lab/` paths by default. These local files can contain kubeconfig or database secret material, so do not move them into tracked documentation or source files.

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

`benchmark` calls k6 and writes `k6-summary.json` to the run directory. By default it expects `benchmarks/k6/<profile>.js`; set `K6_SCRIPT` to use a temporary or external k6 script until issue #23 adds the committed benchmark profiles.

### Report

```sh
scripts/lab report --run RUN_ID
```

`report` writes `report.md` in the run directory. Set `LAB_REPORT_CMD` to replace the fallback Markdown report generator with a richer implementation.

### Destroy

```sh
scripts/lab down --cloud aws|azure|gcp --name NAME --yes
```

`down` selects the Terraform workspace for `NAME` and runs destroy with the same `lab_name` value used by `up`. Run this command even after failed deploy, seed, or benchmark steps so cloud resources do not continue to accrue cost.
