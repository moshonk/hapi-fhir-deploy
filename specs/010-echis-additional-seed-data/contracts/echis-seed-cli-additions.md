# Contract: `scripts/echis_seed.rb` additions + new `scripts/verify_echis_catchment_data.rb`

Additive delta over `specs/008-echis-workload-benchmark/contracts/echis-seed-cli.md`
(unchanged flags/behavior from that contract are not repeated here).

## `scripts/echis_seed.rb` — new flag

| Flag | Type | Default | Notes |
| --- | --- | --- | --- |
| `--include-specimen` | Flag | off | Opt-in per spec Assumptions/FR-008. When set, emits one `Specimen` per individual in the documented rotating subset (see `data-model.md`'s `SPECIMEN_SUBSET_RATIO`). When unset (default), no `Specimen` resources or counts are produced — output is byte-identical to pre-feature behavior for every existing resource type (SC-006). |

All other existing flags (`--households`, `--individuals-per-household`, `--seed`,
`--run-id`, `--metadata`, `--fhir-base-url`, `--batch-size`, `--timeout`,
`--shard-index`, `--shard-count`, `--metadata-only`) are unchanged in meaning and
default.

## `scripts/echis_seed.rb` — output metadata schema delta

`resource_counts` gains new keys, populated the same way as every existing key
(incremented once per resource built, merged generically by
`scripts/merge_seed_shards.rb` with no code change — `research.md` Decision 5):

```json
{
  "echis": {
    "resource_counts": {
      "Group": 10000, "Patient": 30000, "RelatedPerson": 20000,
      "PractitionerRole": 100, "CareTeam": 100,
      "Encounter": 40000, "Observation": 40000, "Condition": 15000,
      "Task": 20000, "QuestionnaireResponse": 25000,

      "Location": 22, "Organization": 1, "Practitioner": 100
      /* "Specimen": <N> only present when --include-specimen is set */
    }
  }
}
```

The example above is for `H = 10,000` (`C = 100` CHW catchments, matching this
contract's existing 008 example numbers). With `CHWS_PER_FACILITY = 5` (default,
per `research.md` Decision 1), facility count `F = ceil(100/5) = 20`, sub-region
count `= ceil(20/50) = 1`, region count `= ceil(1/20) = 1`, so
`Location = 20 + 1 + 1 = 22`. `Location`'s count is the sum across all three
hierarchy levels (facility + sub-region + region), not a separate per-level
breakdown — consistent with how existing cross-shard-redundant types
(`PractitionerRole`/`CareTeam`) are already reported as a single flat count rather
than broken out further.

## Sharding contract (delta)

`Location`, `Organization`, and `Practitioner` follow the same cross-shard
redundancy rule `docs/echis-data-model.md` already documents for
`PractitionerRole`/`CareTeam`: each is derived purely from `chw_index` (itself
derived from the global `household_index`), so any shard touching a given
catchment independently `PUT`s the same content — safe (idempotent) but can
inflate the *reported* per-shard sum when merged, exactly like the existing
`PractitionerRole`/`CareTeam` caveat. `Location` has an additional, larger source
of the same redundancy: because a facility groups `CHWS_PER_FACILITY` (default 5)
CHW catchments, the same facility/sub-region/region `Location` gets redundantly
re-`PUT` once per CHW catchment within it (up to 5x per shard), not just at shard
boundaries — still safe (idempotent), per `research.md` Decision 1's "Emission
redundancy note". `Organization` is emitted once per shard that processes at least
one household (idempotent `PUT` of identical content across shards, same as the
others).

## New script: `scripts/verify_echis_catchment_data.rb`

```text
Usage: scripts/verify_echis_catchment_data.rb --fhir-base-url URL --facility-id ID [--timeout SECONDS]
```

| Flag | Type | Default | Notes |
| --- | --- | --- | --- |
| `--fhir-base-url URL` | URL, required | — | Same role as `echis_seed.rb`'s flag of the same name. |
| `--facility-id ID` | String, required | — | The facility-level `Location` id to verify catchment scoping against (e.g. `echis-loc-fac000000`). |
| `--timeout SECONDS` | Integer | `120` | Same role as `echis_seed.rb`'s flag of the same name. |

**Checks performed** (FR-011; all read-only, no writes):

1. `GET {base}/Location/{facility-id}` resolves (200), and its `partOf` chain resolves up through sub-region and region levels.
2. `GET {base}/Group?_tag=urn:hapi-fhir-deploy:echis-catchment|{facility-id}` returns a non-empty Bundle, and every entry's tag matches `{facility-id}` (no cross-catchment leakage — FR-005).
3. Same check as #2, repeated for `Task`, `Patient`, and `QuestionnaireResponse`.
4. `GET {base}/Organization/echis-org000001` resolves (200).
5. For one `PractitionerRole` found via check #2's `Task.owner`, its `practitioner` reference resolves (200) to a `Practitioner`.

**Exit codes**: `0` on all checks passing with a summary printed to stdout; `1` on
any check failing, with a clear per-check failure message on stderr — same
convention as `echis_seed.rb` and `merge_seed_shards.rb`.

**Out of scope**: this script performs a fixed, small number of checks once after
a seed run; it is not a load-test workload and is not invoked by
`benchmarks/k6/lib/fhir_benchmark.js` (Clarifications Q1).
