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

- [ ] T001 [P] Choose and pin container images for the new Job manifests (Ruby generator image, k6 image) — no `latest`, per Constitution Principle III; record references for reuse
- [ ] T002 [P] Create the `manifests/seed-job/` and `manifests/k6-shard-job/` directories

**Checkpoint**: Pinned images and directories available for Phase 6.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Extend `benchmarks/k6/lib/fhir_benchmark.js`'s request helper to support POST/PUT with a JSON body, preserving all existing GET-only call sites unchanged (`contracts/workloads-registry.md` invariant 3)
- [ ] T004 Introduce the `WORKLOADS` registry skeleton in `benchmarks/k6/lib/fhir_benchmark.js` — `generic` wraps today's `OPERATION_WEIGHTS`/handlers byte-for-byte unchanged, `echis` starts as an empty placeholder — and thread `workload` through `benchmarkSetup(profile, workload = "generic")` (`contracts/workloads-registry.md` invariants 1-2) (depends on T003)

**Checkpoint**: Shared library ready for both the new tier scripts (US1) and the new operation handlers (US3).

---

## Phase 3: User Story 1 - Progressive Tier Execution Builds Confidence Incrementally (Priority: P1) 🎯 MVP anchor

**Goal**: A defined, ordered T2→T5 tier sequence, each tier independently executable and gated on the previous one passing.

**Independent Test**: Execute a single named tier end-to-end (dataset generation, load run, result publication) and confirm its recorded concurrent-user count, dataset totals, and pass/fail thresholds match that tier's definition.

**Note**: T006 (T2 script) can be written immediately; actually *running* T011 requires US2 (Phase 4) and US3 (Phase 5) to be complete — see Dependencies below.

### Implementation for User Story 1

- [ ] T005 [P] [US1] Document the T2-T5 tier definitions (target VUs, individuals, households, total records, thresholds) in `docs/echis-benchmark-tiers.md`
- [ ] T006 [US1] Create `benchmarks/k6/echis_load_100.js` (T2), mirroring `benchmarks/k6/load_100.js`'s hardcoded `options.scenarios` + `handleSummary()` pattern, calling `benchmarkSetup("load", "echis")` (depends on T004)
- [ ] T007 [US1] Create `benchmarks/k6/echis_load_1000.js` (T3), mirroring `benchmarks/k6/load_1000.js` (depends on T004)
- [ ] T008 [US1] Create `benchmarks/k6/echis_load_10000.js` (T4) — file exists now; execution documented as blocked on spec 007's pooled tier (depends on T004)
- [ ] T009 [US1] Create `benchmarks/k6/echis_load_100000.js` (T5 peak) — same execution caveat as T008 (depends on T004)
- [ ] T010 [US1] Add a tier-sequencing guard (in `docs/echis-benchmark-tiers.md` and, where practical, in `scripts/lab`) that refuses or warns when a higher tier is attempted before the previous tier has a recorded passing result (spec Acceptance Scenario 1.2)
- [ ] T011 [US1] Re-run T2 (`echis_load_100.js`) against a generated eCHIS dataset and confirm it meets or documents deviation from the proven `load_100.js` thresholds (298.5 req/s, p95 64.8ms, p99 232ms, 0% failures) (depends on T006, and on Phase 4/Phase 5 being complete to actually execute)

**Checkpoint**: Tier sequence and gating logic defined; T2 becomes fully executable once US2 (Phase 4) and US3 (Phase 5) land.

---

## Phase 4: User Story 2 - Realistic Household/CHW Data Model (Priority: P1)

**Goal**: A synthetic generator producing correctly linked households, individuals, CHWs, and visit/assessment records.

**Independent Test**: Generate a small dataset and confirm every individual belongs to exactly one household, every household is reachable from a CHW's catchment, and household/individual/record totals match target within 1%.

### Implementation for User Story 2

- [ ] T012 [P] [US2] Implement household/individual generation (`Group`, `Patient`, `RelatedPerson`) in `scripts/echis_seed.rb` per `data-model.md` and `contracts/echis-seed-cli.md`
- [ ] T013 [P] [US2] Implement CHW generation (`PractitionerRole`, `CareTeam`) at ~1:100-household cardinality in `scripts/echis_seed.rb`
- [ ] T014 [US2] Implement visit/assessment record generation (`Encounter`, `Observation`, `Condition`, `Task`, `QuestionnaireResponse`) in `scripts/echis_seed.rb`, consistent with the illustrative resource budget in `spec.md` (depends on T012, T013)
- [ ] T015 [US2] Implement `--shard-index`/`--shard-count` range-based partitioning in `scripts/echis_seed.rb` per `contracts/echis-seed-cli.md` (depends on T014)
- [ ] T016 [US2] Write the extended `dataset-metadata.json` output (`echis` block: households, individuals_per_household, resource_counts, shard fields) per `contracts/echis-seed-cli.md` (depends on T015)
- [ ] T017 [US2] Generate a small dataset locally and confirm household/individual/record totals match target within 1% (spec SC-005), per `quickstart.md` step 2 (depends on T016)

**Checkpoint**: Generator produces a verifiable, correctly-linked household/CHW dataset, independently of any load test.

---

## Phase 5: User Story 3 - Write-Heavy CHW Field Workload (Priority: P1)

**Goal**: A k6 workload dominated by CHW registration/visit-sync writes, with distinct low-volume supervisor reads.

**Independent Test**: Run the workload against a running FHIR server and confirm household-visit-sync/registration writes account for the majority of traffic, and that written visit records are retrievable afterward.

### Implementation for User Story 3

- [ ] T018 [P] [US3] Implement `household_sync_write` handler (transaction Bundle POST: Encounter+Observation+Condition+QuestionnaireResponse+Task update) in `WORKLOADS.echis` (depends on T003, T004)
- [ ] T019 [P] [US3] Implement `worklist_read` handler (`Task?owner={chwId}&status=requested`) in `WORKLOADS.echis` (depends on T004)
- [ ] T020 [P] [US3] Implement `household_roster_read` handler (`Group/{id}?_include=Group:member`) in `WORKLOADS.echis` (depends on T004)
- [ ] T021 [P] [US3] Implement `registration_write` handler (transaction Bundle POST: Patient+Group+RelatedPerson) in `WORKLOADS.echis` (depends on T003, T004)
- [ ] T022 [P] [US3] Implement `supervisor_dashboard_read` handler (aggregate/`_summary=count`) as a distinct, low-volume VU subset in `WORKLOADS.echis` (depends on T004)
- [ ] T023 [US3] Set `echis` operation weights so `household_sync_write` + `registration_write` account for the majority of traffic, per spec FR-005 (depends on T018, T019, T020, T021, T022)
- [ ] T024 [US3] Configure `household_sync_write` on a `ramping-arrival-rate`/`constant-arrival-rate` executor per `research.md` Decision 7, keeping other `echis` operations on `ramping-vus` (depends on T023)
- [ ] T025 [US3] Run the `echis` workload against a running FHIR server with no pre-existing data and confirm registration/visit writes succeed and are retrievable afterward (spec Acceptance Scenario 3.2) (depends on T024)

**Checkpoint**: Write-heavy CHW workload runnable and self-verifying, independently of a full tier run.

---

## Phase 6: User Story 4 - Distributed Execution Beyond Single-Machine Capacity (Priority: P2)

**Goal**: Kubernetes Indexed Job sharding for both dataset generation and k6 execution, proven safe on existing tooling before being pointed at the new eCHIS tooling.

**Independent Test**: Split a generation or load-generation task across multiple parallel workers and confirm the combined result matches a single-worker run for an equivalent smaller target, with no duplicate or missing work.

### Implementation for User Story 4

- [ ] T026 [P] [US4] Create `manifests/seed-job/echis-seed-job.yaml` per `contracts/shard-job.md`, initially pointed at `scripts/minimal_fhir_seed.rb` for de-risking (depends on T001, T002)
- [ ] T027 [P] [US4] Create `manifests/k6-shard-job/echis-k6-shard-job.yaml` per `contracts/shard-job.md`, initially pointed at an existing generic k6 script for de-risking (depends on T001, T002)
- [ ] T028 [US4] Implement `scripts/merge_seed_shards.rb` (sum resource counts, detect missing shard indices, fail loudly) per `contracts/merged-report.md` (depends on T026)
- [ ] T029 [US4] Implement `scripts/merge_k6_shards.rb` (sum throughput/failure-rate/operation-mix; recompute rather than average; never combine percentiles) per `contracts/merged-report.md` and `research.md` Decision 4 (depends on T027)
- [ ] T030 [US4] Validate the sharding mechanism end-to-end against existing tooling: run T026-T029 against `scripts/minimal_fhir_seed.rb`/an existing k6 script at small scale, confirm zero duplicate/missing IDs and correct merged totals (spec Acceptance Scenario 4.1, `quickstart.md` step 1) (depends on T028, T029)
- [ ] T031 [US4] Swap `echis-seed-job.yaml` to invoke `scripts/echis_seed.rb` and `echis-k6-shard-job.yaml` to invoke the `echis_load_*.js` scripts (depends on T030, and on US2/US3 being complete — T017, T025)
- [ ] T032 [US4] Inject a deliberate single-shard failure in a test run and confirm it is visible in the combined result rather than silently absorbed (spec Acceptance Scenario 4.3) (depends on T031)

**Checkpoint**: Distributed generation/load-generation proven safe on existing tooling, then successfully retargeted at the new eCHIS tooling.

---

## Phase 7: User Story 5 - Comparable Published Results Across Tiers (Priority: P3)

**Goal**: One legible, comparable published report per tier, regardless of shard count.

**Independent Test**: After a tier completes, confirm a published report exists containing that tier's concurrent-user target, dataset totals, throughput, latency percentiles, and failure rate, in the same format as other tiers' reports.

### Implementation for User Story 5

- [ ] T033 [P] [US5] Extend `scripts/publish_results.rb` to accept merged multi-shard `dataset-metadata.json`/k6 summary input (additive fields only: `shard_count`, `household_count`, `latency_source`) per `contracts/merged-report.md`
- [ ] T034 [US5] Add a "Data Source" note to `report.md`'s generated output distinguishing shard-summed fields from Prometheus-sourced latency fields when `shard_count > 1` (depends on T033)
- [ ] T035 [US5] Confirm every tier's published report contains the same comparable field set (concurrent-user target, dataset totals, throughput, latency percentiles, failure rate), per spec SC-006 and `quickstart.md` step 8 (depends on T034)

**Checkpoint**: All tiers produce one comparable report each, regardless of shard count.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T036 [P] Add `docs/echis-data-model.md` FHIR resource-shape memo (mirrors `docs/indexing-strategy.md`'s memo format), per `data-model.md`
- [ ] T037 [P] Document the workload's lack of per-user authentication as an explicit, deliberate gap in `docs/echis-benchmark-tiers.md`, per spec FR-013
- [ ] T038 Add `LAB_SEED_GENERATOR_MODE=synthea|native`, `--parallel-shards`, `--in-cluster` support to `scripts/lab`, wiring in the Job manifests from Phase 6 (depends on T031)
- [ ] T039 Run `specs/008-echis-workload-benchmark/quickstart.md` steps 1-4 (through T3) end-to-end and record results; steps 5-7 (calibration spike, T4, T5) once spec 007 is implemented (depends on T011, T017, T025, T030)
- [ ] T040 Sync any changed commands/paths into `AGENTS.md`, `README.md`, and `docs/benchmark-lab-runbook.md`

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
