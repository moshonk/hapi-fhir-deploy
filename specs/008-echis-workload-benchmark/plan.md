# Implementation Plan: eCHIS Progressive Workload Benchmark

**Branch**: `008-echis-workload-benchmark` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-echis-workload-benchmark/spec.md`

## Summary

Extend the existing k6 + Ruby benchmark lab (issue #18) with a household/CHW-aware FHIR data model and write-heavy CHW workload, run across an ordered tier sequence (T2: 100 VUs/100K individuals → T3: 1,000/1M → T4: 10,000/10M → T5 peak: 100,000/30M individuals/10M households/180M total records). The two smallest tiers reuse today's proven connection ceiling; the two largest require both distributed dataset generation/load generation (a single machine/process cannot generate 180M records or drive 100,000 k6 VUs) and the pooled connection tier from the sibling `007-pgbouncer-connection-pooling` spec. The existing generic-workload scripts (`load_100.js`, `load_1000.js`) and their results are preserved untouched as historical evidence; all new work lives in a parallel `echis_*` file family and an extended shared k6 library.

## Technical Context

**Language/Version**: JavaScript/k6 (`benchmarks/k6/lib/fhir_benchmark.js` and new `echis_load_*.js` scripts, ES-module style matching the existing lib), Ruby 3.x (`scripts/echis_seed.rb`, merge scripts, `scripts/lab`, `scripts/publish_results.rb`), Bash (`scripts/lab`), YAML (new Kubernetes Job manifests)

**Primary Dependencies**: k6 (existing), Kubernetes `Job` with `completionMode: Indexed` (new — required for distributed generation/load at T4/T5), Prometheus/Actuator (existing observability pipeline, becomes the authoritative latency source for distributed tiers), HAPI FHIR JPA Server (system under test, unchanged)

**Storage**: External PostgreSQL 16/17 — this feature is a client of the existing target system; it generates and loads FHIR data into it but adds no new persistent storage of its own beyond ephemeral per-shard `dataset-metadata.json`/k6 summary files already produced by the existing lab tooling.

**Testing**: Repo's existing convention — `ruby -c` syntax checks, `node --check` on k6 scripts/lib, `bash -n` on `scripts/lab`, `--dry-run` invocations (mirroring `.github/workflows/ci.yml`'s existing pattern for `smoke.js`/`baseline.js`/`load.js`/`stress.js`). This feature's own correctness checks are the spec's Success Criteria directly: dataset totals within 1% of target (SC-005), each tier's recorded pass/fail against its thresholds (SC-001-004), and the sharding mechanism proven against the *existing* generic generator/workload before being pointed at the new eCHIS ones (de-risking order from the approved feature plan).

**Target Platform**: Kubernetes clusters on AWS/Azure/GCP (existing `infra/terraform/` lab targets), driven through `scripts/lab`.

**Project Type**: Benchmark/load-testing tooling (extends the existing ephemeral lab), not an application — no `src/`/application test suite to extend.

**Performance Goals**: T2 continues passing its already-proven thresholds (298.5 req/s, p95 64.8ms, p99 232ms, 0% failures) under the new data model. T3 executes successfully at least once (closing the never-executed gap in `load_1000.js`). T4 executes with zero connection-budget violations, after spec 007 lands. T5 executes successfully at least once with published results.

**Constraints**: MUST NOT modify `benchmarks/k6/load_100.js` or `benchmarks/k6/load_1000.js` (preserved as untouched historical evidence, FR-007). MUST NOT compute a combined latency percentile by averaging per-shard percentiles (FR-010 — mathematically invalid; use Prometheus/Actuator histograms instead for distributed tiers). MUST NOT attempt T4/T5 against the unmodified native connection ceiling (FR-012 — hard dependency on spec 007). Single-threaded dataset generation is proven at ~223 resources/sec (`results/20260721-191000-gcp-load/raw/dataset-metadata.json`), which extrapolates to ~9.3 days for 180M records — T4/T5 generation MUST be distributed, not merely run longer.

**Scale/Scope**: One new Ruby generator + two merge scripts, four new tier-specific k6 scripts, one generalized shared k6 library (additive `WORKLOADS` registry, existing `generic` behavior unchanged), two new Kubernetes Job manifest templates (seed and k6 shard), `scripts/lab`/`scripts/publish_results.rb` extensions, two new docs files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Chart-First Deployment | PASS | This feature does not touch the deployed HAPI FHIR chart or its values at all — it is client-side load-generation and data-seeding tooling, consistent with how the existing benchmark lab (`scripts/lab`, `benchmarks/k6/`) already lives entirely outside the chart. |
| II. Explicit External PostgreSQL | PASS | Unaffected — this feature is a client of the existing external Postgres via the FHIR REST API; it does not change datasource configuration. |
| III. Version Pinning and Reproducibility | PASS (new obligation) | The new Kubernetes Job manifests (seed shard, k6 shard) MUST pin their container images to reviewed digests — no `latest`, consistent with the existing HAPI/PgBouncer image pinning pattern. |
| IV. Observable and Operable Runtime | PASS | Directly leverages the existing observability pipeline (spec 002, Actuator/Prometheus) as the authoritative latency source for distributed tiers (FR-010) rather than inventing a new metrics path. |
| V. Bounded Scale and Safe Rollouts | PASS | T4/T5 are explicitly gated on the connection-budget work in spec 007 (FR-012) — this feature does not attempt to exceed the connection budget on its own; it only generates load against whatever ceiling is in place. |
| Rev2 D1-D6 | PASS | Unaffected — no Kafka/Zookeeper, no datasource changes, no Postgres version changes, no Hibernate Search changes. New container images used by Job manifests fall under D5 (pinned versions), same obligation as Principle III above. |

No violations requiring justification. One design-level complexity worth naming explicitly (not a constitution violation, but worth stating why it's necessary): distributed generation/load-generation via Kubernetes Indexed Jobs is a genuinely new moving part, justified because single-machine generation is ~4 orders of magnitude too slow for the T5 record target and a single k6 process cannot allocate JS VMs for 100,000 VUs (~100-500GB RAM). The de-risking order in the approved feature plan (prove the Job-sharding *mechanism* against the existing generic generator/workload first, then swap in the eCHIS-specific ones) is carried into Phase 2 tasking to manage this risk rather than avoid the complexity.

## Project Structure

### Documentation (this feature)

```text
specs/008-echis-workload-benchmark/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/             # Phase 1 output
│   ├── echis-seed-cli.md
│   ├── workloads-registry.md
│   ├── shard-job.md
│   └── merged-report.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

Benchmark/load-testing tooling repository, not an application — no `src/`/`tests/` split. New and changed files fit the existing per-concern layout already used by the benchmark lab and by spec 007:

```text
scripts/echis_seed.rb                                   # NEW: household/CHW-aware generator (mirrors minimal_fhir_seed.rb style)
scripts/merge_seed_shards.rb                             # NEW: combines per-shard dataset-metadata.json into one aggregate
scripts/merge_k6_shards.rb                                # NEW: combines per-shard k6 summaries; never averages percentiles
manifests/seed-job/echis-seed-job.yaml                    # NEW: Indexed Job for distributed dataset generation
manifests/k6-shard-job/echis-k6-shard-job.yaml             # NEW: Indexed Job for distributed k6 execution
benchmarks/k6/lib/fhir_benchmark.js                        # EXTENDED: WORKLOADS registry (generic unchanged, new echis)
benchmarks/k6/echis_load_100.js                            # NEW: T2, echis workload
benchmarks/k6/echis_load_1000.js                           # NEW: T3, echis workload
benchmarks/k6/echis_load_10000.js                          # NEW: T4, echis workload (depends on spec 007)
benchmarks/k6/echis_load_100000.js                         # NEW: T5, echis workload (depends on spec 007)
scripts/lab                                                # EXTENDED: LAB_SEED_GENERATOR_MODE, --parallel-shards, --in-cluster
scripts/publish_results.rb                                 # EXTENDED: multi-shard merge, household/CHW dataset fields
docs/echis-benchmark-tiers.md                              # NEW: per-tier runbook subsections (T2-T5)
docs/echis-data-model.md                                   # NEW: FHIR resource-shape memo
```

**Structure Decision**: Follow the existing `scripts/`, `benchmarks/k6/`, `manifests/<topic>/`, `docs/` per-concern layout already established by the benchmark lab (issue #18) and by spec 007. No new top-level directories.

## Complexity Tracking

*No constitution violations requiring justification — table intentionally empty. See the distributed-execution justification note under Constitution Check above.*
