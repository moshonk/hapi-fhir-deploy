# eCHIS FHIR Resource Shape Memo

Status: Implemented (spec 008, User Story 2)

Issue: #44

Decision: Household/CHW FHIR resource model as implemented in `scripts/echis_seed.rb`, generalizing `scripts/minimal_fhir_seed.rb`'s deterministic, index-derived generation style to household/CHW linkage.

## Context

`specs/008-echis-workload-benchmark/data-model.md` describes the eCHIS resource model at a planning level (entities, relationships, illustrative cardinality budget). This memo is the implementation-level companion — the actual FHIR resource shapes, field values, and ID scheme `scripts/echis_seed.rb` emits, so a reader can go from "what does a generated `Task` actually look like" to the exact code without re-deriving it from the generator source. It mirrors `docs/indexing-strategy.md`'s status/decision-record format, adapted for a resource-shape reference rather than a competing-options architecture decision (there is no alternative option being weighed here — this documents what was built and accepted in PR #54).

## Deterministic ID scheme

All IDs are derived only from a global household or individual index, never from `--shard-index`, so re-running a single shard reproduces byte-identical output and shards never collide on IDs regardless of run order (`contracts/echis-seed-cli.md`'s sharding contract).

| Resource | ID format | Derived from |
| --- | --- | --- |
| `Group` (household) | `echis-hh%08d` | household index |
| `Patient` | `echis-p%08d` | individual index (`household_index * individuals_per_household + offset`) |
| `RelatedPerson` | `echis-rp%08d` | individual index |
| `PractitionerRole` (CHW) | `echis-chw%06d` | CHW index (`household_index / 100`) |
| `CareTeam` | `echis-ct%06d` | CHW index |
| `Encounter` | `echis-enc%08d` | individual index |
| `Observation` | `echis-obs%08d` | individual index |
| `Condition` | `echis-cond%08d` | individual index |
| `QuestionnaireResponse` | `echis-qr%08d` | individual index |
| `Task` | `echis-task%08d` | individual index |

Every write is a `PUT {ResourceType}/{id}` inside a `type: transaction` Bundle (idempotent upsert), the same pattern `minimal_fhir_seed.rb` established.

## Resource shapes

### `Group` (household)

`type: "person"`, `actual: true`, `quantity` (member count), `member[]` — a `Patient` reference per household member (`entity.reference`, not a `RelatedPerson` reference — the household roster is Patient-based). No `characteristic[]`/catchment `Location` reference in the current implementation (deferred, see data-model.md's note that this was left as an implementation detail).

### `Patient` (individual)

Same core shape as `minimal_fhir_seed.rb`'s `patient_resource`: `identifier` (system `urn:hapi-fhir-deploy:echis-benchmark`), `active: true`, `name`, `gender` (alternates even/odd index), `birthDate` (index-derived, birth years starting 1950). No explicit household-linkage extension — the relationship is one-directional via `Group.member`, not a back-reference on `Patient` itself (an implementation choice `data-model.md` left open; this generator chose the simpler one-directional form).

### `RelatedPerson`

Emitted for every household member **except the first** (offset 0, the household head) — so `individuals_per_household - 1` per household, not 1:1 with `Patient`. `patient` references the household head's `Patient/{id}` (not the dependent's own record — `RelatedPerson.patient` is the FHIR-correct pointer to whose record this related person is related to). `relationship` is a fixed `C`/"Emergency Contact" coding; not modeling real household relationship types (parent/child/spouse) is a deliberate simplification.

### `PractitionerRole` + `CareTeam` (Community Health Worker)

One CHW catchment per 100 households (`CHW_CATCHMENT_SIZE = 100` in `scripts/echis_seed.rb`), keyed by `household_index / 100` so every shard independently computes the same CHW ID for a given household without cross-shard coordination. `PractitionerRole.code` is a fixed `chw`/"Community Health Worker" coding (no `practitioner` reference to a distinct `Practitioner` resource — the CHW's identity IS the `PractitionerRole`, another deliberate simplification). `CareTeam.participant[0].member` references the `PractitionerRole`.

**Cross-shard redundancy**: a CHW catchment can straddle a shard boundary. Each shard that touches it independently `PUT`s the same `PractitionerRole`/`CareTeam` once — safe (idempotent, identical content) but inflates the *reported* per-shard `resource_counts` sum for these two types specifically when multiple shards' metadata are merged (`scripts/merge_seed_shards.rb`). Never affects `Group`/`Patient`/`Encounter`/`Observation`/`Condition`/`Task`/`QuestionnaireResponse` counts, which are exclusively owned by one shard's contiguous household range.

### `Encounter` (visit record)

`status: "finished"`, `class` coding `HH`/"home health" (not `AMB`, since `minimal_fhir_seed.rb`'s generic workload uses `AMB` for ambulatory visits — this is a home-visit-appropriate code per `data-model.md`'s guidance), `subject`, `period` (index-derived 2025 date, 09:00-09:15). One per individual (1:1).

### `Observation`

One of three rotating vitals/nutrition codes (`OBSERVATION_CODES`: LOINC 8867-4 heart rate, 8302-2 body height, 29463-7 body weight), selected by `individual_index % 3`. `effectiveDateTime` matches the individual's `Encounter` date. One per individual (1:1).

### `Condition`

One of three rotating SNOMED codes (`CONDITION_CODES`: 38341003 hypertensive disorder, 73211009 diabetes mellitus, 271737000 anemia), selected by `individual_index % 3`. `verificationStatus` is `unconfirmed` (a risk flag, not a confirmed diagnosis — matches `data-model.md`'s "risk flag or diagnosis" framing). Emitted for **even-indexed individuals only** — not 1:1, per `data-model.md`.

### `QuestionnaireResponse`

`status: "completed"`, `subject`, `encounter` (references the individual's own `Encounter` — establishes encounter-level context per the R4 spec, per `data-model.md`'s note). Fixed single-item structure (`danger-signs` boolean, always `false`) — intentionally simple, not the full WHO SMART Guidelines questionnaire structure. One per individual (1:1).

### `Task` (worklist/referral item)

`status: "requested"` (matters: `worklist_read`'s k6 handler queries `Task?owner={chwId}&status=requested`, per `contracts/workloads-registry.md` — a mismatched status here would make the worklist read find nothing), `intent: "order"`, `for` (Patient reference), `owner` (the individual's CHW `PractitionerRole` reference). Emitted for **every third individual** (`individual_index % 3 == 0`) — not 1:1, per `data-model.md`.

## Cardinality formula

For household count `H` and the fixed `individuals_per_household = 3` default:

```
individuals              = H * 3
Group                    = H
Patient                  = H * 3
RelatedPerson             = H * 2
PractitionerRole/CareTeam = ceil(H / 100)  (each)
Encounter/Observation/QuestionnaireResponse = H * 3  (each)
Condition                 = ceil(H * 3 / 2)
Task                      = H * 3 / 3 = H  (always exact, since H*3 is always divisible by 3)

total_generated_entry_count = 16*H + 2*ceil(H/100) + ceil(H*3/2)
```

Verified against real generator output at three scales (`docs/echis-benchmark-tiers.md`'s tier table): `H=10` → 177 entries, `H=33333` → 583,996, `H=333333` → 5,839,996, `H=3333333` → 58,399,996, `H=10000000` → 175,200,000.

## Known deviation from the illustrative budget

`data-model.md`'s "illustrative resource-type budget" for the T5 peak (Patient 30M, Group 10M, Encounter 40M, Observation 40M, Condition 15M, Task 20M, QuestionnaireResponse 25M = 180M) does not match this generator's actual per-resource-type ratios (Encounter/Observation/QuestionnaireResponse are 1:1 with individuals — 30M each, not 40M/40M/25M; Task is 1:3 — 10M, not 20M; RelatedPerson, at 20M, was explicitly called out in `data-model.md` as "reference/master data at much lower cardinality... not part of this 180M budget," which this generator's implementation doesn't hold to). The generator's real total at T5 scale is 175,200,000, not 180,000,000 — a ~2.7% difference, documented and accepted in `docs/echis-benchmark-tiers.md` and the PR #55 review that surfaced it. This memo does not reopen that already-reviewed, already-merged tradeoff; it records it so a future reader isn't surprised the two numbers don't match.

## References

- `specs/008-echis-workload-benchmark/data-model.md` — planning-level entity/relationship description this memo implements.
- `specs/008-echis-workload-benchmark/contracts/echis-seed-cli.md` — CLI contract, sharding contract, output metadata schema.
- `specs/008-echis-workload-benchmark/contracts/workloads-registry.md` — how these resources are read/written by the k6 `echis` workload.
- `docs/echis-benchmark-tiers.md` — tier-level dataset sizing built on this data model.
