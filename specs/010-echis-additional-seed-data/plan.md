# Implementation Plan: eCHIS Additional Seed Datasets (Location, Tags, Reference Data)

**Branch**: `010-echis-additional-seed-data` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-echis-additional-seed-data/spec.md`

## Summary

Extend `scripts/echis_seed.rb` (spec 008's household/CHW generator) with a small,
deterministic facility-catchment hierarchy (`Location`), a `meta.tag` on `Group`,
`Task`, `Patient`, and `QuestionnaireResponse` referencing that catchment, and
low-cardinality `Organization`/`Practitioner` reference data — closing the gap
between the current dataset and the facility-scoped, first-sync-reference-data
access patterns documented in the "OHS FHIR Sync — API Call Inventory" source
document. Additive only: no existing resource shape, ID, or cardinality from
`008-echis-workload-benchmark` changes. A new post-seed verification script proves
the new data is reachable; no k6 workload changes (per Clarifications).

## Technical Context

**Language/Version**: Ruby 3.3 (matches `scripts/echis_seed.rb`'s existing shebang and the CI-pinned `ruby-version: "3.3"` in `.github/workflows/ci.yml`; no new language introduced).

**Primary Dependencies**: None beyond Ruby stdlib (`json`, `net/http`, `optparse`, `set`, `time`, `uri`, `fileutils`) — matches `scripts/echis_seed.rb`'s existing zero-gem-dependency convention.

**Storage**: External PostgreSQL-backed HAPI FHIR server (existing deployment target); this feature only changes what the seed generator PUTs via transaction Bundles, not the storage layer itself.

**Testing**: Ruby's bundled `Test::Unit`-style scripts run directly (`ruby test/*_test.rb`), matching `test/synthea_loader_http_test.rb` / `test/publish_results_test.rb`'s existing convention; CI runs them via `.github/workflows/ci.yml`. No prior automated test exists for `scripts/echis_seed.rb` at all (spec 008 relied on manual `--metadata-only` verification, per `docs/echis-benchmark-tiers.md`) — this feature adds the first one, both for its own new resource types and as an opportunity to close that pre-existing gap for the resource-count/ID-scheme logic it touches.

**Target Platform**: Linux server / CLI (no new platform — runs anywhere `scripts/echis_seed.rb` already runs: locally, in `manifests/seed-job/echis-seed-job.yaml`, or via `scripts/lab`).

**Project Type**: CLI tool extension (single script + a new companion verification script), within an existing Helm/Kubernetes deployment-tooling repository.

**Performance Goals**: Facility-hierarchy generation and tagging MUST NOT materially change `scripts/echis_seed.rb`'s existing per-household throughput — the hierarchy is reference data (SC-002: <1% of household count), and tagging is O(1) per resource already being built, so no new per-resource HTTP calls or lookups are introduced.

**Constraints**: Deterministic, shard-independent ID and catchment-tag derivation (FR-002, FR-004) — every shard must compute the same facility hierarchy and tag assignments from global indices alone, with no cross-shard coordination, consistent with the existing CHW-catchment-derivation guarantee `scripts/echis_seed.rb` already provides.

**Scale/Scope**: Facility-hierarchy entry count tracks CHW-catchment count grouped by `CHWS_PER_FACILITY` (`households / (CHW_CATCHMENT_SIZE * CHWS_PER_FACILITY)`, i.e. ≈20,000 facility-level entries at T5 peak — see `data-model.md`'s corrected cardinality formula), plus a small fixed number of aggregation levels above it and a single `Organization` record — all several orders of magnitude below the 10M–30M household/individual scale.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

This repository's constitution (`.specify/memory/constitution.md`) is scoped to the Helm/Kubernetes deployment baseline (chart-first deployment, external PostgreSQL, version pinning, observability, bounded autoscaling). This feature touches none of those surfaces — it only adds resource-generation logic to an existing Ruby CLI script and a new verification script; no chart, manifest, Helm value, container image, or autoscaling behavior changes.

| Principle | Applies? | Assessment |
|---|---|---|
| I. Chart-First Deployment | No | No Helm chart or manifest changes. |
| II. Explicit External PostgreSQL | No | No datasource/Secret changes; still writes via the FHIR HTTP API like the existing generator. |
| III. Version Pinning and Reproducibility | Yes | No new dependencies introduced (Ruby stdlib only); Ruby version already pinned in CI. Deterministic ID/tag derivation is itself a reproducibility requirement (FR-002, FR-004), directly upheld by this feature's design. |
| IV. Observable and Operable Runtime | No | No runtime/Actuator/Micrometer changes; this is dataset-generation tooling, not the FHIR server runtime. |
| V. Bounded Scale and Safe Rollouts | No | No replica, Hikari pool, or autoscaling changes. Facility-hierarchy write volume is reference-data scale (SC-002), so it does not materially change the connection-budget math `docs/autoscaling.md` already accounts for. |

**Result**: PASS. No violations; Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/010-echis-additional-seed-data/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── echis-seed-cli-additions.md   # Phase 1 output: additive CLI/metadata-schema delta over 008's echis-seed-cli.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
scripts/
├── echis_seed.rb                 # MODIFIED: add Location hierarchy, Organization,
│                                  #   Practitioner generation; add meta.tag to
│                                  #   Group/Task/Patient/QuestionnaireResponse;
│                                  #   extend resource_counts/metadata reporting.
├── merge_seed_shards.rb          # UNCHANGED: already merges resource_counts
│                                  #   generically by resourceType key, so new
│                                  #   types (Location/Organization/Practitioner)
│                                  #   merge with no code change (verified in
│                                  #   research.md).
└── verify_echis_catchment_data.rb  # NEW: post-seed verification script (FR-011)
                                     #   — queries a live FHIR server for
                                     #   facility-scoped reachability and
                                     #   Organization/Practitioner resolvability.

test/
└── echis_seed_test.rb            # NEW: first automated test for
                                     #   scripts/echis_seed.rb (--metadata-only
                                     #   mode), covering both pre-existing
                                     #   resource-count logic and this
                                     #   feature's additions.

specs/008-echis-workload-benchmark/
└── (unchanged — this feature does not modify 008's artifacts; see
    specs/010-echis-additional-seed-data/contracts/echis-seed-cli-additions.md
    for the additive delta instead)

docs/
└── echis-data-model.md           # MODIFIED: append a section documenting the
                                     #   new resource shapes, matching its
                                     #   existing implementation-memo format.

.github/workflows/ci.yml           # MODIFIED: add a step running the new
                                     #   test/echis_seed_test.rb (and a
                                     #   --metadata-only smoke invocation),
                                     #   matching the existing
                                     #   synthea_loader/publish_results CI steps.

README.md                          # MODIFIED: update the scripts/echis_seed.rb
                                     #   and docs/echis-data-model.md repository-map
                                     #   entries, and add scripts/verify_echis_
                                     #   catchment_data.rb — required by the
                                     #   constitution's README/docs sync rule
                                     #   (caught during /speckit-analyze, finding C1).
```

**Structure Decision**: Single-project CLI-tooling layout (matches the rest of this repository — flat `scripts/`, `test/`, `docs/`; no web/mobile split applies). This feature modifies one existing script (`scripts/echis_seed.rb`) additively, adds one new small verification script, and adds this repository's first automated test coverage for the eCHIS generator — no new top-level directories.

## Complexity Tracking

*Not applicable — Constitution Check passed with no violations.*
