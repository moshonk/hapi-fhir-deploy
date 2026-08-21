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

For an end-to-end smoke benchmark path, cloud credential checklist, methodology, result interpretation guidance, and safety teardown procedure, use [benchmark-lab-runbook.md](benchmark-lab-runbook.md).

## Cost Safety

Run `scripts/lab down --cloud aws|azure|gcp --name NAME --yes` as soon as a benchmark run is complete. The `down` command runs Terraform destroy for the named lab workspace, and the wrapper asks for confirmation unless `--yes` is supplied.

Generated Terraform outputs, kubeconfigs, Synthea datasets, and benchmark run artifacts are written under ignored `ansible/artifacts/lab/` paths by default. Published benchmark reports are written under ignored `results/` paths by default. These local files can contain kubeconfig, database secret material, endpoint names, or benchmark data, so do not move them into tracked documentation or source files.

## Commands

### Provision

```sh
scripts/lab up --cloud aws|azure|gcp --name NAME [--auto-approve] [--var key=value]
```

Before touching Terraform, `up` checks that the tools the *whole* lab lifecycle needs are present -- not just what `up` itself calls, but `deploy`'s (`helm`, `kubectl`, `ansible-playbook`/`ansible-galaxy`, and on GCP `gke-gcloud-auth-plugin`), plus `seed`/`benchmark`'s (`ruby`, `k6`, `java`). This reports every missing tool at once, with install links, instead of failing one step at a time -- possibly after a GKE/EKS/AKS cluster has already been created and billing. Set `LAB_SKIP_PREFLIGHT=true` to skip it (the check still runs but only warns under `--dry-run`, regardless of this setting).

`up` runs Terraform in `infra/terraform/<cloud>`, selects or creates a Terraform workspace named after the lab, applies `lab_name=NAME`, then saves ignored outputs to:

- `ansible/artifacts/lab/<cloud>/<name>/terraform-output.json`
- `ansible/artifacts/lab/<cloud>/<name>/kubeconfig`

Use repeated `--var key=value` flags for provider settings such as region, node size, cluster size, DB SKU, TTL, and tags.

If `apply` fails because a resource already exists in the cloud but isn't yet tracked in this workspace's Terraform state (e.g. left behind by a prior interrupted `up`, or a `down` that didn't fully complete), `up` imports the existing resource and retries instead of failing outright, logging each reuse. Set `LAB_TF_AUTO_IMPORT=false` to restore the old strict-fail behavior. A full apply log is written to `ansible/artifacts/lab/<cloud>/<name>/terraform-apply.log` on every run.

For GCP, `up` also checks two resources proactively before every apply, since their failure modes don't surface a parseable `'ID' already exists` error: the private-services-access peering connection, and the Cloud SQL instance (`google_sql_database_instance.postgres` can finish creating successfully on the API side while `terraform apply` still fails with an opaque, message-less `Error waiting for Create Instance:` -- known `terraform-provider-google` flakiness on long-running Cloud SQL operations). Both checks query the live GCP API directly and import the resource into state if it's already there, so a re-run doesn't hit a real `already exists` conflict next time.

### Doctor (prerequisite check)

```sh
scripts/lab doctor --cloud aws|azure|gcp [--format text|json]
```

Runs the exact same toolchain checks as `up`'s preflight (above) -- Terraform,
Helm, kubectl, the Ansible venv binaries plus whether the pinned collections
from `ansible/requirements.yml` are actually installed (not just that
`ansible-galaxy` is on `PATH`), Ruby, k6, Java, and on GCP `gcloud`,
`gke-gcloud-auth-plugin`, and an active Application Default Credentials
token -- but read-only: it never provisions anything, always exits `0`, and
ignores `LAB_SKIP_PREFLIGHT`. Both commands share one check implementation
(`collect_prerequisite_checks` in `scripts/lab`) so they can't silently
drift apart.

Default output is a human-readable `[pass|warn|fail] label detail` line per
check. `--format json` emits a JSON array of `{id, label, status, detail}`
records instead, for scripting or for the Lab Control UI's prerequisite
panel (`specs/009-lab-control-ui`) to consume directly.

Use this when you just want to know "can I even start" without attempting
`up`, or to confirm a missing prerequisite is fixed before retrying it.

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

#### Native (non-Synthea) generator mode

Set `LAB_SEED_GENERATOR_MODE=native` to skip Synthea entirely and generate a
deterministic eCHIS household/CHW dataset via `scripts/echis_seed.rb`
directly. Use `--households`/`--individuals-per-household` instead of
`--patients`:

```sh
LAB_SEED_GENERATOR_MODE=native FHIR_BASE_URL=https://example/fhir \
scripts/lab seed --households 33333 --individuals-per-household 3 --seed 12345 --run echis-t2
```

Add `--in-cluster --parallel-shards N` to distribute generation across `N`
Kubernetes Job pods (`manifests/seed-job/echis-seed-job.yaml`) instead of one
local process — see `docs/echis-benchmark-tiers.md` and
`manifests/seed-job/README.md` for the ConfigMap/PVC prerequisites and the
`scripts/merge_seed_shards.rb` follow-up step this leaves for the operator.

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

#### Live k6 metrics in Grafana

On by default, regardless of which tier/profile is running or what
triggered it (direct CLI or the Lab Control UI): `benchmark` resolves a
kubeconfig (`LAB_KUBECONFIG` > ambient `KUBECONFIG` > `--cloud`/`--name`'s
generated one -- the Lab Control UI's `benchmark` action always sets
`KUBECONFIG`), opens a localhost-only `kubectl port-forward` into
Prometheus's remote-write endpoint on an OS-chosen ephemeral port (never
colliding with an already-running `expose-prometheus`), and adds `-o
experimental-prometheus-rw` to the k6 invocation -- streaming live VU
count/request rate/latency/failure-rate into Prometheus as the run
progresses, alongside the always-written `k6-raw.jsonl`, not instead of it.
The port-forward is torn down again once the run ends (success or failure).

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
KUBECONFIG=/path/to/kubeconfig \
scripts/lab benchmark --profile load --run load-1 --echis-tier T2
```

No kubeconfig required to trigger this -- if none resolves (e.g. running
`benchmark` without `--cloud`/`--name` or `KUBECONFIG` at all, or the
target Prometheus isn't reachable), `benchmark` logs why and runs without
live metrics instead of failing the run. Set `K6_PROMETHEUS_RW_SERVER_URL`
yourself to point at a different Prometheus instead (an explicit value
always wins over the auto-detected one), or pass
`--no-prometheus-remote-write` (`NO_PROMETHEUS_RW=true`) to opt out
entirely.

Requires the target Prometheus to have its remote-write receiver enabled
(`enableRemoteWriteReceiver`, `ansible/group_vars/lab.yml`'s
`enable_prometheus_remote_write`, default `true` -- a Prometheus restart on
first enable). The [Grafana Labs' official "k6
Prometheus"](https://grafana.com/grafana/dashboards/19665-k6-prometheus/)
dashboard (ID `19665`) is provisioned automatically -- see
`manifests/grafana-dashboards/k6-load-testing-configmap.yaml`, applied by
`ansible/playbooks/00-install-addons.yml` whenever `install_grafana` is
true -- so it's present in Grafana as soon as the lab is up, not only after
a manual dashboard import. HAPI FHIR's own server-side metrics (HTTP
latency, JVM, Hikari pool) are scraped into the same Prometheus
independently of any of this, so they're visible in Grafana during any run
regardless.

`--in-cluster` benchmarks stream live metrics the same way, but simpler:
each k6 shard pod already runs inside the cluster, so
`cmd_benchmark_in_cluster` points it straight at Prometheus's cluster-DNS
Service name (`http://<svc>.<namespace>.svc.cluster.local:9090/api/v1/write`)
-- no port-forward involved at all, and (unlike the local-mode opt-out
above) there's currently no `--no-prometheus-remote-write` equivalent for
`--in-cluster`, since applying the shard Job manifest already hard-requires
a working kubectl/kubeconfig either way.

#### In-cluster benchmarks with more than 1 shard

`benchmark --in-cluster --parallel-shards N` approximates a larger tier by
running `benchmarks/k6/echis_load_100.js`'s own ~100-VU target across N
Kubernetes Job shard pods simultaneously (`manifests/k6-shard-job/README.md`'s
sharding strategy -- e.g. `--parallel-shards 10` approximates T3's ~1,000
aggregate VUs). Every shard pod mounts the same `/shard-output` PVC at
once, which needs `ReadWriteMany` -- something plain GCE PD storage
classes (`ReadWriteOnce` only) can't provide. Run `scripts/lab
provision-shard-storage --cloud gcp --name NAME --var project_id=P` once
per lab first: it provisions a GCP Filestore instance (BASIC_HDD tier,
~$0.20/GB-month billed hourly, a few cents for a typical lab session) via a
*targeted* Terraform apply (touches no other resource in the lab) and
applies a static PV/PVC pointing at it. It also writes
`ansible/artifacts/lab/gcp/NAME/shard-storage.auto.tfvars`, persisting
`enable_shard_output_rwx=true` for this lab so a later plain `up` re-run
picks it up and doesn't tear the Filestore instance back down (its
`default = false` in `infra/terraform/gcp/variables.tf` would otherwise
mean an untargeted apply — with no reason to think this lab wants it —
destroys it; this happened live once before this file was added).
`--parallel-shards 1` needs none of this -- only one pod ever mounts the
PVC, so Kubernetes provisions a `ReadWriteOnce` volume from the default
StorageClass on its own.
`benchmark --in-cluster` with `--parallel-shards N > 1` fails fast with a
clear message if this hasn't been provisioned yet, rather than hanging for
up to 2 hours on an unschedulable shard pod. Torn down automatically by
`down`'s `terraform destroy` (same Terraform module/workspace as
everything else in the lab) -- no separate cleanup step.

#### eCHIS progressive tiers

Use `K6_SCRIPT=benchmarks/k6/echis_load_100.js` (or another `echis_load_*.js`
tier script) with `--echis-tier T2|T3|T4|T5` to run a progressive eCHIS tier
locally, under the sequencing/pooled-tier-attestation guard described in
`docs/echis-benchmark-tiers.md`.

Add `--in-cluster --parallel-shards N` to distribute k6 load generation
across `N` Kubernetes Job pods (`manifests/k6-shard-job/echis-k6-shard-job.yaml`)
instead of one local k6 process. **`--in-cluster` does not honor `K6_SCRIPT`**
— it always targets `benchmarks/k6/echis_load_100.js`, matching the
manifest's own static ConfigMap item mapping (`scripts/lab` errors out if
`K6_SCRIPT` is set to anything else, rather than silently ignoring it).
Retargeting an in-cluster run at a different tier script requires updating
the manifest's `args`/ConfigMap `items` and this command together — see
`manifests/k6-shard-job/README.md` for the sharding strategy (aggregate
concurrency is the target script's own VU count multiplied by shard count),
the ConfigMap/PVC prerequisites, and the `scripts/merge_k6_shards.rb`
follow-up step this leaves for the operator.

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

On GCP, `down` also runs `unexpose-fhir`'s, `unexpose-prometheus`'s, and `unexpose-grafana`'s cleanup first (see below) so a forgotten `expose-*` doesn't outlive the lab. That cleanup is best-effort: a failure there logs a warning but does not block the actual Terraform destroy.

### Public exposure (GCP only)

```sh
scripts/lab expose-fhir --cloud gcp --name NAME --var project_id=P [--port 8080] [--source-ranges CIDR[,CIDR...]]
scripts/lab unexpose-fhir --cloud gcp --name NAME --var project_id=P
scripts/lab expose-prometheus --cloud gcp --name NAME --var project_id=P [--port 9090] [--source-ranges CIDR[,CIDR...]]
scripts/lab unexpose-prometheus --cloud gcp --name NAME --var project_id=P
scripts/lab expose-grafana --cloud gcp --name NAME --var project_id=P [--port 3001] [--source-ranges CIDR[,CIDR...]]
scripts/lab unexpose-grafana --cloud gcp --name NAME --var project_id=P
scripts/lab exposures --cloud gcp --name NAME [--format text|json]
```

`kubectl port-forward` (Step 7 of the [GCP T3 runbook](gcp-echis-t3-lab-runbook.md), and the ad hoc `kubectl -n monitoring port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090` used to reach Prometheus) only binds `127.0.0.1`, reachable via an SSH/VS Code Remote tunnel. `expose-fhir`/`expose-prometheus`/`expose-grafana` are for the case where you're driving `scripts/lab` from a GCE VM directly and want the service reachable at that VM's own public IP without a tunnel: each opens a GCP firewall rule for `tcp:PORT` and starts a `0.0.0.0`-bound `kubectl port-forward` in the background, then prints the reachable URL (`http://EXTERNAL_IP:PORT/fhir` for FHIR, `http://EXTERNAL_IP:PORT` for Prometheus's/Grafana's UI). They're independent -- exposing one doesn't affect the others, and each tracks its own state/firewall rule, so you can run any subset of them. Grafana's actual Service port is `80`, but `--port` defaults to `3001` rather than `80` -- binding a port below 1024 needs root, which `scripts/lab` normally doesn't run as. Not Grafana's own conventional `3000` either: when `scripts/lab` runs inside the Lab Control UI's `app` container (`network_mode: host`, see `lab-control-ui/docker-compose.yml`), the UI backend itself already owns host port `3000` (`LAB_UI_PORT`), so `expose-grafana` would otherwise fail with "address already in use" every time it's triggered from the UI. The port-forward still correctly targets the Service's real port `80` internally regardless of the external `--port` chosen.

**FHIR and Prometheus have no authentication in front of them in this lab; Grafana does.** kube-prometheus-stack's bundled Grafana (installed when `install_grafana: true`, the `00-install-addons.yml` default) requires login -- user `admin`, password from `kubectl -n monitoring get secret prometheus-grafana -o jsonpath='{.data.admin-password}' | base64 -d`. Regardless, `--source-ranges` defaults to `0.0.0.0/0` — the whole internet — for all three. This is deliberate, not an oversight: `scripts/lab` normally runs *on* the GCE VM itself (via SSH/VS Code Remote), so auto-detecting "the caller's IP" from that same VM would detect the VM's own address, not the browser/laptop actually trying to reach it — a restrictive default that doesn't match the real client just breaks access silently (this is exactly what happened before this default changed). Pass `--source-ranges CIDR` (e.g. your own IP as a `/32`) if you want it restricted instead. Whatever range you choose can read (and, for FHIR, write) for as long as the exposure is up.

State (the firewall rule name, port, port-forward PID, project, and the computed reachable URL) is tracked per service in `ansible/artifacts/lab/gcp/<name>/{fhir,prometheus,grafana}-public-exposure.env`. `unexpose-fhir`/`unexpose-prometheus`/`unexpose-grafana` read theirs back to kill the port-forward and delete the firewall rule, and are safe to run even when nothing is currently exposed (no-op). Re-running an `expose-*` command for the same lab replaces its own previous exposure rather than leaking an orphaned port-forward process. Requires `KUBECONFIG` to be set, same as `pause-autoscaling`/`resume-autoscaling`. `HAPI_NAMESPACE`/`HAPI_SERVICE_NAME`, `PROMETHEUS_NAMESPACE`/`PROMETHEUS_SERVICE_NAME`, and `GRAFANA_NAMESPACE`/`GRAFANA_SERVICE_NAME` override the respective namespace/Service name if your deployment doesn't match the defaults (`fhir`/`hapi-fhir-hapi-fhir-jpaserver`, `monitoring`/`prometheus-kube-prometheus-prometheus`, and `monitoring`/`prometheus-grafana`).

**Auto-reconnect**: each `expose-*` starts a background watchdog alongside its port-forward (checked every `LAB_PORTFORWARD_WATCHDOG_INTERVAL` seconds, default `15`). `kubectl port-forward` has no built-in reconnect, and its long-lived tunnel through the Kubernetes API server gets dropped periodically regardless of pod health -- confirmed live: two drops during an 80-minute T3 benchmark, both `error: lost connection to pod` with every backing pod still `Running`, zero restarts, no scale-down event anywhere near either timestamp. Once dropped, the watchdog reconnects on the exact same port and updates the tracked PID (`ansible/artifacts/lab/gcp/<name>/<service>-public-portforward.pid`, read live by `exposures`/`unexpose-*`, not the state file's own `PORT_FORWARD_PID=` field, which is informational only from expose-* time). `unexpose-*` stops the watchdog before killing the port-forward it tracks, so closing an exposure is still final. `benchmark`'s own automatic Prometheus remote-write port-forward (above) gets the same watchdog, scoped to that run's lifetime.

`scripts/lab exposures --cloud gcp --name NAME` is a read-only status query over that same state: for each of fhir/prometheus/grafana, whether it's currently exposed (verifying the tracked port-forward process is actually still alive, not just that a state file exists -- a stale file left behind by e.g. a host reboot without a matching `unexpose-*` reports `exposed: false`), and if so, its URL/port/firewall rule name. Grafana's record additionally re-fetches the admin password live via `kubectl` on every call (never written to disk by this command) when exposed, or a human-readable reason it couldn't. Never mutates anything -- it's the same status this section's prose describes, just machine-readable. `--format json` is what the Lab Control UI (specs/009-lab-control-ui) polls to show a link (and credentials, if applicable) once a service is exposed.

### Autoscaling (bulk data-load window)

```sh
scripts/lab pause-autoscaling --replicas N
scripts/lab resume-autoscaling
```

Convenience wrappers around KEDA's `autoscaling.keda.sh/paused-replicas` annotation on the `hapi-fhir-jpaserver` ScaledObject (the same object name whether the native or pooled connection tier is applied), per `docs/autoscaling.md`'s "Bulk Data-Load Window Procedure". `pause-autoscaling --replicas N` pins the replica count for a one-time bulk data-load window — do the connection-budget arithmetic in `docs/autoscaling.md` before picking `N`. `resume-autoscaling` removes the pin so KEDA resumes live-metric-driven autoscaling within its normal `minReplicaCount`/`maxReplicaCount`. Apply `pause-autoscaling` before `scripts/lab seed` and `resume-autoscaling` before `scripts/lab benchmark`, so serving traffic is always measured against the committed ceiling, not the temporarily-widened bulk-load one. Uses `KUBECTL_BIN` (defaults to `kubectl`) and `HAPI_NAMESPACE` (defaults to `fhir`).
