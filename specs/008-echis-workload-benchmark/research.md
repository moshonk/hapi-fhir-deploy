# Phase 0 Research: eCHIS Progressive Workload Benchmark

All technical unknowns below were resolved during specification and validated against the current repository state (`benchmarks/k6/lib/fhir_benchmark.js`, `benchmarks/k6/load_100.js`, `benchmarks/k6/load_1000.js`, `scripts/minimal_fhir_seed.rb`, `scripts/lab`, `scripts/publish_results.rb`, `results/20260721-191000-gcp-load/`) rather than left as open `NEEDS CLARIFICATION` markers.

## Decision 1: New file family, not modifying `load_100.js`/`load_1000.js` in place

- **Decision**: New tiers get their own `echis_load_*.js` scripts and a generalized `WORKLOADS` registry in the shared library, rather than editing `load_100.js`/`load_1000.js` or `fhir_benchmark.js`'s existing `OPERATION_WEIGHTS` in place.
- **Rationale**: `load_100.js` is the only tier with real executed evidence (`results/20260721-191000-gcp-load/`); retrofitting it to a household/CHW resource model would silently drop coverage of the generic Patient/Encounter/Condition/Observation mix and make the historical result non-reproducible. `load_1000.js` is documented precedent for the *shape* of a bigger tier script (hardcoded `ramping-vus` stages + `handleSummary()` stamping `concurrency_target`/`patient_load_target`) and is reused as a template, not a file to edit.
- **Alternatives considered**:
  - *Add a `--workload` CLI flag to the existing scripts*: rejected — these are k6 scripts, not CLI tools; k6's `options` object is evaluated at module load time, not runtime-branchable in the way this would need without restructuring the files anyway, which is the same amount of work as writing new files while carrying more regression risk to proven scripts.

## Decision 2: Generator language and performance posture — Ruby, parallelism over rewrite

- **Decision**: `scripts/echis_seed.rb` stays in Ruby, matching `minimal_fhir_seed.rb`'s style (stdlib-only `Net::HTTP`, no gem dependencies). Throughput is achieved via horizontal parallelism (Kubernetes Indexed Job, many shard workers), not by rewriting the generator in a faster language.
- **Rationale**: The proven bottleneck (`results/20260721-191000-gcp-load/raw/dataset-metadata.json`: 223 resources/sec) is dominated by HAPI's per-resource JPA indexing and Postgres write I/O, not by Ruby's own execution speed — rewriting the generator in a faster language would not remove the real bottleneck. Staying in Ruby keeps the generator consistent with the existing `minimal_fhir_seed.rb`/`synthea_loader.rb` pattern (same language, same dependency-free posture, easier review).
- **Alternatives considered**:
  - *Rewrite in a faster/concurrent-native language*: rejected for this iteration — the bottleneck is server-side (HAPI indexing, Postgres I/O), so this would add engineering cost without addressing the actual constraint. Revisit only if the calibration spike (see Decision 5) shows client-side generation speed, not server-side ingestion, is the limiting factor.

## Decision 3: Sharding scheme — index-range, not modulo

- **Decision**: Both `echis_seed.rb` and the k6 shard scripts partition work by contiguous index range (`--shard-index`/`--shard-count` selecting a slice of the target range), not by modulo assignment (`index % shard_count`).
- **Rationale**: Range-based sharding keeps generated resource IDs deterministic, contiguous, and trivially auditable (shard N owns household IDs `[N * chunk, (N+1) * chunk)`), and makes partial-shard-failure detection simple (a failed shard's ID range is immediately identifiable, satisfying spec 008's edge case about detecting/retrying partial shards). Modulo assignment would scatter a failed shard's missing IDs across the entire ID space, making gaps far harder to detect.
- **Alternatives considered**:
  - *Modulo/hash-based assignment*: rejected — harder to audit for completeness, no benefit over range-based for this workload since there's no need for even interleaving of "difficulty" across shards (all households are roughly uniform cost to generate).

## Decision 4: Distributed k6 percentile aggregation — Prometheus is authoritative, not shard averaging

- **Decision**: For T4/T5 (distributed k6 execution across many shard pods), throughput and failure-rate figures are summed across shards by `scripts/merge_k6_shards.rb`, but latency percentiles (p50/p95/p99) are read from Prometheus/Actuator histograms already scraped by the existing observability pipeline (spec 002), not computed from per-shard k6 output.
- **Rationale**: Averaging (or any other naive combination of) per-shard p95/p99 values does not produce a mathematically valid overall percentile — this was flagged explicitly as a correctness requirement (FR-010) precisely because it's an easy mistake to make when scaling k6 horizontally. HAPI FHIR already exposes Actuator/Micrometer histograms scraped by Prometheus (spec 002), so an authoritative source already exists rather than needing new infrastructure.
- **Alternatives considered**:
  - *Merge raw per-request latency samples across shards and recompute percentiles centrally*: rejected as unnecessary — it would require centralizing enormous raw sample volumes (potentially billions of data points at T5) when Prometheus already aggregates this server-side.

## Decision 5: T4/T5 wall-clock and cost are not committed until a calibration spike runs

- **Decision**: Neither this spec nor its tasks commit fixed wall-clock-time or infrastructure-cost targets for T4/T5 dataset generation. A calibration spike (throughput vs. worker-count, both for generation and for pooled-tier serving) runs first, and its results inform — but are not predicted by — the final tier execution.
- **Rationale**: The only real throughput data point (223 resources/sec, single-threaded) does not tell us how throughput scales with shard count once Postgres write I/O and HAPI indexing CPU become the binding constraint rather than HTTP concurrency (noted explicitly in the feature's approved plan). Committing a number now would be a guess presented as a fact.
- **Alternatives considered**:
  - *Extrapolate linearly from the single-threaded number and commit a target now*: rejected — likely optimistic (see Decision 2's rationale on the real bottleneck being server-side), and the spec's own SC-007 already frames the bounded time window as "determined by an empirical calibration run," not a pre-committed number.

## Decision 6: Bulk `$import` is a stretch-goal optimization, not a required unblocking path

- **Decision**: HAPI FHIR's Bulk Data `$import` operation (NDJSON-based) is treated as an optional future optimization to investigate after the parallelized transaction-bundle approach is proven, not as a prerequisite for T4/T5.
- **Rationale**: Support and behavior of `$import` on the pinned `hapiproject/hapi:v8.10.0-2` image were not verified in this offline planning pass, and even where supported, HAPI's Batch2 job framework for bulk import generally still routes through the same DAO/indexing persistence path as REST transaction bundles — so it likely reduces HTTP/JSON marshalling overhead and enables server-coordinated parallelism, but does not obviously bypass the real bottleneck identified in Decision 2. Treating it as required would block progress on an unverified assumption.
- **Alternatives considered**:
  - *Require `$import` support as a precondition for T4/T5*: rejected — turns an unverified technical detail into a hard blocker; the parallelized transaction-bundle approach (Decisions 2-3) is already sufficient to attempt the calibration spike.

## Decision 7: CHW traffic burst modeling — arrival-rate executor for sync writes only

- **Decision**: The `household_sync_write` k6 scenario uses a `ramping-arrival-rate`/`constant-arrival-rate` executor (request-rate driven), while read-heavy scenarios (`worklist_read`, `household_roster_read`, `supervisor_dashboard_read`) keep the existing `ramping-vus` executor already used throughout `fhir_benchmark.js`.
- **Rationale**: Real CHW field activity is bursty (e.g., end-of-day sync windows), which an arrival-rate executor models more realistically than a fixed concurrent-VU-count executor for the write path specifically. k6 supports multiple executors within one `options.scenarios` object (already demonstrated by the existing `baseline_gates` scenario coexisting with the main workload scenario in `fhir_benchmark.js`), so this is additive, not a restructuring of the existing execution model.
- **Alternatives considered**:
  - *Use `ramping-vus` uniformly for all scenarios, including sync writes*: rejected as less representative of real CHW usage, though it remains the fallback if arrival-rate executors prove operationally harder to reason about during implementation — noted here so that fallback is a documented, deliberate choice if taken, not a silent scope cut.
