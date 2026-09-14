# Phase 0 Research: eCHIS Additional Seed Datasets

No `[NEEDS CLARIFICATION]` markers remain in `spec.md` (both open product-scope
questions were resolved during `/speckit-clarify`). This document instead resolves
the technical-design unknowns needed to plan Phase 1, following
`scripts/echis_seed.rb`'s existing deterministic, index-derived generation style.

## Decision 1: Facility hierarchy shape and ID scheme

**Decision**: Three new levels, all derived by integer division chained from the
existing `chw_index`, mirroring how `chw_index_for` itself derives from
`household_index`. Facility-level grouping is **not** 1:1 with CHW catchment — each
facility groups `CHWS_PER_FACILITY` (default `5`) CHW catchments, which is both
more realistic (a real facility typically serves several community health worker
catchments) and gives real headroom under SC-002's <1% bound (see Rationale):

```
facility_index    = chw_index / CHWS_PER_FACILITY          (default 5)
sub_region_index  = facility_index / FACILITIES_PER_SUB_REGION   (default 50)
region_index      = sub_region_index / SUB_REGIONS_PER_REGION    (default 20)
```

Three `Location` resources per new facility catchment (facility, its sub-region,
its region), each with `Location.partOf` pointing up one level, ID'd
`echis-loc-fac%06d`, `echis-loc-sub%06d`, `echis-loc-reg%06d` — the `fac`/`sub`/`reg`
infix keeps the three ID spaces from colliding despite sharing the same numeric
range, consistent with how existing IDs (`echis-hh`, `echis-p`, `echis-chw`, ...)
already use a type-specific prefix rather than relying on numeric range alone.

**Rationale**: Every value is computable from `household_index` alone (via the
existing `chw_index_for`, then one more division), so it inherits the existing
shard-independence guarantee (FR-004) for free — no new cross-shard coordination,
no new state. `partOf` gives a real, inspectable hierarchy (three levels, matching
the spec's Assumptions default) rather than a flat list with an implied grouping.
`CHWS_PER_FACILITY` / `FACILITIES_PER_SUB_REGION` / `SUB_REGIONS_PER_REGION` are
named constants next to the existing `CHW_CATCHMENT_SIZE = 100`, not spec-mandated
numbers. The grouping is what makes SC-002's <1% bound hold with margin, not just
barely: a naive 1:1 facility-to-CHW-catchment mapping puts facility count alone at
exactly `households / 100` — precisely 1% of the household count, already at
SC-002's boundary before sub-region/region levels are even added on top (a real
inconsistency caught during `/speckit-analyze` — see that report's finding I1).
Grouping 5 CHW catchments per facility drops facility count to `households / 500`
(0.2% of households), and the full three-level hierarchy total (facility +
sub-region + region) to ~0.204% at T5 peak (20,420 / 10,000,000 — see
`data-model.md`'s corrected cardinality formula), comfortably under 1% at every
tier with real margin left for future tuning.

**Alternatives considered**:
- *1:1 facility-to-CHW-catchment mapping (the original decision)*: rejected after
  `/speckit-analyze` showed it violates SC-002 (see above) — facility count alone
  already consumes the entire 1% budget, leaving no room for the sub-region/region
  levels on top.
- *Flat facility list only, no region/sub-region levels*: simpler, but doesn't
  exercise the doc's implied administrative hierarchy at all, and the spec's
  Assumptions explicitly default to three levels.
- *Location.identifier-based hierarchy instead of `partOf` references*: rejected —
  `partOf` is the FHIR-idiomatic way to express a Location hierarchy and costs
  nothing extra to populate.
- *A real named-place gazetteer (actual county/sub-county names)*: rejected as
  unnecessary realism for a synthetic load-test dataset; index-derived names
  (matching `patient_resource`'s `EchisHousehold%08d`-style synthetic naming) are
  sufficient and keep the generator dependency-free.

**Emission redundancy note**: Because a facility groups multiple CHW catchments,
and `Location` emission is guarded the same way as the existing
`PractitionerRole`/`CareTeam` per-CHW block (`emitted_chw_indices`), the same
facility/sub-region/region `Location` resources get redundantly `PUT` once per CHW
catchment within that facility (up to `CHWS_PER_FACILITY` times per shard) — safe
and idempotent (identical content), exactly the same accepted tradeoff already
documented for `PractitionerRole`/`CareTeam` in `docs/echis-data-model.md`, not a
new class of issue. A dedicated `emitted_facility_indices` guard was considered and
rejected as unnecessary bookkeeping for a cost that's already accepted elsewhere in
this generator.

## Decision 2: Catchment tag representation

**Decision**: `meta.tag` entry with `system: "urn:hapi-fhir-deploy:echis-catchment"`,
`code: <facility Location id>` on every `Group`, `Task`, `Patient`, and
`QuestionnaireResponse` resource, tagging with the **facility**-level Location (not
sub-region/region) — the same granularity `chw_index_for` already establishes.

**Rationale**: FR-005 requires a facility-scoped query to return exactly that
facility's resources and exclude others; tagging at the facility level is the
finest granularity available and satisfies broader (sub-region/region) scoping too
if ever needed, since a broader query can `_tag` against the parent via a
`Location?partof=` chain — no need to also tag at every hierarchy level. The
`urn:hapi-fhir-deploy:echis-catchment` system namespace matches the existing
`urn:hapi-fhir-deploy:echis-benchmark` identifier-system naming convention already
used on `Patient.identifier`.

**Alternatives considered**:
- *`_tag=Location/{id}` literal reference-style tag (matching the source doc's
  literal `_tag=Location/{facilityId}` example verbatim)*: FHIR's `meta.tag` is a
  `Coding` (system + code), not a reference — a tag value of `Location/{id}` works
  as an opaque code string and standard `_tag` search matches it, so this remains
  compatible with the doc's documented query shape while using a proper Coding
  system for clarity. Decision 2 keeps the system/code split rather than folding
  everything into the code value, for standard FHIR tag hygiene.
- *Tagging every resource type (also Encounter/Observation/Condition)*: deferred
  per spec Assumptions — out of scope for this iteration.

## Decision 3: Organization and Practitioner cardinality/IDs

**Decision**: One `Organization` (`echis-org000001`, fixed), one `Practitioner` per
CHW (`echis-pr%06d`, same index as `echis-chw%06d`), referenced by
`PractitionerRole.practitioner`. `Practitioner.name` uses the same synthetic-naming
style as `patient_resource`.

**Rationale**: Matches spec Assumptions (single Organization sufficient) and FR-007
(one Practitioner per CHW, distinct from the role). Reusing the CHW index keeps
Practitioner generation folded into the existing per-CHW-catchment emission block
(`emitted_chw_indices`), with no new index space to track.

**Alternatives considered**: Multiple Organizations (e.g., one per region) —
rejected as unnecessary for this iteration per spec Assumptions.

## Decision 4: Verification script approach (FR-011)

**Decision**: A new standalone script, `scripts/verify_echis_catchment_data.rb`,
run once after a seed load against a live FHIR server. It performs a small, fixed
set of read-only queries — a facility-scoped `Group`/`Task`/`Patient`/
`QuestionnaireResponse` search confirming non-empty, catchment-consistent results;
an `Organization` read; a `PractitionerRole` → `Practitioner` reference resolution
— and exits non-zero with a clear message on any failure, matching the
`SeedError`/exit-code convention `echis_seed.rb` and `merge_seed_shards.rb` already
use.

**Rationale**: No existing "verification script" exists to extend — `docs/echis-benchmark-tiers.md`
documents this class of check as ad hoc manual `--metadata-only` runs, not a
committed script (confirmed: no `test/echis_*` files exist today). A small,
single-purpose script matches this repository's existing pattern
(`merge_seed_shards.rb`, `publish_results.rb`) better than folding live-server
assertions into `echis_seed.rb` itself, and keeps FR-011's "one-time correctness
check" cleanly separable from both dataset generation and the k6 load-test
workload (which Clarifications explicitly kept out of scope).

**Alternatives considered**:
- *Extend `echis_seed.rb` with an inline `--verify` flag*: rejected — conflates
  write-path generation with read-path verification in one script, and would run
  on every seed invocation whether wanted or not.
- *A k6 workload operation*: rejected per Clarifications Q1 (out of scope).

## Decision 5: `merge_seed_shards.rb` and metadata reporting (FR-009)

**Decision**: No code change to `scripts/merge_seed_shards.rb` is needed.

**Rationale**: Confirmed by reading its source — it merges `resource_counts` generically
by iterating whatever keys are present (`(section["resource_counts"] || {}).each { |type, count| merged_resource_counts[type] += count.to_i }`),
with no hardcoded resource-type list. `Location`, `Organization`, and `Practitioner`
counts flow through automatically once `echis_seed.rb` adds them to its own
`resource_counts` hash, satisfying FR-009 with zero changes outside `echis_seed.rb`
itself.

**Alternatives considered**: N/A — this is a verified fact about existing code, not
a design choice.

## Decision 6: HAPI FHIR `_tag` search support

**Decision**: No server-side configuration change is required. `_tag` is a standard
FHIR search parameter available on every resource type in HAPI FHIR JPA Server out
of the box; this feature only needs to populate `meta.tag` correctly on write.

**Rationale**: Verified against this repository's existing chart baseline
(`charts/hapi-fhir-deploy/values.yaml`) — no search-parameter customization or
indexing-strategy change (`docs/indexing-strategy.md`, D6) is implicated, since
`_tag` is a base Resource-level parameter, not a custom SearchParameter requiring
Hibernate Search or extra indexing.

**Alternatives considered**: N/A — confirms no additional work item is needed here.
