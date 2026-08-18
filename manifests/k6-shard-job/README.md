# `manifests/k6-shard-job/`

`echis-k6-shard-job.yaml`: a Kubernetes Indexed Job that runs distributed k6
load generation across `parallelism` parallel shard pods, per
`specs/008-echis-workload-benchmark/contracts/shard-job.md`
(`specs/008-echis-workload-benchmark/tasks.md` tasks T027/T031, User Story 4).
Targets `benchmarks/k6/echis_load_100.js`. (It started out pointed at
`benchmarks/k6/smoke.js` for de-risking the Job mechanism itself, before
US2/US3 existed — see git history and tasks.md T027's note.)

**Sharding strategy**: each shard pod runs the SAME, unmodified tier script
in full — the `echis_load_*.js` scripts hardcode their own VU stage targets,
they are not parametrized per-shard. Aggregate concurrency is the chosen
script's own VU target multiplied by `SHARD_COUNT` (e.g. `SHARD_COUNT=10`
with `echis_load_100.js` approximates ~1,000 aggregate VUs, a distributed
stand-in for T3; `SHARD_COUNT=1000` approximates ~100,000, i.e. T5). Pick
whichever committed `echis_load_*.js` script gets you closest to the target
concurrency you want, and swap the script filename in this manifest's
`args`/ConfigMap `items` accordingly.

## Before `kubectl apply`

The manifest uses `<ANGLE_BRACKET>` placeholder tokens that must be
substituted. `scripts/lab benchmark --in-cluster --parallel-shards N` (task
T038) does this automatically — the table below is for applying the
manifest by hand (e.g. via `envsubst`).

| Token | Meaning |
| --- | --- |
| `<SHARD_COUNT>` | Number of parallel k6 shard pods. |
| `<FHIR_BASE_URL>` | Target FHIR server base URL. |
| `<K6_SCRIPTS_CONFIGMAP>` | Name of a pre-created ConfigMap containing the k6 script(s) — see below. |
| `<SHARD_OUTPUT_PVC>` | Name of a pre-created PVC mounted at `/shard-output`, so every shard's k6 summary JSON is addressable by its index and `scripts/merge_k6_shards.rb` can read them all. `SHARD_COUNT > 1` needs this `ReadWriteMany` (every shard mounts it concurrently); `SHARD_COUNT == 1` only needs `ReadWriteOnce`. |
| `<PROMETHEUS_REMOTE_WRITE_URL>` | Prometheus remote-write endpoint each shard pod pushes its own live k6 metrics to, reached directly by cluster-DNS (no port-forward needed, unlike a local-mode benchmark) — typically `http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090/api/v1/write`. Makes an in-cluster run show up in Grafana's "k6 Prometheus" dashboard exactly like a local-mode run does. |

Create the scripts ConfigMap before applying (name must match
`<K6_SCRIPTS_CONFIGMAP>`). k6 scripts import `./lib/fhir_benchmark.js` by
relative path, so the shared library key is mapped onto a `lib/` subdirectory
via the manifest's `volumes[].configMap.items` — if you retarget the manifest
at a different script (per the sharding strategy above), add that script's
file to this ConfigMap and to the `items` list alongside
`echis_load_100.js`:

```sh
kubectl create configmap echis-k6-shard-job-scripts \
  --from-file=echis_load_100.js=benchmarks/k6/echis_load_100.js \
  --from-file=fhir_benchmark.js=benchmarks/k6/lib/fhir_benchmark.js \
  -n fhir
```

## Merging shard output

Once all shards complete, combine their `k6-fhir-summary.json` files with
`scripts/merge_k6_shards.rb --shard-dir /shard-output --shard-count N
--output k6-fhir-summary.json`. Per `contracts/merged-report.md` and
`research.md` Decision 4: throughput and failure rate are recomputed from
summed absolute request counts (never summed/averaged rates, which would
misrepresent overlapping per-shard windows), and no shard-derived latency
percentile is emitted — the merged output carries `"latency_source":
"prometheus"` instead, since only Prometheus/Actuator histograms are valid
for multi-shard percentiles. Fails loudly if any shard index is missing,
rather than silently producing a partial aggregate, per
`contracts/shard-job.md` invariant 3.

## Pinned image (task T001, no `latest` per Constitution Principle III)

```text
docker.io/grafana/k6:2.1.0@sha256:68e78d94140704ec4ee0cb7c5cf6cd12a32b7d310a6f98d94931ee9b0b9dc629
```

The non-browser variant — this lab only exercises HTTP/FHIR REST traffic, per
the existing `benchmarks/k6/` scripts, so the smaller image without headless
browser support is sufficient.
