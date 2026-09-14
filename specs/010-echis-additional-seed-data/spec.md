# Feature Specification: eCHIS Additional Seed Datasets (Location, Tags, Reference Data)

**Feature Branch**: `010-echis-additional-seed-data`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Extend the eCHIS synthetic dataset generator (scripts/echis_seed.rb, spec 008) with additional resource types and scoping metadata identified from the OHS FHIR Sync API Call Inventory & Performance Simulation Baseline document, so the benchmark lab can exercise Location-hierarchy full/incremental pulls, tag-based access scoping, and Phase-1 reference-data pulls that the current household/CHW dataset doesn't cover. Specifically: (1) a small administrative/facility Location hierarchy (e.g., county -> sub-county -> facility/catchment) generated as low-cardinality reference data, deterministically ID'd consistent with the existing echis-* ID scheme; (2) meta.tag on Group, Task, Patient, and QuestionnaireResponse resources referencing their catchment Location, so _tag=Location/{facilityId}-scoped searches (as documented in the sync inventory) return realistic, non-empty result sets; (3) Organization and Practitioner reference resources (Practitioner referenced by PractitionerRole.practitioner) representing the implementing partner/facility operator and named CHW identity, matching the doc's Phase-1 "organizations, practitioners" prerequisite pull; (4) optionally, a rotating Specimen resource for a subset of individuals to round out the Patient/$everything compartment mix the doc references. This extends issue #18's benchmark lab and depends on 008-echis-workload-benchmark's existing household/CHW data model and sharded seed generator; it does not change 008's already-implemented resource shapes, only adds new resource types and tagging alongside them."

## Clarifications

### Session 2026-08-17

- Q: FR-011 requires a "documented verification or workload step" reading the new data — should this be a new k6 load-test operation, a post-seed verification script, or both? → A: A post-seed verification/assertion script (or extension of an existing one) that queries the new data once after generation to confirm reachability; no k6 workload changes.
- Q: What happens to previously generated datasets (from before this feature) — stale/incompatible, or additively coexisting? → A: No migration/backfill; previously generated datasets are superseded, not upgraded in place. Re-running the generator produces the new data model going forward, consistent with how 008 itself superseded the older generic-patient generator.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tag-Scoped Catchment Access Reflects Real Client Behavior (Priority: P1)

As a performance engineer, I can generate a benchmark dataset where households, tasks, individuals, and assessment responses are each tagged with their facility catchment, so that a facility-scoped query returns only the resources that belong to that catchment — the same access pattern a real eCHIS client uses when it restricts its sync to one facility or ward.

**Why this priority**: The existing dataset has no facility/catchment concept at all, so any facility- or ward-scoped access pattern currently returns either everything or nothing meaningful. This is the single biggest gap between the current synthetic dataset and how a real eCHIS client actually queries the server, and every other addition in this spec depends on the catchment hierarchy this story establishes.

**Independent Test**: Generate a small dataset, pick one facility catchment, and confirm a facility-scoped query for households, tasks, and assessment responses returns only resources belonging to that catchment's community health worker and none from other catchments.

**Acceptance Scenarios**:

1. **Given** a generated dataset, **When** the administrative/facility hierarchy is inspected, **Then** it is present as its own low-cardinality reference dataset, not derived only from arithmetic on household index.
2. **Given** a facility catchment with an assigned community health worker, **When** a facility-scoped query is run for households, tasks, and assessment responses, **Then** every result belongs to that catchment and no result belongs to a different catchment.
3. **Given** the dataset is regenerated or a single shard is re-run, **When** the facility hierarchy and catchment assignments are inspected, **Then** the same facility identifiers and catchment assignments are produced byte-for-byte, with no collisions across shards.

---

### User Story 2 - Complete First-Sync Reference Data (Organization, Practitioner) (Priority: P2)

As a solution architect evaluating eCHIS readiness, I can generate a dataset that includes the organizational and named-practitioner reference data a real client pulls before any operational data, so the benchmark's first-sync behavior reflects the full prerequisite pull rather than a simplified subset.

**Why this priority**: This closes a known, documented simplification (the community health worker's identity currently has no distinct practitioner record, and there is no implementing-organization record at all) but it is reference/master data at low cardinality — valuable for realism, not required for the catchment-scoping capability in User Story 1 to work.

**Independent Test**: Generate a dataset and confirm each community health worker's role resource references a distinct, named practitioner record, and that at least one organization record representing the implementing/operating entity exists and is retrievable.

**Acceptance Scenarios**:

1. **Given** a generated dataset, **When** a community health worker's role record is inspected, **Then** it references a separate practitioner record with its own identity, rather than treating the role record as the worker's whole identity.
2. **Given** a generated dataset, **When** the organization reference data is queried, **Then** at least one organization record exists independent of household or individual count.

---

### User Story 3 - Optional Specimen Records for Compartment Fidelity (Priority: P3)

As a performance engineer, I can optionally include a rotating subset of specimen records among individuals' visit history, so a full compartment export for an individual matches the mix of resource types a real eCHIS client's compartment pull can encounter, when this level of fidelity is needed.

**Why this priority**: Lowest priority — the source document lists specimen only as one example among several in an illustrative compartment mix, not as a concretely documented, repeated API call the way facility-scoped and reference-data pulls are. It rounds out realism but nothing else in this spec depends on it.

**Independent Test**: Enable the optional specimen dataset, generate a small dataset, and confirm a rotating subset of individuals has an associated specimen record referencing that individual, while the feature remains fully absent when not enabled.

**Acceptance Scenarios**:

1. **Given** the optional specimen dataset is disabled (the default), **When** a dataset is generated, **Then** no specimen records are produced and total record counts are unaffected.
2. **Given** the optional specimen dataset is enabled, **When** a dataset is generated, **Then** a documented, rotating subset of individuals has exactly one specimen record each, referencing that individual.

---

### Edge Cases

- What happens when the number of community-health-worker catchments doesn't evenly divide into whole facility units, or a facility has zero assigned catchments at the smallest benchmark tier?
- How does a facility-scoped query behave for a facility that exists in the hierarchy but currently has no generated households (e.g., a very small dataset where facility count exceeds catchment count)?
- What happens when the dataset is generated in shards — does every shard independently derive the same facility hierarchy and catchment tags without cross-shard coordination, the same guarantee the existing CHW catchment derivation already provides?
- How is the addition of new resource types and tags reflected in existing dataset-metadata/record-count reporting and shard-merge tooling, so totals don't silently drift out of sync with what's documented?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST generate a deterministic administrative/facility hierarchy as its own reference dataset, sized independently of and at far lower cardinality than the household/individual counts.
- **FR-002**: Every generated facility-hierarchy entry MUST have a stable, deterministic identifier consistent with the existing eCHIS identifier scheme, reproducible byte-for-byte across repeated or sharded runs.
- **FR-003**: Every generated household, worklist item, individual, and structured assessment response MUST carry a reference to its facility catchment, discoverable through a facility-scoped query.
- **FR-004**: The mapping from a community health worker's catchment to a facility-hierarchy entry MUST be computable independently by any shard, without cross-shard coordination, consistent with the existing catchment-derivation guarantee.
- **FR-005**: A facility-scoped query MUST return only resources belonging to that facility's catchment and MUST exclude resources belonging to other catchments.
- **FR-006**: The system MUST generate at least one organization reference record representing the implementing/operating entity, at reference-data cardinality independent of household or individual count.
- **FR-007**: The system MUST generate a distinct, named practitioner record for each community health worker, referenced by that worker's existing role record, rather than treating the role record as the worker's full identity.
- **FR-008**: The system MUST support an optional, separately toggled specimen dataset that, when enabled, associates a documented rotating subset of individuals with exactly one specimen record each; when disabled, no specimen records or related counts are produced.
- **FR-009**: Dataset-generation reporting (record counts, shard metadata) MUST account for every new resource type introduced by this feature, so combined/merged totals remain accurate.
- **FR-010**: This feature MUST NOT change the resource shapes, identifiers, or cardinalities already documented and implemented for household, individual, community-health-worker-role, encounter, observation, condition, task, and assessment-response records — it is additive only.
- **FR-011**: A post-seed verification step (a script, or an extension of an existing one) MUST read the new facility hierarchy, tags, organization, and practitioner data after it is written, confirming it is reachable via facility-scoped queries and reference lookups. This is a one-time correctness check, not a load-test workload change — expanding the k6 workload to exercise facility-scoped reads under load is explicitly out of scope for this iteration.

### Key Entities

- **Facility Catchment (administrative/facility hierarchy)**: A small reference dataset representing the administrative/facility structure (e.g., region, sub-region, facility) that community health worker catchments belong to; far lower cardinality than households.
- **Catchment Tag**: A reference on a household, worklist item, individual, or assessment response pointing to its facility catchment, enabling facility-scoped queries.
- **Organization**: A reference record representing the implementing or operating entity behind the eCHIS deployment; generated at low, fixed cardinality.
- **Practitioner**: A named identity record for a community health worker, distinct from and referenced by that worker's existing role record.
- **Specimen (optional)**: A per-individual record representing a lab/sample collection event, generated for a rotating subset of individuals only when the optional dataset is enabled.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A facility-scoped query at any benchmark tier returns 100% correct membership — every result belongs to the queried facility's catchment and zero results belong to another catchment.
- **SC-002**: The facility hierarchy's total size stays under 1% of the household count at every benchmark tier, confirming it remains reference data rather than scaling with the dataset.
- **SC-003**: 100% of generated households, worklist items, and assessment responses carry a catchment reference that resolves to a facility-hierarchy entry present in the same dataset.
- **SC-004**: Every community health worker's role record resolves to exactly one distinct, named practitioner record.
- **SC-005**: Re-running dataset generation, in whole or by individual shard, reproduces byte-identical facility-hierarchy identifiers and catchment assignments every time.
- **SC-006**: With the optional specimen dataset disabled, total generated record counts are unchanged from before this feature; when enabled, the added record count matches the documented rotating-subset ratio within 1%.

## Assumptions

- The facility hierarchy has three levels by default (e.g., region, sub-region, facility), with each facility-level entry grouping a small fixed number of community-health-worker catchments (not a strict 1:1 mapping) so the hierarchy's total size stays comfortably under SC-002's bound at every tier; deeper/shallower hierarchies or a different grouping size are a future refinement, not required for this iteration.
- A single organization reference record is sufficient to represent the implementing/operating entity for this iteration; modeling multiple partner organizations is out of scope.
- Tag-based scoping in this spec covers households, worklist items, individuals, and assessment responses, matching the resource types the source document repeatedly shows in tag-scoped queries; extending tagging to every other resource type (e.g., visit/observation/condition records) is a future refinement if a documented client call requires it.
- The optional specimen dataset defaults to disabled, since it is the lowest-confidence addition in this spec (illustrative example rather than a concretely repeated documented call); enabling it is an explicit opt-in.
- This feature builds additively on the household/CHW data model already implemented in `008-echis-workload-benchmark` (tracked in `docs/echis-data-model.md`) and does not revise any of its already-reviewed, already-merged resource shapes.
- Existing benchmark tiers, workloads, and previously published results from `008-echis-workload-benchmark` remain valid; this feature does not require re-validating prior tier results, only extending what future generations include.
- Datasets generated before this feature are superseded, not migrated in place; there is no requirement to backfill facility hierarchy, tags, or reference data onto an already-seeded, already-loaded dataset. Re-running the generator produces the new data model going forward.
- Verifying reachability of the new data (FR-011) is a one-time, post-seed correctness check; extending the k6 load-test workload to exercise facility-scoped reads under load is out of scope for this iteration and may be a future spec.

## Source Context

- Source material: the "OHS FHIR Sync — API Call Inventory & Performance Simulation Baseline" document, which traces a real eCHIS-style client's sync API calls (facility-scoped searches, first-sync reference-data pulls, per-patient compartment export) and surfaced the gaps this spec addresses.
- GitHub issues: #18 (benchmark-lab epic, extended by this spec, same as `008-echis-workload-benchmark`).
- Related specs: `008-echis-workload-benchmark` (dependency — this spec is additive to its household/CHW data model and sharded seed generator, and does not modify its implemented resource shapes).
