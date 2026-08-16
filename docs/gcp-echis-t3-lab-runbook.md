# GCP Lab: eCHIS T3 Synthetic Data Benchmark

Step-by-step operator procedure for provisioning a GCP benchmark lab and running
the eCHIS **T3** tier (1,000 concurrent VUs / 333,333 households / 999,999
individuals / 5,839,996 total synthetic FHIR records) against it. This document
exists to let you run T3 on GCP by hand, repeatably, without re-deriving the
command sequence each time.

It composes three existing docs rather than replacing them:

- [getting-started-benchmark-lab.md](getting-started-benchmark-lab.md) — generic first-run lab path.
- [benchmark-lab-runbook.md](benchmark-lab-runbook.md) — full methodology, cost controls, bulk-load window.
- [echis-benchmark-tiers.md](echis-benchmark-tiers.md) — T2-T5 tier definitions and the `--echis-tier` sequencing guard.

Read those once; this doc only sequences the exact commands for GCP + T3.

**Status check before you start:** per `docs/echis-benchmark-tiers.md`'s
"Quickstart end-to-end status" section, T3 has never been executed against a
live cluster in this repository's history — every prior T3 attempt was blocked
on sandbox/cloud-access limits. Treat your run as the first real data point,
not a rerun of a validated shape: size conservatively, watch metrics live, and
be ready to adjust node/DB sizing rather than trusting the example shapes
below as pre-validated.

## 0. Cost and scope warning

This provisions real, billable GCP resources (GKE cluster, Cloud SQL instance)
and imports ~5.8M FHIR resources. Set a short `ttl_hours`, watch the run, and
tear down as soon as the benchmark and report are done — see Step 9. Do not
leave the lab running unattended.

## 1. Prerequisites

Install locally (same list as the generic guide, with install links and version-pinning notes: see [getting-started-benchmark-lab.md's Prerequisites](getting-started-benchmark-lab.md#prerequisites)):

- Terraform `>= 1.9.0, < 2.0.0`
- Python 3, Helm 3.x, `kubectl`, Ruby, k6, Java 17+
- `gcloud` CLI, plus [`gke-gcloud-auth-plugin`](https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl#install_plugin) for GKE kubeconfig auth (`kubectl`/`scripts/lab deploy` both need it against a GKE cluster; `gcloud components install` refuses on apt/snap-managed `gcloud` installs, use `sudo apt-get install google-cloud-cli-gke-gcloud-auth-plugin` there instead — see the generic guide's GCP bullet for the full apt-repo setup and for the "server has asked for the client to provide credentials" troubleshooting note)

Install pinned Ansible dependencies from the repo root. On externally-managed
Python installs (Debian/Ubuntu, PEP 668) `pip install` at the system level is
blocked, so use a project-local virtualenv:

```sh
python3 -m venv ansible/.venv
ansible/.venv/bin/python -m pip install --upgrade pip
ansible/.venv/bin/python -m pip install -r ansible/requirements.txt
ansible/.venv/bin/ansible-galaxy collection install -r ansible/requirements.yml
```

Use `ansible/.venv/bin/ansible-playbook` (or `source ansible/.venv/bin/activate`)
for subsequent Ansible commands in this runbook.

Note: T3 does **not** need Synthea and does **not** need spec 007's PgBouncer
pooled tier — the eCHIS native generator (`scripts/echis_seed.rb`) replaces
Synthea, and T3 is documented as "Runnable today, no spec 007 dependency" in
`docs/echis-benchmark-tiers.md`. That dependency only starts at T4.

## 2. Authenticate to GCP

```sh
gcloud auth application-default login
gcloud config set project PROJECT_ID
```

`project_id` is a required Terraform var for every `scripts/lab` GCP call
below — substitute your real project ID everywhere `PROJECT_ID` appears.

## 3. Export run variables

```sh
export CLOUD=gcp
export PROJECT_ID=PROJECT_ID          # your real GCP project ID
export LAB_NAME=hapi-echis-t3         # must match ^[a-z][a-z0-9-]{2,31}$
export REGION=us-central1
export ZONE=us-central1-a

# T3 dataset shape (from docs/echis-benchmark-tiers.md)
export HOUSEHOLDS=333333
export INDIVIDUALS_PER_HOUSEHOLD=3
export ECHIS_SEED=12345
```

## 4. Satisfy the T2-before-T3 sequencing guard

`scripts/lab benchmark --echis-tier T3` refuses to run unless T2 has already
completed successfully, tracked in `ansible/artifacts/lab/echis-tier-progress.json`
(a local file under this checkout, not scoped per lab name — if you've never
run T2 to completion from this machine, you must do so first). If you already
have a recorded successful T2 run, skip to Step 5.

Provision, deploy, and run T2 end-to-end first (small — ~33K households,
~584K records, 100 VUs):

```sh
scripts/lab up --cloud gcp --name hapi-echis-t2 --auto-approve \
  --var project_id="$PROJECT_ID" \
  --var region="$REGION" --var zone="$ZONE" \
  --var kubernetes_version=1.35.6-gke.1258000 \
  --var node_size=e2-standard-4 \
  --var db_edition=ENTERPRISE \
  --var db_sku=db-custom-2-7680 \
  --var ttl_hours=4

scripts/lab deploy --cloud gcp --name hapi-echis-t2

export KUBECONFIG="ansible/artifacts/lab/gcp/hapi-echis-t2/kubeconfig"
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080 &
PF_PID=$!

FHIR_BASE_URL=http://localhost:8080/fhir \
LAB_SEED_GENERATOR_MODE=native \
scripts/lab seed --households 33333 --individuals-per-household 3 \
  --seed "$ECHIS_SEED" --run echis-t2

FHIR_BASE_URL=http://localhost:8080/fhir \
K6_SCRIPT=benchmarks/k6/echis_load_100.js \
scripts/lab benchmark --profile load --echis-tier T2 --run echis-t2

scripts/lab report --run echis-t2 --cloud gcp --name hapi-echis-t2 --profile load

kill "$PF_PID"
scripts/lab down --cloud gcp --name hapi-echis-t2 --yes \
  --var project_id="$PROJECT_ID" --var region="$REGION" --var zone="$ZONE" \
  --var kubernetes_version=1.35.6-gke.1258000
```

Confirm the guard is now satisfied:

```sh
cat ansible/artifacts/lab/echis-tier-progress.json   # should contain "T2"
```

Only proceed to T3 once this file lists `T2`.

## 5. Size and provision the T3 GCP lab

No tier-specific GCP shape is validated in this repo yet for T3 (see the
status warning above). The closest documented precedent is the GCP
1000-concurrent-user Synthea shape in `docs/benchmark-lab-runbook.md`
(`c3-standard-8`, 3-12 nodes) — that was a different, read-heavier workload at
a similar VU count, so use it as a starting point, not a target. Start with a
moderate shape, watch CPU/memory/DB metrics during seed and benchmark, and
scale `cluster_max_nodes`/`node_size`/`db_sku` up if you see saturation.

```sh
scripts/lab up --cloud gcp --name "$LAB_NAME" --auto-approve \
  --var project_id="$PROJECT_ID" \
  --var region="$REGION" --var zone="$ZONE" \
  --var kubernetes_version=1.35.6-gke.1258000 \
  --var node_size=c3-standard-8 \
  --var cluster_node_count=3 \
  --var cluster_min_nodes=3 \
  --var cluster_max_nodes=6 \
  --var db_edition=ENTERPRISE_PLUS \
  --var db_sku=db-perf-optimized-N-16 \
  --var db_disk_size_gb=512 \
  --var ttl_hours=6
```

If your project's C3 regional CPU quota is too low, request a quota increase
first, or fall back to `node_size=e2-standard-4` / `db_sku=db-custom-2-7680`
to validate deployability only (not a real T3 capacity result).

## 6. Deploy HAPI FHIR

```sh
scripts/lab deploy --cloud gcp --name "$LAB_NAME"

export KUBECONFIG="ansible/artifacts/lab/gcp/$LAB_NAME/kubeconfig"
kubectl -n fhir rollout status deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir get pods -l app.kubernetes.io/instance=hapi-fhir
```

If the rollout fails, check datasource/PostgreSQL errors first (H2 fallback
is not acceptable here):

```sh
kubectl -n fhir logs deploy/hapi-fhir-hapi-fhir-jpaserver
kubectl -n fhir describe pod -l app.kubernetes.io/instance=hapi-fhir
```

## 7. Expose the FHIR endpoint

Keep this running in a dedicated terminal for the rest of the run:

```sh
export KUBECONFIG="ansible/artifacts/lab/gcp/$LAB_NAME/kubeconfig"
kubectl -n fhir port-forward svc/hapi-fhir-hapi-fhir-jpaserver 8080:8080
```

In a second terminal:

```sh
export FHIR_BASE_URL=http://localhost:8080/fhir
curl -fsS "$FHIR_BASE_URL/metadata" >/dev/null
```

### Alternative: reach it at the control-plane host's public IP

The `port-forward` above only binds `127.0.0.1`, reachable through an SSH/VS
Code Remote tunnel. If you're driving this runbook from a GCE VM directly (not
tunneling in) and want to hit the FHIR endpoint from your own machine's
browser/`curl` without a tunnel, use `expose-fhir` instead of the plain
`port-forward` command above:

```sh
scripts/lab expose-fhir --cloud gcp --name "$LAB_NAME" --var project_id="$PROJECT_ID"
```

This opens a GCP firewall rule (`tcp:8080`, `0.0.0.0/0` by default) and starts
a `0.0.0.0`-bound `kubectl port-forward` in the background, then prints the
reachable URL (`http://EXTERNAL_IP:8080/fhir`). The default is the whole
internet, not a detected "your IP" — you're driving this from the GCE VM
itself, so auto-detecting a caller IP would detect the VM's own address, not
your actual browser/laptop, and silently block the access you're trying to
set up. Pass `--source-ranges CIDR` (e.g. your own IP as a `/32`) if you want
it restricted instead. **HAPI FHIR has no authentication in front of it in
this lab** — the data is synthetic, but anything in the `--source-ranges` you
choose can read and write to the FHIR API for as long as it's up, so close it
as soon as you're done:

```sh
scripts/lab unexpose-fhir --cloud gcp --name "$LAB_NAME" --var project_id="$PROJECT_ID"
```

`scripts/lab down` (Step 11) also runs this cleanup automatically before
destroying infrastructure, so an `expose-fhir` you forgot to close doesn't
outlive the lab itself.

## 8. Bulk data-load window, then seed T3's dataset

333,333 households (5,839,996 total records) will import far faster with a
temporarily higher pinned replica count than the committed serving ceiling
(native tier caps at `maxReplicaCount: 5`, per `docs/autoscaling.md`). Pin to
the ceiling for the load window, then release it before benchmarking:

```sh
# Pin replicas for the bulk-load window (do not exceed the native
# connection-budget ceiling of 5 documented in docs/autoscaling.md).
scripts/lab pause-autoscaling --replicas 5

FHIR_BASE_URL=http://localhost:8080/fhir \
LAB_SEED_GENERATOR_MODE=native \
scripts/lab seed --households "$HOUSEHOLDS" \
  --individuals-per-household "$INDIVIDUALS_PER_HOUSEHOLD" \
  --seed "$ECHIS_SEED" --run echis-t3

# Restore the committed serving ceiling before benchmarking.
scripts/lab resume-autoscaling

# Confirm the pin is gone and replicas are converging back to normal.
kubectl -n fhir get scaledobject hapi-fhir-jpaserver \
  -o jsonpath='{.metadata.annotations.autoscaling\.keda\.sh/paused-replicas}'
kubectl -n fhir get deploy hapi-fhir-hapi-fhir-jpaserver
```

A single local `echis_seed.rb` process generating/importing ~5.8M records can
take a long time and eat into your `ttl_hours` budget. If it's too slow,
distribute it across a Kubernetes Job instead:

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
LAB_SEED_GENERATOR_MODE=native \
scripts/lab seed --households "$HOUSEHOLDS" \
  --individuals-per-household "$INDIVIDUALS_PER_HOUSEHOLD" \
  --seed "$ECHIS_SEED" --run echis-t3 \
  --in-cluster --parallel-shards 20
```

See `manifests/seed-job/README.md` for the ConfigMap/PVC prerequisites and
the `scripts/merge_seed_shards.rb` follow-up step this leaves for you to run.

Validate the generator locally first with `--metadata-only` if you want to
confirm resource counts without importing:

```sh
scripts/echis_seed.rb --households "$HOUSEHOLDS" \
  --individuals-per-household "$INDIVIDUALS_PER_HOUSEHOLD" \
  --seed "$ECHIS_SEED" --run-id echis-t3-check --metadata-only
```

## 9. Run the T3 benchmark

Start with `--profile load` — this is the first live T3 run in the repo (see
the status warning above), so establish a clean, non-saturating result first
rather than starting straight on `stress`, per the runbook's "use profiles in
increasing order" methodology:

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
K6_SCRIPT=benchmarks/k6/echis_load_1000.js \
scripts/lab benchmark --profile load --echis-tier T3 --run echis-t3
```

If evaluating pod-restart/Hikari headroom gates, expose Prometheus in another
terminal and pass `PROMETHEUS_BASE_URL`:

```sh
kubectl -n monitoring port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090
```

To browse the Prometheus UI itself at the control-plane host's public IP
instead of a loopback tunnel (same rationale as [Step 7's `expose-fhir`
alternative](#alternative-reach-it-at-the-control-plane-hosts-public-ip)):

```sh
scripts/lab expose-prometheus --cloud gcp --name "$LAB_NAME" --var project_id="$PROJECT_ID"
```

kube-prometheus-stack's bundled Grafana is installed by default
(`install_grafana: true` in `ansible/group_vars/lab.yml`), with the same
`expose-*`/`unexpose-*` pair available for it. Unlike FHIR and Prometheus,
Grafana requires login -- user `admin`, password from:

```sh
kubectl -n monitoring get secret prometheus-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d
```

```sh
scripts/lab expose-grafana --cloud gcp --name "$LAB_NAME" --var project_id="$PROJECT_ID"
```

```sh
PROMETHEUS_BASE_URL=http://localhost:9090 \
FHIR_BASE_URL=http://localhost:8080/fhir \
K6_SCRIPT=benchmarks/k6/echis_load_1000.js \
scripts/lab benchmark --profile load --echis-tier T3 --run echis-t3
```

Confirm the tier was recorded:

```sh
cat ansible/artifacts/lab/echis-tier-progress.json   # should now list T2 and T3
```

Once `load` is clean (HTTP failure rate at or near 0%, healthy gates), you can
optionally push to saturation with `--profile stress` on the same dataset —
this is the profile `specs/008-echis-workload-benchmark/quickstart.md`
documents for T3 — using a new `--run` id so the two results don't overwrite
each other:

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
K6_SCRIPT=benchmarks/k6/echis_load_1000.js \
scripts/lab benchmark --profile stress --echis-tier T3 --run echis-t3-stress
```

## 10. Publish the report

```sh
scripts/lab report --run echis-t3 --cloud gcp --name "$LAB_NAME" --profile load
```

Read, in order: `report.md`, `summary.csv`, `environment.json`,
`prometheus-snapshots.json`. Confirm `environment.json` shows the GCP region,
node size, DB SKU, chart pins, and the T3 household/individual/seed values you
intended. Treat HTTP failure rate above 1% as a failed run unless you
deliberately pushed into `stress` saturation behavior.

## 11. Destroy the lab

Do this immediately after the report is published, and again if any step
failed:

```sh
scripts/lab down --cloud gcp --name "$LAB_NAME" --yes \
  --var project_id="$PROJECT_ID" --var region="$REGION" --var zone="$ZONE" \
  --var kubernetes_version=1.35.6-gke.1258000
```

This also removes any `expose-fhir`/`expose-prometheus`/`expose-grafana`
firewall rule/port-forward for `$LAB_NAME` before destroying infrastructure —
no separate `unexpose-*` call needed if you used Step 7's or Step 9's
public-IP alternatives.

If `down` fails, go to the GCP console and delete GKE/Cloud SQL resources
labeled with `$LAB_NAME` and the TTL you set. If only an `expose-*` cleanup
failed (logged as a warning, `down` still proceeds to destroy
infrastructure), check for a stray `allow-hapi-fhir-*-$LAB_NAME`,
`allow-prometheus-*-$LAB_NAME`, or `allow-grafana-*-$LAB_NAME` firewall rule
in the GCP console.

## Reference: full variable list used above

| Variable | Meaning |
| --- | --- |
| `PROJECT_ID` | Target GCP project (required for every `scripts/lab ... --cloud gcp` call). |
| `LAB_NAME` | Lab/Terraform workspace name, `^[a-z][a-z0-9-]{2,31}$`. |
| `REGION` / `ZONE` | GCP region/zone; defaults `us-central1` / `us-central1-a`. |
| `HOUSEHOLDS` | `333333` for T3 (per `docs/echis-benchmark-tiers.md`). |
| `INDIVIDUALS_PER_HOUSEHOLD` | `3`, held constant across all tiers. |
| `ECHIS_SEED` | Deterministic seed; keep constant across comparable runs. |

## Related docs

- [echis-benchmark-tiers.md](echis-benchmark-tiers.md) — tier table, sequencing guard, T4/T5 blockers.
- [echis-data-model.md](echis-data-model.md) — FHIR resource shapes the generator produces.
- [autoscaling.md](autoscaling.md) — connection-budget arithmetic and the bulk data-load window mechanism.
- [lab-cli.md](lab-cli.md) — full `scripts/lab` command/flag reference.
- `specs/008-echis-workload-benchmark/quickstart.md` — the spec-level validation steps this doc turns into a repeatable GCP procedure.
