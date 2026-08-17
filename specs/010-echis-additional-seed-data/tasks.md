---

description: "Task list for eCHIS Additional Seed Datasets (Location, Tags, Reference Data)"
---

# Tasks: eCHIS Additional Seed Datasets (Location, Tags, Reference Data)

**Input**: Design documents from `/specs/010-echis-additional-seed-data/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/echis-seed-cli-additions.md, quickstart.md (all present)

**Tests**: Included — `plan.md`/`research.md` Decision 4 make automated test coverage (`test/echis_seed_test.rb`) part of this feature's design (FR-011's verification approach and closing a pre-existing zero-CI-coverage gap for `scripts/echis_seed.rb`), not an optional extra.

**Organization**: Tasks are grouped by user story (US1/US2/US3, matching `spec.md`'s P1/P2/P3) to enable independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are repo-relative

## Path Conventions

Single-project CLI-tooling layout (per `plan.md`'s Structure Decision) — `scripts/`, `test/`, `docs/` at repository root. No `src/`/`backend/`/`frontend/` split applies.

---

## Phase 1: Setup

**Purpose**: Minimal shared scaffolding — no new dependencies to install (Ruby stdlib only, per `plan.md`).

- [x] T001 Add the `--include-specimen` flag (Boolean, default `false`, no behavior yet) to `scripts/echis_seed.rb`'s `OptionParser` block, alongside the existing `--metadata-only` flag definition
- [x] T002 [P] Create `test/echis_seed_test.rb`: a `Minitest::Test` skeleton matching `test/publish_results_test.rb`'s pattern (`ROOT_DIR`/`GENERATOR` path constants, an `Open3.capture3`-based helper that runs `scripts/echis_seed.rb --metadata-only` with given args and returns the parsed metadata JSON), with no test cases yet

**Checkpoint**: CLI parses the new flag as a no-op; test harness is ready for story-specific assertions.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Scaffolding shared by the two stories that need live-server verification (US1, US2). US3 (Specimen) doesn't use the verification script (per `contracts/echis-seed-cli-additions.md`'s "Out of scope" note) and has no other cross-story dependency, so it isn't blocked by this phase.

**⚠️ CRITICAL**: T010 (US1) and T017 (US2) — the verification-script check tasks — depend on T003. No other US1/US2 task, and no US3 task, depends on this phase.

- [x] T003 Create `scripts/verify_echis_catchment_data.rb` scaffold: shebang, requires (`json`, `net/http`, `optparse`, `uri`), `OptionParser` for `--fhir-base-url`, `--facility-id`, `--timeout` (default 120), a `VerifyError` class, and an HTTP GET helper reusing `echis_seed.rb`'s `status_success?` pattern — no checks implemented yet, matching `contracts/echis-seed-cli-additions.md`'s CLI contract

**Checkpoint**: Verification script runs, parses its flags, and can make an authenticated-free GET request — ready for US1/US2 to add checks.

---

## Phase 3: User Story 1 - Tag-Scoped Catchment Access Reflects Real Client Behavior (Priority: P1) 🎯 MVP

**Goal**: Generate a facility/sub-region/region `Location` hierarchy and tag `Group`/`Task`/`Patient`/`QuestionnaireResponse` with their facility catchment, so facility-scoped queries return correct, catchment-exclusive results.

**Independent Test**: Generate a small dataset, pick one facility catchment, confirm a facility-scoped query for households/tasks/assessment responses returns only that catchment's resources.

### Implementation for User Story 1

- [x] T004 [US1] Add `CHWS_PER_FACILITY = 5`, `FACILITIES_PER_SUB_REGION = 50`, and `SUB_REGIONS_PER_REGION = 20` constants next to the existing `CHW_CATCHMENT_SIZE = 100` in `scripts/echis_seed.rb`, plus `facility_index_for(chw_index)`, `sub_region_index_for(facility_index)`, and `region_index_for(sub_region_index)` derivation functions (chained integer division, per `research.md` Decision 1 — a facility groups multiple CHW catchments, it is **not** a 1:1 mapping; this is what keeps SC-002's <1% bound satisfied with margin)
- [x] T005 [US1] Add `facility_location_id`, `sub_region_location_id`, `region_location_id` ID-format functions (`echis-loc-fac%06d` / `echis-loc-sub%06d` / `echis-loc-reg%06d`) to `scripts/echis_seed.rb`, next to the existing `*_id` functions
- [x] T006 [US1] Add `location_resource(index, level, part_of_id)` builder function to `scripts/echis_seed.rb` producing the shape from `data-model.md`'s Facility Catchment Hierarchy section (`status`, `name`, `physicalType`, `partOf`)
- [x] T007 [US1] Add `catchment_tag(facility_id)` helper returning the `meta.tag` Coding (`system: "urn:hapi-fhir-deploy:echis-catchment"`, `code: facility_id`) to `scripts/echis_seed.rb`, and apply it to `household_resource`, `task_resource`, `patient_resource`, and `questionnaire_response_resource`'s output (adding `meta.tag`, no other field changes — FR-010)
- [x] T008 [US1] In the per-household batch loop's `emitted_chw_indices`-guarded block in `scripts/echis_seed.rb`, emit the three `Location` resources (facility, sub-region, region, keyed by `facility_index_for(chw_index)` and its parents) alongside the existing `PractitionerRole`/`CareTeam` emission, guarded the same way (per CHW catchment per shard — this means a facility's `Location` gets redundantly re-`PUT` once per CHW catchment within it, accepted per `research.md` Decision 1's "Emission redundancy note", same tradeoff already accepted for `PractitionerRole`/`CareTeam`)
- [x] T009 [US1] Thread the facility Location id (via `facility_location_id(facility_index_for(chw_index))`) through `resources_for_household` into `household_resource`/`task_resource`/`patient_resource`/`questionnaire_response_resource` calls in `scripts/echis_seed.rb` so each tagged resource gets the correct catchment tag
- [x] T010 [P] [US1] Implement the Location/partOf-chain and `_tag`-scoped Group/Task/Patient/QuestionnaireResponse checks (contract checks #1-#3) in `scripts/verify_echis_catchment_data.rb`
- [x] T011 [P] [US1] Add test cases to `test/echis_seed_test.rb`: `--metadata-only` run asserts `resource_counts["Location"]` matches `data-model.md`'s corrected formula (`F = ceil(C/CHWS_PER_FACILITY)`, etc.) for a small `--households` value, and re-running the same shard twice produces byte-identical `resource_counts` (SC-005)
- [x] T012 [US1] Run `quickstart.md` steps 1, 4, and 5 (dry-run counts, verification script against a live server, shard-reproducibility diff) locally and confirm expected output — step 4 is what actually proves this story's Independent Test and SC-001, not just the count checks in step 1. **Status**: steps 1 and 5 verified locally (Location=3/Organization=1/Practitioner=1 at H=100 exactly as computed; shard 0/4 rerun at H=1000 byte-identical `resource_counts`). Step 4 **blocked** — no live FHIR server reachable in this sandbox, same limitation `docs/echis-benchmark-tiers.md` already documents for spec 008; `scripts/verify_echis_catchment_data.rb`'s logic is syntax-checked and its checks are code-reviewed against the contract, but not executed against a live server.

**Checkpoint**: User Story 1 is fully functional and independently testable — facility hierarchy generates, tags apply, verification script confirms scoping.

---

## Phase 4: User Story 2 - Complete First-Sync Reference Data (Organization, Practitioner) (Priority: P2)

**Goal**: Generate a single `Organization` and one `Practitioner` per CHW, referenced by `PractitionerRole.practitioner`.

**Independent Test**: Generate a dataset, confirm each CHW's role resource references a distinct named practitioner record, and an organization record exists.

### Implementation for User Story 2

- [x] T013 [P] [US2] Add `organization_id` (fixed `echis-org000001`) and `practitioner_id(chw_index)` (`echis-pr%06d`) ID-format functions to `scripts/echis_seed.rb`
- [x] T014 [P] [US2] Add `organization_resource` (fixed single resource) and `practitioner_resource(chw_index)` builder functions to `scripts/echis_seed.rb`, per `data-model.md`'s Organization/Practitioner shapes
- [x] T015 [US2] Modify `practitioner_role_resource(chw_index)` in `scripts/echis_seed.rb` to add a `practitioner` reference to `Practitioner/#{practitioner_id(chw_index)}`, with no other field change
- [x] T016 [US2] In the per-catchment `emitted_chw_indices`-guarded block in `scripts/echis_seed.rb`, emit one `Practitioner` per CHW (alongside `PractitionerRole`/`CareTeam`/`Location`); emit the single `Organization` once per shard, guarded by a shard-local boolean (first household processed by this shard)
- [x] T017 [P] [US2] Implement the Organization-read and PractitionerRole→Practitioner resolution checks (contract checks #4-#5) in `scripts/verify_echis_catchment_data.rb`
- [x] T018 [P] [US2] Add test cases to `test/echis_seed_test.rb`: `--metadata-only` run asserts `resource_counts["Organization"] == 1` and `resource_counts["Practitioner"]` matches the CHW-catchment count
- [x] T019 [US2] Run `quickstart.md` step 1's Organization/Practitioner count assertions and step 4's verification script locally and confirm expected output — step 4 is what actually proves this story's Independent Test (distinct Practitioner per CHW, Organization retrievable), not just the count checks in step 1. **Status**: step 1 verified locally (Organization=1, Practitioner=1 at H=100; Practitioner=10 at H=1000). Step 4 **blocked** — same no-live-server limitation as T012.

**Checkpoint**: User Stories 1 AND 2 both work independently; verification script covers both.

---

## Phase 5: User Story 3 - Optional Specimen Records for Compartment Fidelity (Priority: P3)

**Goal**: When `--include-specimen` is passed, emit one `Specimen` per individual in a documented rotating subset; otherwise, no `Specimen` resources or count changes.

**Independent Test**: With the flag disabled (default), confirm no `Specimen` resources and unchanged totals; with it enabled, confirm the documented subset ratio.

### Implementation for User Story 3

- [x] T020 [US3] Add a `SPECIMEN_SUBSET_RATIO` constant (document the chosen value, e.g. every 5th individual) and `specimen_id(individual_index)` (`echis-spec%08d`) to `scripts/echis_seed.rb`
- [x] T021 [US3] Add `specimen_resource(individual_index, patient_id, encounter_date)` builder function to `scripts/echis_seed.rb`, per `data-model.md`'s Specimen shape (rotating LOINC-style specimen-type code, `collection.collectedDateTime` matching the individual's `Encounter` date)
- [x] T022 [US3] In `resources_for_household` in `scripts/echis_seed.rb`, conditionally append a `Specimen` for individuals matching the subset ratio, only when `options[:include_specimen]` is true (threaded through from the Setup-phase flag)
- [x] T023 [P] [US3] Add test cases to `test/echis_seed_test.rb`: `--metadata-only` without `--include-specimen` has no `Specimen` key and unchanged pre-feature counts (SC-006); with `--include-specimen`, `resource_counts["Specimen"]` matches the documented ratio within 1%
- [x] T024 [US3] Run `quickstart.md` step 2 locally and confirm expected output

**Checkpoint**: All three user stories are independently functional. Full feature scope complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, CI coverage, and closing the pre-existing (not just this feature's) automated-test gap for the eCHIS generator family.

- [x] T025 [P] Append a new section to `docs/echis-data-model.md` documenting the `Location`/`Organization`/`Practitioner`/`Specimen` resource shapes and the `meta.tag`/`practitioner` field additions, matching the file's existing implementation-memo format
- [x] T026 [P] Add a `test/merge_seed_shards_test.rb` (or extend an existing fixture-based check, if one is found during implementation) confirming `scripts/merge_seed_shards.rb` merges `Location`/`Organization`/`Practitioner` counts correctly across shard fixtures with no code change required (`research.md` Decision 5)
- [x] T027 Add CI steps to `.github/workflows/ci.yml`: `ruby -c scripts/echis_seed.rb`, `ruby -c scripts/verify_echis_catchment_data.rb`, `ruby test/echis_seed_test.rb`, and `ruby test/merge_seed_shards_test.rb`, matching the existing `synthea_loader`/`publish_results` CI step pattern (this is the repository's first CI coverage of the eCHIS generator family)
- [x] T028 Update `specs/010-echis-additional-seed-data/contracts/echis-seed-cli-additions.md`'s example `resource_counts` numbers and the `SPECIMEN_SUBSET_RATIO` placeholder if the values chosen during implementation (T004, T020) differ from `research.md`'s illustrative defaults
- [x] T029 Run the full `quickstart.md` end-to-end (steps 1-6); if no live FHIR server is reachable in the current environment, record status per step using the same "verified locally / blocked, needs live server" convention `docs/echis-benchmark-tiers.md` already uses. **Status**: steps 1, 2, 5, 6 verified locally with real runs (see T012/T024/T011 status notes and `ruby test/echis_seed_test.rb` — 6 runs, 39 assertions, 0 failures). Steps 3 (live load) and 4 (verification script) **blocked** — no live FHIR server reachable in this sandbox.
- [x] T030 [P] Add a regression test case to `test/echis_seed_test.rb` (FR-010) asserting that `Group`/`Patient`/`Task`/`QuestionnaireResponse`/`PractitionerRole` resource shapes are unchanged from pre-feature output for a fixed seed/index, aside from the documented `meta.tag` and `practitioner` additions — e.g. build each resource for a small `--households` run, strip the new fields, and diff against a captured pre-feature fixture (or against `docs/echis-data-model.md`'s documented shapes)
- [x] T031 [P] Update `README.md`'s repository-map entries for `scripts/echis_seed.rb` and `docs/echis-data-model.md` to note this feature's additions, and add a new entry for `scripts/verify_echis_catchment_data.rb`, per the constitution's "keep README, docs ... synchronized" requirement

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup (T002's test harness helps T003's own sanity-check, but T003 itself only needs T001's flag file to exist unmodified elsewhere). Blocks the verification-script tasks in US1/US2 only (T010, T017) — does not block US1/US2's generator-code tasks or US3 at all
- **User Stories (Phase 3-5)**: US1 (T004-T012) and US2 (T013-T019) can proceed in parallel once Phase 2 completes; US3 (T020-T024) can start immediately after Phase 1 (no Phase 2 dependency)
- **Polish (Phase 6)**: Depends on all three user stories being complete (T025/T028 document final shapes/values; T027 exercises all new code paths in CI; T030 depends on US1/US2/US3's generator changes existing to diff against; T031 depends on T003/T025 existing to describe)

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on US2/US3. Its verification tasks (T010) depend on Phase 2's T003 scaffold.
- **User Story 2 (P2)**: No dependency on US1/US3, other than both editing `scripts/echis_seed.rb`'s shared per-catchment emission block (T008 and T016 touch adjacent code — sequence T008 before T016 if implemented by the same person to avoid merge friction; they are logically independent). Its verification tasks (T017) depend on Phase 2's T003 scaffold.
- **User Story 3 (P3)**: Fully independent — no verification-script or cross-story dependency.

### Within Each User Story

- ID/constant helpers before resource-builder functions before wiring into the emission loop before verification/test tasks
- Story complete before its Polish documentation is finalized (T025/T028)

### Parallel Opportunities

- T001 and T002 (Setup) can run in parallel
- Within US1: T010 and T011 (different files) can run in parallel once T004-T009 land
- Within US2: T013 and T014 (different functions, same file — safe if sequenced by function, or split by developer) can run in parallel with T017/T018 (different files)
- Within US3: T023 (test file) can run in parallel with T020-T022 once the builder function signature is agreed
- Across stories: once Phase 2 completes, US1, US2, and US3 can be staffed and implemented in parallel by different developers (all three touch `scripts/echis_seed.rb`, so coordinate merge order — see User Story Dependencies note above)
- T025, T026, T027, T030, and T031 (Polish, different files) can run in parallel

---

## Parallel Example: User Story 1

```bash
# After T004-T009 land, launch these together:
Task: "Implement Location/partOf-chain and _tag-scoped checks in scripts/verify_echis_catchment_data.rb"
Task: "Add Location resource-count and shard-reproducibility test cases to test/echis_seed_test.rb"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003)
3. Complete Phase 3: User Story 1 (T004-T012)
4. **STOP and VALIDATE**: Run `quickstart.md` steps 1, 4 (facility-scoped checks only), and 5
5. This alone closes the single biggest documented gap (facility-scoped access has no realistic data today) and is deployable/demoable on its own

### Incremental Delivery

1. Setup + Foundational → ready
2. Add US1 → validate independently → this is the MVP (facility hierarchy + tagging)
3. Add US2 → validate independently → closes the Phase-1-reference-data gap
4. Add US3 → validate independently → optional compartment-fidelity rounding-out
5. Polish (T025-T031) → documentation, CI coverage, quickstart sign-off, FR-010 regression proof, README sync

### Parallel Team Strategy

With multiple developers: complete Setup + Foundational together, then split US1/US2/US3 across developers per the Parallel Opportunities note above, coordinating merge order on `scripts/echis_seed.rb`'s shared per-catchment emission block (T008/T016) and `resources_for_household` (T009/T022).

---

## Notes

- Every generator-code task lives in `scripts/echis_seed.rb`; most are marked without `[P]` because they share that one file and build on each other sequentially within a story. Cross-story parallelism is still possible (see above) but requires merge coordination, not automatic conflict-freedom.
- FR-010 (no changes to existing 008 resource shapes) is the hard constraint behind every task above: each one only *adds* a field, function, or resource type — none modifies an existing field on `Group`/`Patient`/`Task`/`QuestionnaireResponse`/`PractitionerRole` beyond the explicitly documented `meta.tag`/`practitioner` additions. T030 is this constraint's dedicated proof, added during `/speckit-analyze` remediation (finding G3) since no earlier task directly verified it.
- Commit after each task or logical group; stop at any Checkpoint to validate a story independently before moving on.
