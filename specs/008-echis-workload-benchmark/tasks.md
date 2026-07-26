---
description: "Task list for eCHIS Progressive Workload Benchmark"
---

# Tasks: eCHIS Progressive Workload Benchmark

**Input**: Design documents from `/specs/008-echis-workload-benchmark/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Not explicitly requested in the spec. Verification relies on this repo's existing convention (`ruby -c`, `node --check`, `--dry-run`, and this feature's own Success Criteria as executable checks) rather than a `tests/` suite.

**Organization**: Tasks are grouped by user story (US1-US5, from `spec.md`) in the priority order the spec itself defines.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)

## Path Conventions

Benchmark/load-testing tooling repository, not an application — paths below are the real repo paths from `plan.md`'s Project Structure section.

---

## Phase 1: Setup

- [X] T001 [P] Choose and pin container images for the new Job manifests (Ruby generator image, k6 image) — no `latest`, per Constitution Principle III; record references for reuse. Pinned via live registry lookup: `docker.io/library/ruby:3.3.12-alpine3.24@sha256:c162e46df6458be2bc169956f207225abd4b017adc0f0a6f7ad50640b93fcf82` (matches CI's Ruby 3.3) and `docker.io/grafana/k6:2.1.0@sha256:68e78d94140704ec4ee0cb7c5cf6cd12a32b7d310a6f98d94931ee9b0b9dc629`.
- [X] T002 [P] Create the `manifests/seed-job/` and `manifests/k6-shard-job/` directories — each with a `README.md` recording the T001 pinned image and pointing to the future T026/T027 manifests.

**Checkpoint**: Pinned images and directories available for Phase 6.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Extend `benchmarks/k6/lib/fhir_benchmark.js`'s request helper to support POST/PUT with a JSON body, preserving all existing GET-only call sites unchanged (`contracts/workloads-registry.md` invariant 3). Implemented as a new sibling function `requestWriteOperation` (POST/PUT + JSON body) alongside the existing, untouched `requestOperation` (GET-only) — both share a small extracted `finishOperation` helper for the check/record logic, so `requestOperation`'s signature and behavior are byte-for-byte unchanged. `requestWriteOperation` validates `method` is exactly `"POST"` or `"PUT"` (review comment: an unsupported/mistyped method used to silently fall back to POST).
- [X] T004 Introduce the `WORKLOADS` registry skeleton in `benchmarks/k6/lib/fhir_benchmark.js` — `generic` wraps today's `OPERATION_WEIGHTS`/handlers byte-for-byte unchanged, `echis` starts as an empty placeholder — and thread `workload` through `benchmarkSetup(profile, workload = "generic")` (`contracts/workloads-registry.md` invariants 1-2) (depends on T003). `chooseOperation` now takes the workload object (not just its weights) so it can only offer `bulk_export` when the workload actually registers a handler for it, and `runFhirWorkload` checks handler existence before dispatch — both fixed per review comment (previously, `echis` + `BULK_EXPORT_ENABLED=true` could select `bulk_export` and then crash on a missing handler instead of failing clearly). Verified: `node --check` on the lib + all four existing profiles + `load_100.js`/`load_1000.js` (untouched, still call `benchmarkSetup(PROFILE)` with one arg); the existing CI Ruby assertion script for this file passes unmodified; a standalone runtime test of `chooseOperation`/`workloadFor`/handler-dispatch confirms the weighted distribution, the two review-flagged edge cases, and generic-workload behavior are all correct.

**Checkpoint**: Shared library ready for both the new tier scripts (US1) and the new operation handlers (US3).

---

## Phase 3: User Story 1 - Progressive Tier Execution Builds Confidence Incrementally (Priority: P1) 🎯 MVP anchor

**Goal**: A defined, ordered T2→T5 tier sequence, each tier independently executable and gated on the previous one passing.

**Independent Test**: Execute a single named tier end-to-end (dataset generation, load run, result publication) and confirm its recorded concurrent-user count, dataset totals, and pass/fail thresholds match that tier's definition.

**Note**: T006 (T2 script) can be written immediately; actually *running* T011 requires US2 (Phase 4) and US3 (Phase 5) to be complete — see Dependencies below.

### Implementation for User Story 1

- [X] T005 [P] [US1] Document the T2-T5 tier definitions (target VUs, individuals, households, total records, thresholds) in `docs/echis-benchmark-tiers.md`
- [X] T006 [US1] Create `benchmarks/k6/echis_load_100.js` (T2), mirroring `benchmarks/k6/load_100.js`'s hardcoded `options.scenarios` + `handleSummary()` pattern, calling `benchmarkSetup("load", "echis")` (depends on T004). Implemented with a dual-scenario design completing T024's deferred wiring: a `ramping-vus` `fhir_workload` scenario (all `echis` operations except `household_sync_write`, via the newly-added `runFhirWorkloadExcluding`) alongside a `ramping-arrival-rate` `household_sync` scenario (via `runHouseholdSyncWrite`). Stamps `individual_load_target`/`household_load_target`/`total_record_load_target` alongside the existing `concurrency_target`/`patient_load_target` fields.
- [X] T007 [US1] Create `benchmarks/k6/echis_load_1000.js` (T3), mirroring `benchmarks/k6/load_1000.js` (depends on T004). Same dual-scenario design as T006, stage timings mirroring `load_1000.js` exactly.
- [X] T008 [US1] Create `benchmarks/k6/echis_load_10000.js` (T4) — file exists now; execution documented as blocked on spec 007's pooled tier (depends on T004)
- [X] T009 [US1] Create `benchmarks/k6/echis_load_100000.js` (T5 peak) — same execution caveat as T008 (depends on T004)
- [X] T010 [US1] Add a tier-sequencing guard (in `docs/echis-benchmark-tiers.md` and, where practical, in `scripts/lab`) that refuses or warns when a higher tier is attempted before the previous tier has a recorded passing result (spec Acceptance Scenario 1.2). Implemented as `scripts/lab benchmark --echis-tier T2|T3|T4|T5`: T4/T5 require `LAB_ECHIS_POOLED_TIER_CONFIRMED=true`; T3/T4/T5 require the immediately preceding tier recorded in `ansible/artifacts/lab/echis-tier-progress.json` (written on a successful run). Verified locally: T4 without confirmation fails, T3 without a recorded T2 fails, T2 dry-run passes with no prior tier, and T3 passes once T2 is recorded — all four existing `scripts/lab` CI dry-run invocations (`--help`, `seed --dry-run`, `benchmark --profile smoke --dry-run`, `report --dry-run`) still pass unchanged since `--echis-tier` is opt-in.
- [X] T011 [US1] Re-run T2 (`echis_load_100.js`) against a generated eCHIS dataset and confirm it meets or documents deviation from the proven `load_100.js` thresholds (298.5 req/s, p95 64.8ms, p99 232ms, 0% failures) (depends on T006, and on Phase 4/Phase 5 being complete to actually execute). Phase 4 (US2) and Phase 5 (US3) are both now complete (merged), but this sandbox has no reachable Kubernetes cluster or live FHIR server, so a live run could not be performed here. Substituted with local verification: `node --check` on all four new tier scripts; an isolated Node reimplementation of the new `dispatchOperation`/`runFhirWorkloadExcluding` refactor confirming the excluded operation is never drawn by the `ramping-vus` scenario over 20,000 iterations while the remaining four operations stay reachable; and `scripts/echis_seed.rb --households 33333 --individuals-per-household 3 --metadata-only` (T2 scale) confirming 583,996 generated entries matching the expected resource-count formula. A live T2 run remains an open action item, documented in `docs/echis-benchmark-tiers.md`.

**Checkpoint**: Tier sequence and gating logic defined; T2 becomes fully executable once US2 (Phase 4) and US3 (Phase 5) land.

---

## Phase 4: User Story 2 - Realistic Household/CHW Data Model (Priority: P1)

**Goal**: A synthetic generator producing correctly linked households, individuals, CHWs, and visit/assessment records.

**Independent Test**: Generate a small dataset and confirm every individual belongs to exactly one household, every household is reachable from a CHW's catchment, and household/individual/record totals match target within 1%.

### Implementation for User Story 2

- [X] T012 [P] [US2] Implement household/individual generation (`Group`, `Patient`, `RelatedPerson`) in `scripts/echis_seed.rb` per `data-model.md` and `contracts/echis-seed-cli.md`. IDs are 8-digit zero-padded global indices (`echis-hh%08d`, `echis-p%08d`) — corrected from `data-model.md`'s original 6-digit illustration, which was too narrow for the 10,000,000-household T5 target. `RelatedPerson` is generated for every non-head individual in a household (`individuals_per_household - 1` per household) and added to `contracts/echis-seed-cli.md`'s example `resource_counts`, which had omitted it.
- [X] T013 [P] [US2] Implement CHW generation (`PractitionerRole`, `CareTeam`) at ~1:100-household cardinality in `scripts/echis_seed.rb`. CHW index = `household_index / 100`, so every shard computes the same CHW id for a given household without cross-shard coordination; no separate `Practitioner`/`Location` resources (kept out of scope).
- [X] T014 [US2] Implement visit/assessment record generation (`Encounter`, `Observation`, `Condition`, `Task`, `QuestionnaireResponse`) in `scripts/echis_seed.rb`, consistent with the illustrative resource budget in `spec.md` (depends on T012, T013). Deterministic per-individual pattern: every individual gets an Encounter+Observation+QuestionnaireResponse; even-indexed individuals also get a Condition; every third individual also gets a Task (status `requested`) — exact closed-form counts rather than the spec's original fractional ratios, verified against the actual generator output. The Task status is chosen to align with `worklist_read`'s planned `status=requested` query (T019, `contracts/workloads-registry.md`, tracked in #53 — not yet merged into this branch as of this task) so a load-test run against a seeded dataset finds real worklist entries once that handler lands.
- [X] T015 [US2] Implement `--shard-index`/`--shard-count` range-based partitioning in `scripts/echis_seed.rb` per `contracts/echis-seed-cli.md` (depends on T014). Verified: 3-shard split of 100 households is contiguous with no gaps/overlaps and reassembles to the full `[0, 100)` range; the shared CHW at a shard boundary is redundantly (but idempotently, via PUT) re-emitted by each shard that touches it — documented in a code comment as a deliberate tradeoff to avoid cross-shard coordination, and confirmed to never affect the budget-relevant resource types (Group/Patient/Encounter/Observation/Condition/Task/QuestionnaireResponse), which are exclusively owned by one shard's contiguous range.
- [X] T016 [US2] Write the extended `dataset-metadata.json` output (`echis` block: households, individuals_per_household, resource_counts, shard fields) per `contracts/echis-seed-cli.md` (depends on T015). Adds a `--metadata-only` flag (not present on `minimal_fhir_seed.rb`) so this can be validated fully locally without a live FHIR server.
- [X] T017 [US2] Generate a small dataset locally and confirm household/individual/record totals match target within 1% (spec SC-005), per `quickstart.md` step 2 (depends on T016). Verified via `--metadata-only`: at 100 households / 3 individuals-per-household, `resource_counts` exactly matches the hand-derived closed-form formula (Group=100, Patient=300, RelatedPerson=200, PractitionerRole/CareTeam=1, Encounter/Observation/QuestionnaireResponse=300, Condition=150, Task=100 — 1752 entries total, 0% deviation); identical inputs produce identical output across separate runs (deterministic); and ID uniqueness holds with zero collisions within any resource type across a 500-household/1,500-individual run.

**Checkpoint**: Generator produces a verifiable, correctly-linked household/CHW dataset, independently of any load test.

---

## Phase 5: User Story 3 - Write-Heavy CHW Field Workload (Priority: P1)

**Goal**: A k6 workload dominated by CHW registration/visit-sync writes, with distinct low-volume supervisor reads.

**Independent Test**: Run the workload against a running FHIR server and confirm household-visit-sync/registration writes account for the majority of traffic, and that written visit records are retrievable afterward.

### Implementation for User Story 3

- [X] T018 [P] [US3] Implement `household_sync_write` handler (POST transaction Bundle to the FHIR base root, whose entries are PUT: Group+Patient+Encounter+Observation+Condition+QuestionnaireResponse+Task) in `WORKLOADS.echis` (depends on T003, T004). Uses stable per-VU household/patient/CHW/task IDs (`echis-*-vu<VU>`) with per-iteration-unique visit-record IDs (`echis-*-vu<VU>-<ITER>`), so the workload is self-sufficient against a server with no pre-existing data rather than depending on `scripts/echis_seed.rb` (US2, separate). The Task's PUT entry writes status `requested` (not `completed`) so it matches `worklist_read`'s `status=requested` query — a VU's own writes must be findable by its own worklist read.
- [X] T019 [P] [US3] Implement `worklist_read` handler (`Task?owner=PractitionerRole/{chwId}&status=requested`) in `WORKLOADS.echis` (depends on T004)
- [X] T020 [P] [US3] Implement `household_roster_read` handler in `WORKLOADS.echis` (depends on T004). Implemented as `Group?_id={id}&_include=Group:member` (a search, not a direct `Group/{id}` instance read) so it always returns a Bundle (200) rather than 404ing before the household exists yet for that VU.
- [X] T021 [P] [US3] Implement `registration_write` handler (POST transaction Bundle to the FHIR base root, whose entries are PUT: Group+Patient+RelatedPerson) in `WORKLOADS.echis` (depends on T003, T004). Creates a genuinely new household every call (`echis-hh-vu<VU>-reg<ITER>`), distinct from `household_sync_write`'s stable per-VU household.
- [X] T022 [P] [US3] Implement `supervisor_dashboard_read` handler (`Patient?_summary=count`) in `WORKLOADS.echis` (depends on T004). Implemented as a low weight (5/100) shared across all VUs rather than gating by VU identity — achieves the spec's "low-volume" traffic shape without adding a second selection dimension to `chooseOperation`; documented as a deliberate simplification in code comments.
- [X] T023 [US3] Set `echis` operation weights so `household_sync_write` + `registration_write` account for the majority of traffic, per spec FR-005 (depends on T018, T019, T020, T021, T022). Weights: `household_sync_write:50, registration_write:10, worklist_read:20, household_roster_read:15, supervisor_dashboard_read:5` — writes are 60/100.
- [X] T024 [US3] Configure `household_sync_write` on a `ramping-arrival-rate`/`constant-arrival-rate` executor per `research.md` Decision 7, keeping other `echis` operations on `ramping-vus` (depends on T023). Library-side primitives added: exported `runHouseholdSyncWrite(data)` (dedicated exec target for an arrival-rate scenario) and `operationWeightsExcluding(workloadName, ...names)` (so a `ramping-vus` scenario can be built with `household_sync_write` removed from its draw, avoiding double-counting). The actual `options.scenarios` wiring combining both executors happens in the `echis_load_*.js` tier scripts (US1, T006-T009) — the earliest point those scenarios are defined; documented in code comments.
- [X] T025 [US3] Run the `echis` workload against a running FHIR server with no pre-existing data and confirm registration/visit writes succeed and are retrievable afterward (spec Acceptance Scenario 3.2) (depends on T024) — **no live FHIR server available in the implementing environment.** Substitute verification performed instead: `node --check` on the full lib + all profiles + untouched `load_100.js`/`load_1000.js`; the existing CI Ruby assertion script; and a 19-assertion payload-construction test (re-implementing the pure resource-building logic in Node) confirming transaction bundle shape, idempotent PUT usage, correct cross-resource references (Group.member/Encounter.subject/QuestionnaireResponse.encounter/Task.for+owner all resolve to the correct in-bundle resource), ID stability across iterations for the same VU (proving a GET afterward would find the same household/patient/task) vs. distinct visit-record IDs per iteration, no collisions across VUs or between `household_sync_write`'s and `registration_write`'s households, and the 60/100 write-majority weighting. A real end-to-end run against a live server is still required before this is fully proven.

**Checkpoint**: Write-heavy CHW workload runnable and self-verifying, independently of a full tier run.

---

## Phase 6: User Story 4 - Distributed Execution Beyond Single-Machine Capacity (Priority: P2)

**Goal**: Kubernetes Indexed Job sharding for both dataset generation and k6 execution, proven safe on existing tooling before being pointed at the new eCHIS tooling.

**Independent Test**: Split a generation or load-generation task across multiple parallel workers and confirm the combined result matches a single-worker run for an equivalent smaller target, with no duplicate or missing work.

### Implementation for User Story 4

- [X] T026 [P] [US4] Create `manifests/seed-job/echis-seed-job.yaml` per `contracts/shard-job.md`, initially pointed at `scripts/minimal_fhir_seed.rb` for de-risking (depends on T001, T002). Uses `<ANGLE_BRACKET>` placeholder tokens for per-run values (documented in `manifests/seed-job/README.md`), consistent with `contracts/shard-job.md`'s own `<N>` notation — the actual substitution mechanism is deferred to T038. `minimal_fhir_seed.rb` has no `--shard-index` flag, so shards intentionally generate overlapping IDs at this stage; documented in the manifest as safe (idempotent `PUT`) and not a defect.
- [X] T027 [P] [US4] Create `manifests/k6-shard-job/echis-k6-shard-job.yaml` per `contracts/shard-job.md`, initially pointed at an existing generic k6 script for de-risking (depends on T001, T002). Targets `benchmarks/k6/smoke.js`; the ConfigMap volume uses `items[].path` to reconstruct `lib/fhir_benchmark.js` under the mount root since k6 scripts import it by relative path — documented in `manifests/k6-shard-job/README.md`.
- [X] T028 [US4] Implement `scripts/merge_seed_shards.rb` (sum resource counts, detect missing shard indices, fail loudly) per `contracts/merged-report.md` (depends on T026). Detects the generator-specific top-level key (`synthea` vs `echis`) dynamically so it works against either generator's shard output without a flag.
- [X] T029 [US4] Implement `scripts/merge_k6_shards.rb` (sum throughput/failure-rate/operation-mix; recompute rather than average; never combine percentiles) per `contracts/merged-report.md` and `research.md` Decision 4 (depends on T027). Required adding `total_requests`/`failed_requests`/`duration_seconds` fields to `benchmarkSummary()` in `fhir_benchmark.js` (additive; existing fields unchanged) since the prior summary shape only carried rates, not the absolute counts needed to recompute a merged rate correctly. Also discovered and fixed a real pre-existing gap: `operationMix()`/`OPERATION_COUNTERS` never tracked the five `echis` operations, so `operation_mix` in every echis-workload k6 summary (single-shard or merged) was silently reporting zero for household_sync_write etc. — added the five missing Counters.
- [X] T030 [US4] Validate the sharding mechanism end-to-end against existing tooling: run T026-T029 against `scripts/minimal_fhir_seed.rb`/an existing k6 script at small scale, confirm zero duplicate/missing IDs and correct merged totals (spec Acceptance Scenario 4.1, `quickstart.md` step 1) (depends on T028, T029). No live Kubernetes cluster in this sandbox, so the Job manifests themselves could not be executed; substituted with local script-level verification: `scripts/echis_seed.rb --metadata-only` run 3 times with `--shard-index 0/1/2 --shard-count 3` (30 households) merged via `merge_seed_shards.rb` — totals match hand-derived counts including the documented CHW-boundary redundancy (531 = 527 baseline + 4 redundant PractitionerRole/CareTeam from 2 extra shards touching the same catchment); hand-crafted `k6-fhir-summary.json` fixtures (matching the real schema) merged via `merge_k6_shards.rb` — summed counts, recomputed rate, and max-duration throughput all verified by hand. "Zero duplicate IDs" does NOT hold for the T026 de-risking stage itself (`minimal_fhir_seed.rb` has no shard-aware ID partitioning, so shards deliberately overlap, which is safe/idempotent, not a defect — see T026's note); the true zero-duplicate-ID guarantee is a property of `echis_seed.rb`'s `--shard-index` partitioning, verified above once T031's retargeting is applied.
- [X] T031 [US4] Swap `echis-seed-job.yaml` to invoke `scripts/echis_seed.rb` and `echis-k6-shard-job.yaml` to invoke the `echis_load_*.js` scripts (depends on T030, and on US2/US3 being complete — T017, T025). Seed job now passes `--shard-index`/`--shard-count` (giving each shard a real disjoint household range) plus `--households`/`--individuals-per-household`; k6 shard job targets `echis_load_100.js`. Documented a real design constraint discovered while swapping: `echis_load_*.js` scripts hardcode their own VU stage targets (not parametrized per-shard), so this Job's sharding strategy is "N unmodified copies of one tier script" (aggregate concurrency = that script's own VU target × `SHARD_COUNT`), not "one tier's target divided across N pods" — documented in the manifest header and README, consistent with the contract's own Independent Test wording ("combined result matches a single-worker run for an equivalent smaller target").
- [X] T032 [US4] Inject a deliberate single-shard failure in a test run and confirm it is visible in the combined result rather than silently absorbed (spec Acceptance Scenario 4.3) (depends on T031). Verified locally (same no-cluster substitution as T030): removed one shard's output file from a real 3-shard `echis_seed.rb --metadata-only` run before merging — `merge_seed_shards.rb` fails loudly (exit 1, names the missing index) rather than producing a partial aggregate; repeated the same check against `merge_k6_shards.rb` with a hand-crafted fixture set, same result.

**Checkpoint**: Distributed generation/load-generation proven safe on existing tooling, then successfully retargeted at the new eCHIS tooling.

---

## Phase 7: User Story 5 - Comparable Published Results Across Tiers (Priority: P3)

**Goal**: One legible, comparable published report per tier, regardless of shard count.

**Independent Test**: After a tier completes, confirm a published report exists containing that tier's concurrent-user target, dataset totals, throughput, latency percentiles, and failure rate, in the same format as other tiers' reports.

### Implementation for User Story 5

- [X] T033 [P] [US5] Extend `scripts/publish_results.rb` to accept merged multi-shard `dataset-metadata.json`/k6 summary input (additive fields only: `shard_count`, `household_count`, `latency_source`) per `contracts/merged-report.md`. Added a generator-agnostic `dataset_section()` helper (detects `synthea` vs `echis`, same technique as `merge_seed_shards.rb`) and a new additive `environment.json` `"dataset"` block (generator, seed, households, individuals, resource_counts, generated_entry_count, shard_count, shard_indices_present) alongside the untouched legacy `"synthea"` block. Also discovered and fixed a real pre-existing gap: the old `"synthea"`-only lookup never populated anything for eCHIS datasets at all (wrong top-level key), so eCHIS tier reports would have shown blank dataset fields even for single-shard runs.
- [X] T034 [US5] Add a "Data Source" note to `report.md`'s generated output distinguishing shard-summed fields from Prometheus-sourced latency fields when `shard_count > 1` (depends on T033). Latency rows show "see Prometheus (multi-shard run)" instead of a bare "unknown" when `latency_source == "prometheus"`, and a dedicated `## Data Source` section explains why, per `research.md` Decision 4.
- [X] T035 [US5] Confirm every tier's published report contains the same comparable field set (concurrent-user target, dataset totals, throughput, latency percentiles, failure rate), per spec SC-006 and `quickstart.md` step 8 (depends on T034). No real tier runs exist yet (T4/T5 blocked on spec 007, T3+ distributed runs need a live cluster this sandbox doesn't have); verified instead with two `test/publish_results_test.rb` cases plus an ad hoc local run comparing a single-shard synthea-style dataset against a merged 3-shard eCHIS dataset — `environment.json`'s top-level keys and `dataset` block keys are identical across both, and `report.md`'s section headings match, regardless of generator or shard count.

**Checkpoint**: All tiers produce one comparable report each, regardless of shard count.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T036 [P] Add `docs/echis-data-model.md` FHIR resource-shape memo (mirrors `docs/indexing-strategy.md`'s memo format), per `data-model.md`. Documents the deterministic ID scheme, all 10 resource shapes with real field values from `scripts/echis_seed.rb`, the derived cardinality formula (verified against 5 real generator runs), and the known deviation from `data-model.md`'s illustrative 180M budget.
- [X] T037 [P] Document the workload's lack of per-user authentication as an explicit, deliberate gap in `docs/echis-benchmark-tiers.md`, per spec FR-013
- [X] T038 Add `LAB_SEED_GENERATOR_MODE=synthea|native`, `--parallel-shards`, `--in-cluster` support to `scripts/lab`, wiring in the Job manifests from Phase 6 (depends on T031). `native` mode invokes `scripts/echis_seed.rb` directly via new `--households`/`--individuals-per-household` flags, skipping Synthea; `synthea` mode (default) is byte-identical to the prior behavior (verified: the existing `cmd_seed` body was renamed to `cmd_seed_synthea` unchanged, not rewritten). `--in-cluster` renders and applies the seed/k6-shard Job manifests (envsubst-style, via a new `render_job_manifest` helper) and waits for completion; the final shard-merge step is left as a documented follow-up command since extracting files from a PVC is cluster/storage-class specific, consistent with `contracts/shard-job.md`'s own Non-goals. Verified locally: all four new/changed local-dry-run paths (native missing `--households`, native local dry-run, native `--in-cluster` dry-run, benchmark `--in-cluster` dry-run) behave correctly, rendered manifests have zero leftover placeholder tokens and parse as valid YAML, and all pre-existing CI dry-run invocations (`--help`, `seed --dry-run`, `benchmark --profile smoke --dry-run`, `report --dry-run`) plus `test/lab_epic_acceptance_test.rb` are unaffected.
- [X] T039 Run `specs/008-echis-workload-benchmark/quickstart.md` steps 1-4 (through T3) end-to-end and record results; steps 5-7 (calibration spike, T4, T5) once spec 007 is implemented (depends on T011, T017, T025, T030). No live cluster/FHIR server in this sandbox; status per step recorded in `docs/echis-benchmark-tiers.md`'s "Quickstart end-to-end status" section — steps 1 and 8 verified via PR #56/#57's local tests, step 2 run for real here (100 households, 1,752 entries, exact formula match), steps 3-4 remain open live-run items, steps 5-7 correctly blocked on spec 007.
- [X] T040 Sync any changed commands/paths into `AGENTS.md`, `README.md`, and `docs/benchmark-lab-runbook.md`. `AGENTS.md`'s spec index already accurately described both specs at a high level, no change needed there. `README.md` gained repository-map entries for the two new docs, `echis_seed.rb`, and the two merge scripts. `docs/benchmark-lab-runbook.md` gained an "eCHIS Progressive Household/CHW Benchmark" section mirroring the existing GCP 1000-user section's style. `docs/lab-cli.md` gained native-generator-mode and `--in-cluster`/`--parallel-shards` subsections under Seed and Benchmark.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — blocks Phase 3 (US1 tier scripts call `benchmarkSetup` with the new `workload` parameter) and Phase 5 (US3 handlers live in the registry this phase creates).
- **User Stories (Phase 3-7)**: Phases 4 (US2) and 5 (US3) have no dependency on each other or on Phase 3 and can proceed in parallel once Phase 2 is done. Phase 3 (US1)'s *files* can be written in parallel too, but its final validation task (T011) and Phase 6's retargeting task (T031) both need Phase 4 and Phase 5 complete. Phase 6 (US4) can start immediately after Setup — its de-risking tasks (T026-T030) validate against *existing* tooling and don't wait on Phase 4/5, only its retargeting task (T031) does. Phase 7 (US5) can be built in parallel with everything else; its final validation (T035) needs real tier runs to exist.
- **Polish (Phase 8)**: Depends on the relevant preceding tasks noted per task above.

### Parallel Opportunities

- T001/T002 (Setup) are parallel.
- T005 (US1 docs) can run alongside anything.
- T012/T013 (US2) are parallel; T018-T022 (US3, five independent handlers) are all parallel.
- T026/T027 (US4, seed Job vs. k6 Job) are parallel.
- Phase 4 (US2) and Phase 5 (US3) can be staffed and executed fully in parallel.
- Phase 6 (US4)'s de-risking tasks (T026-T030) can run in parallel with Phase 4 and Phase 5.

---

## Parallel Example: User Story 2 vs User Story 3 vs User Story 4 (de-risking)

```bash
# Once Phase 2 (T003, T004) is complete, these can run in parallel:
Task: "Implement household/individual generation in scripts/echis_seed.rb" (US2, T012)
Task: "Implement household_sync_write handler in WORKLOADS.echis" (US3, T018)
Task: "Create manifests/seed-job/echis-seed-job.yaml pointed at minimal_fhir_seed.rb" (US4, T026)
```

---

## Implementation Strategy

### MVP Scope (Setup + Foundational + US2 + US3 + US1's T2 validation)

US1, US2, and US3 are all P1, but US1's own independent test (execute a tier end-to-end) is only meaningfully demonstrable once US2 (data) and US3 (workload) exist. Treat the MVP as the smallest slice that proves the eCHIS benchmark works end-to-end at the smallest tier:

1. Complete Phase 1 (Setup) + Phase 2 (Foundational).
2. Complete Phase 4 (US2) and Phase 5 (US3) in parallel.
3. Complete Phase 3 (US1) through T011 — a real, passing T2 run under the new data model and workload.
4. **STOP and VALIDATE**: this is the first concrete proof the eCHIS benchmark works, independent of distributed execution or peak scale.

### Incremental Delivery

1. Setup + Foundational → shared library ready.
2. US2 + US3 (parallel) → generator and workload each independently verifiable.
3. US1 → T2 executes end-to-end under the real eCHIS model (MVP proof point).
4. US4 → sharding mechanism proven on old tooling, then retargeted — unlocks T3 at real scale and, later, T4/T5.
5. US5 → every tier's results become comparable, not just individually inspectable.
6. Polish → docs, `scripts/lab` wiring, full quickstart run, cross-repo doc sync.

---

## Notes

- No task modifies `benchmarks/k6/load_100.js` or `benchmarks/k6/load_1000.js` — verified explicitly by T006/T007 creating new files rather than editing existing ones.
- T4 (T008) and T5 (T009) tier scripts can be *written* in this spec's scope, but their *execution* is blocked on the sibling `007-pgbouncer-connection-pooling` spec per spec FR-012 — T039 makes this explicit.
- Commit after each task or logical group, consistent with repo convention.
