# Phase 1 Data Model: eCHIS Additional Seed Datasets

Additive to `specs/008-echis-workload-benchmark/data-model.md` and
`docs/echis-data-model.md` — this document covers only the new entities and the
field additions this feature makes to existing 008 resource shapes. All ID
formats, indices, and constants referenced below (`chw_index_for`,
`CHW_CATCHMENT_SIZE`, `echis-chw%06d`, etc.) are the existing ones from
`scripts/echis_seed.rb`; see `docs/echis-data-model.md` for their full definitions.

## New entities

### Facility Catchment Hierarchy (`Location` × 3 levels)

- **Fields**: `id` (`echis-loc-fac%06d` / `echis-loc-sub%06d` / `echis-loc-reg%06d`,
  zero-padded facility/sub-region/region index — 6 digits, since even the ~20,000
  facility-level entries at T5 peak fit comfortably), `status: "active"`,
  `name` (index-derived synthetic name, e.g. `format("Facility Catchment %06d", facility_index)`),
  `physicalType` (a small fixed CodeableConcept distinguishing facility/sub-region/region levels — see `research.md` Decision 1 for the SNOMED/v3-jurisdiction coding options),
  `partOf` (reference to the next level up; the region-level entry has no `partOf`).
- **Relationships**: `CHWS_PER_FACILITY` (default 5) CHW catchments share one facility-level entry — **not** a 1:1 mapping (see `research.md` Decision 1, which corrects an earlier 1:1 design that violated SC-002's <1% bound). `FACILITIES_PER_SUB_REGION` (default 50) facility entries share one sub-region entry; `SUB_REGIONS_PER_REGION` (default 20) sub-region entries share one region entry — all three derived by chained integer division of `chw_index`, per `research.md` Decision 1.
- **Cardinality at T5 peak**: ~20,000 facility-level (`households / 500`), ~400 sub-region-level, ~20 region-level — 20,420 total, ~0.204% of the 10,000,000 household count, comfortably under SC-002's <1% bound.

### Organization

- **Fields**: `id` (`echis-org000001`, fixed single ID), `active: true`, `name` (a fixed synthetic implementing-organization name), `type` (a small fixed CodeableConcept, e.g. `prov`/"Healthcare Provider").
- **Relationships**: Not referenced by other generated resources in this iteration (no `PractitionerRole.organization` or `Location.managingOrganization` link) — kept minimal per spec Assumptions (single Organization is reference data, not a linkage target other resources depend on for reachability).
- **Cardinality**: 1, fixed, independent of every other count.

### Practitioner

- **Fields**: `id` (`echis-pr%06d`, same index as the existing `echis-chw%06d` `PractitionerRole`), `active: true`, `name` (synthetic name, same style as `patient_resource`'s `EchisHousehold%08d`/`Member%08d` naming).
- **Relationships**: Referenced by exactly one `PractitionerRole.practitioner` (the existing CHW role resource, unchanged shape otherwise). 1:1 with the existing `PractitionerRole`/`CareTeam` pair.
- **Cardinality at T5 peak**: ~100,000 (matches existing CHW/`PractitionerRole` count).

### Specimen (optional, default disabled)

- **Fields**: `id` (`echis-spec%08d`, individual index), `status: "available"`, `subject` (Patient reference), `type` (a small fixed CodeableConcept, e.g. a rotating LOINC specimen-type code), `collection.collectedDateTime` (matches the individual's `Encounter` date).
- **Relationships**: Belongs to exactly one individual (`Patient`); generated for a documented rotating subset (mirrors the existing `Condition`/`Task` every-Nth-individual pattern) only when explicitly enabled via CLI flag.
- **Cardinality**: 0 when disabled (default); a documented fraction of the individual count when enabled (exact ratio set at implementation time in `tasks.md`, consistent with SC-006's "matches the documented rotating-subset ratio within 1%").

## Field additions to existing (008) resources

### `Group` (household), `Task`, `Patient`, `QuestionnaireResponse` — `meta.tag`

Each of these four resource types gains one `meta.tag` entry:
`{ "system": "urn:hapi-fhir-deploy:echis-catchment", "code": "<facility Location id>" }`,
where the facility Location id is the one derived from that resource's owning
household's `chw_index` via `facility_index_for(chw_index)` (see `research.md`
Decision 1/2 — a facility groups `CHWS_PER_FACILITY` CHW catchments, so several
households across different CHWs share the same facility tag). No other field on these
four resource shapes changes — their existing `id` format, required fields, and
cardinality (as documented in `docs/echis-data-model.md`) are unchanged, per spec
FR-010.

### `PractitionerRole` (CHW) — `practitioner` reference

Gains one field: `practitioner` (reference to the new `Practitioner/echis-pr%06d`
resource, same index as the role itself). No other field changes; `code`, `id`
format, and cardinality are unchanged.

## Cardinality formula (delta over `docs/echis-data-model.md`)

For household count `H` (existing formula: `total_generated_entry_count = 16*H +
2*ceil(H/100) + ceil(H*3/2)`), this feature adds, with `C = ceil(H/100)` (existing
CHW-catchment count):

```
F                        = ceil(C / CHWS_PER_FACILITY)         (facility count; CHWS_PER_FACILITY default 5)
Location (facility)     = F
Location (sub-region)   = ceil(F / FACILITIES_PER_SUB_REGION)
Location (region)       = ceil(ceil(F / FACILITIES_PER_SUB_REGION) / SUB_REGIONS_PER_REGION)
Organization            = 1
Practitioner            = C                                    (still 1 per CHW, unaffected by facility grouping)
Specimen (if enabled)   = floor(H*3 / SPECIMEN_SUBSET_RATIO)   (0 when disabled)

added_entry_count = F (facility Location) + Location(sub-region) + Location(region)
                     + 1 (Organization) + C (Practitioner) + Specimen (if enabled)
                   ≈ F + C + O(F / FACILITIES_PER_SUB_REGION) + 1   (Specimen excluded, disabled by default)
```

At T5 peak (`H = 10,000,000`, `C = 100,000`, `F = 20,000`): `Location = 20,000 +
400 + 20 = 20,420` (~0.204% of `H`, comfortably under SC-002's <1% bound —
correcting an earlier 1:1-facility-to-CHW design that put facility count alone at
exactly 1% of `H`, leaving no room for the sub-region/region levels; see
`research.md` Decision 1), `Organization = 1`, `Practitioner = 100,000` →
`added_entry_count = 120,421` against the existing 175,200,000 total — a ~0.069%
increase, negligible against the existing peak total.

## References

- `docs/echis-data-model.md` — implementation-level shapes for all resources this feature builds on and does not modify.
- `specs/008-echis-workload-benchmark/data-model.md` — planning-level entity description for the household/CHW model this feature extends.
- `research.md` (this feature) — technical decisions (ID scheme, tag representation, verification approach) behind the entities above.
