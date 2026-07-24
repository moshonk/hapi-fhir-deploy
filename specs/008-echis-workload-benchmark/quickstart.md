# Quickstart: Validating the eCHIS Progressive Workload Benchmark

Prerequisites: same as the existing benchmark lab (`docs/getting-started-benchmark-lab.md`) — Terraform, Helm, kubectl, Ruby, k6, cloud credentials — plus this feature's new generator, k6 scripts, and Job manifests applied. For T4/T5, spec 007's pooled connection tier MUST already be validated (its own `quickstart.md`).

## 1. Prove the sharding mechanism against existing tooling first

Per the de-risking order in the approved feature plan, before touching any eCHIS-specific code:

```sh
kubectl apply -f manifests/seed-job/echis-seed-job.yaml \
  --dry-run=client   # then apply for real, pointed at scripts/minimal_fhir_seed.rb with a small N and shard-count
```

Confirm the merged output (`scripts/merge_seed_shards.rb`) has zero missing shard indices and correct summed resource counts for a small known target (e.g., 1,000 patients across 4 shards = 250 each).

## 2. Generate a small eCHIS dataset locally

```sh
ruby scripts/echis_seed.rb --households 100 --individuals-per-household 3 \
  --seed 12345 --run-id local-smoke --metadata /tmp/echis-metadata.json \
  --fhir-base-url http://127.0.0.1:8080/fhir
```

Confirm `resource_counts` in the output metadata matches the expected household/individual/record totals within 1% (spec SC-005).

## 3. Run T2 under the new data model and confirm no regression

```sh
K6_SCRIPT=benchmarks/k6/echis_load_100.js scripts/lab benchmark --profile load --run echis-t2-smoke
```

Compare against `results/20260721-191000-gcp-load/report.md`'s thresholds (p95 <= ~65ms, p99 <= ~232ms order of magnitude, 0% failure rate) — confirm the write-heavy `echis` workload still meets or documents a deviation from those figures (spec SC-001).

## 4. Run T3 and record the first real result for that scale

```sh
ruby scripts/echis_seed.rb --households 333333 --individuals-per-household 3 \
  --seed 12345 --run-id echis-t3 --metadata /tmp/echis-t3-metadata.json \
  --fhir-base-url "$FHIR_BASE_URL"
K6_SCRIPT=benchmarks/k6/echis_load_1000.js scripts/lab benchmark --profile stress --run echis-t3
scripts/lab report --run echis-t3 --cloud <cloud> --profile echis-t3
```

Confirm a published `results/<run>/report.md` exists with non-null throughput/latency/failure-rate fields (spec SC-002).

## 5. Run the calibration spike before attempting T4/T5

Run dataset generation at a moderate shard count (e.g., 10, 50, 100 shards) against a small fixed target and record resources/sec per shard count. This produces the real throughput-vs-worker-count curve referenced by `research.md` Decision 5 — do not skip to T4/T5 sizing without this data.

## 6. Run T4 (requires spec 007's pooled tier)

```sh
# Confirm spec 007's pooled tier is active and its CI guardrail passes first.
kubectl apply -f manifests/seed-job/echis-seed-job.yaml   # parallelism sized per the calibration spike
K6_SCRIPT=benchmarks/k6/echis_load_10000.js  # driven via manifests/k6-shard-job/echis-k6-shard-job.yaml
scripts/lab report --run echis-t4 --cloud <cloud> --profile echis-t4
```

Confirm zero connection-budget violations (inspect PgBouncer `SHOW POOLS` and real Postgres active-connection count throughout the run, per spec 007's own quickstart) and that latency percentiles in the published report are sourced from Prometheus, not shard-averaged (spec SC-003, `contracts/merged-report.md`).

## 7. Run T5 peak

Same shape as T4, scaled to the full target (100,000 VUs / 30,000,000 individuals / 10,000,000 households / 180,000,000 total records). Confirm the published report exists and dataset totals are within 1% of target (spec SC-004, SC-005).

## 8. Confirm comparability across all tiers

```sh
diff <(jq 'keys' results/<t2-run>/summary.csv) <(jq 'keys' results/<t5-run>/summary.csv)
```

Confirm the same set of fields (concurrent-user target, dataset totals, throughput, latency percentiles, failure rate) is present and comparable across every tier's published report (spec SC-006).
