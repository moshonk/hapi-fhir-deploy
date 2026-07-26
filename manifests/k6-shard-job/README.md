# `manifests/k6-shard-job/`

`echis-k6-shard-job.yaml`: a Kubernetes Indexed Job that runs distributed k6
load generation across `parallelism` parallel shard pods, per
`specs/008-echis-workload-benchmark/contracts/shard-job.md`
(`specs/008-echis-workload-benchmark/tasks.md` task T027, User Story 4).
Currently targets `benchmarks/k6/smoke.js` for de-risking. Task T031
retargets it at an `echis_load_*.js` tier script.

## Before `kubectl apply`

The manifest uses `<ANGLE_BRACKET>` placeholder tokens that must be
substituted (e.g. via `envsubst`, or the future `scripts/lab` wiring — task
T038, not yet implemented):

| Token | Meaning |
| --- | --- |
| `<SHARD_COUNT>` | Number of parallel k6 shard pods. |
| `<FHIR_BASE_URL>` | Target FHIR server base URL. |
| `<K6_SCRIPTS_CONFIGMAP>` | Name of a pre-created ConfigMap containing the k6 script(s) — see below. |
| `<SHARD_OUTPUT_PVC>` | Name of a pre-created `ReadWriteMany` PVC mounted at `/shard-output`, so every shard's k6 summary JSON is addressable by its index and `scripts/merge_k6_shards.rb` can read them all. |

Create the scripts ConfigMap before applying (name must match
`<K6_SCRIPTS_CONFIGMAP>`). k6 scripts import `./lib/fhir_benchmark.js` by
relative path, so the shared library key is mapped onto a `lib/` subdirectory
via the manifest's `volumes[].configMap.items` — if you retarget the manifest
at a different script (e.g. for task T031), add that script's file to this
ConfigMap and to the `items` list alongside `smoke.js`:

```sh
kubectl create configmap echis-k6-shard-job-scripts \
  --from-file=smoke.js=benchmarks/k6/smoke.js \
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
