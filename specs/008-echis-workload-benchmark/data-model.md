# Phase 1 Data Model: eCHIS Progressive Workload Benchmark

Two kinds of "entities" here: the synthetic FHIR resources `scripts/echis_seed.rb` generates (the eCHIS data model itself), and the benchmark's own configuration/orchestration entities (tiers, shards). Field names below follow the deterministic, index-derived style already established by `scripts/minimal_fhir_seed.rb` (`bench-p######` style IDs, seed-derived dates), extended with household/CHW linkage.

## FHIR Resources (generated dataset)

### Household (`Group`)

- **Fields**: `id` (`echis-hh%08d`, zero-padded global household index — 8 digits, since the T5 target of 10,000,000 households exceeds a 6-digit range), `type: "person"`, `actual: true`, `member[]` (references to this household's `Patient` resources), `quantity` (member count). No `characteristic[]`/catchment `Location` reference in the implemented generator (`scripts/echis_seed.rb`) — CHW catchment is derived purely from the household index (`household_index / 100`), not a separate `Location` resource.
- **Relationships**: One household has 1..N individuals (default average 3, per spec Assumptions). Reachable from exactly one community health worker's catchment.
- **Cardinality at peak (T5)**: 10,000,000.

### Individual (`Patient`)

- **Fields**: same core fields as `scripts/minimal_fhir_seed.rb`'s `patient_resource` (`id`, `identifier`, `active`, `name`, `gender`, `birthDate`), `id` = `echis-p%08d` (zero-padded global individual index). Household linkage relies solely on `Group.member` back-references — no household-referencing extension on `Patient` itself, in the implemented generator.
- **Relationships**: Belongs to exactly one Household (`Group`). Subject of Visit/Assessment records below. May have a `RelatedPerson` if a dependent (not the household head).
- **Cardinality at peak (T5)**: 30,000,000.

### Community Health Worker (`PractitionerRole` + `CareTeam`)

- **Fields**: `PractitionerRole.id` (`echis-chw%06d`, zero-padded CHW index — 6 digits comfortably covers the ~100,000 CHWs at T5), `CareTeam.id` (`echis-ct%06d`, same index), `CareTeam.participant[]` referencing the `PractitionerRole`. No `PractitionerRole.practitioner`/`CareTeam.subject`/`reasonReference` in the implemented generator — catchment is derived purely from `household_index / 100`, not a separate `Practitioner` or `Location` resource (kept out of scope for this iteration).
- **Relationships**: One CHW is responsible for a catchment of ~100 households (spec Assumptions). Is the `owner` of `Task` resources and the actor behind `household_sync_write`/`registration_write` operations in the k6 workload.
- **Cardinality at peak (T5)**: ~100,000 (anchors the peak tier's concurrent-user count directly — one simulated k6 VU per CHW at T5).

### Visit / Assessment Record (per-individual, generated per visit event)

- **`Encounter`**: same shape as `minimal_fhir_seed.rb`'s `encounter_resource` (`status: "finished"`, `class: AMB` or a home-visit-appropriate code, `subject`, `period`), extended with a `location` reference to the household `Group` or catchment `Location` where relevant.
- **`Observation`**: same shape as `minimal_fhir_seed.rb`'s `observation_resource` pattern, generalized to a small rotating set of eCHIS-relevant codes (e.g., vitals, MUAC/nutrition screening, danger-sign indicators) rather than a single hardcoded LOINC code.
- **`Condition`**: same shape as `minimal_fhir_seed.rb`'s `condition_resource` pattern, generated for a subset of individuals (not 1:1), representing a risk flag or diagnosis from a small rotating code set.
- **`Task`**: `id`, `status`, `owner` (reference to the responsible CHW's `PractitionerRole`), `for` (reference to the `Patient` or `Group`), representing a follow-up/referral worklist item. Read by the `worklist_read` k6 operation.
- **`QuestionnaireResponse`**: `id`, `status: "completed"`, `subject` (Patient), `item[]` (a small fixed structure representing a registration or visit assessment form), linked to the triggering `Encounter` via `encounter` (Reference to the `Encounter` resource this response was captured during, since `QuestionnaireResponse.encounter` establishes the encounter-level context per the R4 spec) — kept intentionally simple, not modeling the full WHO SMART Guidelines questionnaire structure.
- **Cardinality at peak (T5)**: distributed across Encounter (40M), Observation (40M), Condition (15M), Task (20M), QuestionnaireResponse (25M) per the spec's illustrative budget (total 180M including Patient 30M + Group 10M).

## Benchmark Orchestration Entities (configuration, not FHIR resources)

### Benchmark Tier

- **Fields**: name (T2/T3/T4/T5), target VU count, target individual count, target household count, target total-record count, k6 script path, pass/fail thresholds (inherited from the `load`/`stress` `PROFILE_CONFIGS` shape already in `fhir_benchmark.js`).
- **Relationships**: Ordered sequence (T2 → T3 → T4 → T5); T4/T5 additionally depend on spec 007's pooled connection tier being available.

### Shard

- **Fields**: `shard_index`, `shard_count`, owned ID range (households `[shard_index * chunk, (shard_index+1) * chunk)`, per Decision 3 in `research.md`), per-shard output (`dataset-metadata.json` for generation shards, k6 summary JSON for load-generation shards).
- **Relationships**: N shards combine into one tier's dataset (via `scripts/merge_seed_shards.rb`) or one tier's load-test result (via `scripts/merge_k6_shards.rb`). A shard's `JOB_COMPLETION_INDEX` (from the Kubernetes Indexed Job) maps directly to `shard_index`.
