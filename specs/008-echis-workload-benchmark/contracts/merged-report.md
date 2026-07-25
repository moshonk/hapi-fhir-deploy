# Contract: Merged Tier Report

What `scripts/publish_results.rb` MUST be able to consume after `scripts/merge_seed_shards.rb` and/or `scripts/merge_k6_shards.rb` run, so each tier still produces exactly one `results/<run>/report.md` (spec FR-009, FR-011), regardless of shard count.

## `scripts/merge_seed_shards.rb` output

- Sums `resource_counts` (per resource type) across all shard `dataset-metadata.json` files.
- Sums `transaction_bundle_count`, `imported_entry_count`, `error_count`.
- Concatenates `errors[]` across shards.
- Records `min(started_at_utc)` / `max(completed_at_utc)` across shards as the aggregate window.
- Records `shard_count` and the list of shard indices actually present, so a caller can detect `shard_count` present-indices `< expected` and fail loudly per `contracts/shard-job.md` invariant 3.
- Output schema is otherwise a superset of the single-shard `dataset-metadata.json` shape already produced by `minimal_fhir_seed.rb`/`echis_seed.rb`, so `scripts/publish_results.rb` needs only additive changes, not a new parser.

## `scripts/merge_k6_shards.rb` output

- Sums `throughput_reqs_per_sec` (as total requests / wall-clock duration, not a naive sum of per-shard rates — per-shard rates may overlap in time, so this MUST be recomputed from summed request counts over the actual run window, not summed directly).
- Sums `http_failure_rate` inputs (total failed / total requests, recomputed, not averaged).
- Sums `operation_mix` counts per operation across shards.
- **MUST NOT** include a computed `latency_ms.{p50,p95,p99}` field derived from shard data. Per `research.md` Decision 4, latency percentiles for multi-shard tiers come from Prometheus/Actuator, not from this merge step. The merged JSON's latency fields MUST either be omitted or explicitly marked `"source": "prometheus"` with a pointer/query rather than a shard-derived number, so `scripts/publish_results.rb` and `report.md` never present a mathematically invalid combined percentile.
- Records `shard_count` and present shard indices, same completeness-detection requirement as the seed merge script.

## `scripts/publish_results.rb` changes

- Accepts either a single-shard or merged multi-shard input for `dataset-metadata.json` and `k6-fhir-summary.json` — same field names, so no schema-version flag is needed, only additive optional fields (`shard_count`, `household_count`, `latency_source`).
- `report.md` gains a "Data Source" note when `shard_count > 1` distinguishing shard-summed fields (throughput, failure rate, dataset totals) from Prometheus-sourced fields (latency percentiles), so a reader never mistakes one for the other.
