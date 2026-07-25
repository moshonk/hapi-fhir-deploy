# eCHIS Progressive Benchmark Tiers (T2-T5)

Extends the existing `load_100.js` / `load_1000.js` 10x-per-tier convention (see
`docs/benchmark-lab-runbook.md`) with the eCHIS household/CHW workload
(`benchmarks/k6/lib/fhir_benchmark.js`'s `echis` workload, `scripts/echis_seed.rb`'s
generated dataset). Household ratio is held constant at 3 individuals/household.
Household counts below are chosen so the resulting individual count is as close as
possible to a round 100K/1M/10M/30M target; because 100K/1M/10M are not evenly
divisible by 3, T2-T4's actual individual/total-record counts come out slightly
below the round target (documented in the "Individuals"/"Total records" columns
below, which are the *actual* `scripts/echis_seed.rb` output for the documented
`--households` invocation, not the illustrative round numbers). T5's household and
individual counts match `specs/008-echis-workload-benchmark/data-model.md`'s peak
budget exactly (10,000,000 / 30,000,000); T5's total record count (175,200,000)
differs from that document's illustrative 180,000,000 budget because the
implemented generator's per-resource-type ratios (see `resources_for_household` in
`scripts/echis_seed.rb`) don't match that document's illustrative Encounter/
Observation/Task/QuestionnaireResponse split exactly -- 175,200,000 is what the
generator actually produces at T5 scale, not a target to hit.

| Tier | k6 script | VUs (concurrency target) | Households (`--households`) | Individuals (actual) | Total records (actual) | Dataset generator | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T2 | `benchmarks/k6/echis_load_100.js` | 100 | 33,333 | 99,999 | 583,996 | `scripts/echis_seed.rb --households 33333` | Runnable today, no spec 007 dependency |
| T3 | `benchmarks/k6/echis_load_1000.js` | 1,000 | 333,333 | 999,999 | 5,839,996 | `scripts/echis_seed.rb --households 333333` | Runnable today, no spec 007 dependency |
| T4 | `benchmarks/k6/echis_load_10000.js` | 10,000 | 3,333,333 | 9,999,999 | 58,399,996 | `scripts/echis_seed.rb --households 3333333` (sharded, see US4) | **Blocked** on `specs/007-pgbouncer-connection-pooling`'s pooled connection tier being deployed and load-tested |
| T5 (peak) | `benchmarks/k6/echis_load_100000.js` | 100,000 | 10,000,000 | 30,000,000 | 175,200,000 | `scripts/echis_seed.rb --households 10000000` (sharded, see US4) | **Blocked** on the same spec 007 dependency, plus distributed k6 execution (see US4) |

Verified locally: `scripts/echis_seed.rb --households {33333,333333} --individuals-per-household 3 --metadata-only`
produces `generated_entry_count` of 583,996 and 5,839,996 respectively (T4/T5's counts
follow the same formula, confirmed by hand: `16*households + 2*ceil(households/100) +
ceil(3*households/2)`, matching a `--households 10` control run producing 177 exactly).

## Required execution order

Run tiers strictly in order: T2 -> T3 -> T4 -> T5. Do not skip to T4/T5 without T2/T3
passing first, per the original benchmark design's calibration-before-scale principle
(`specs/008-echis-workload-benchmark/plan.md`). `scripts/lab benchmark` enforces this
mechanically via the `--echis-tier` flag (see below); running a tier's k6 script
directly with `k6 run` bypasses the guard, so always prefer `scripts/lab benchmark`
for tier runs that need the sequencing/dependency checks enforced.

## Why T4/T5 are blocked

Both T4 and T5 exceed the native connection-budget ceiling documented in
`docs/autoscaling.md` (`maxReplicas <= floor((max_connections - reserved) / hikari_maximum_pool_size)`,
5 replicas max on the unmodified base `values.yaml`). Running either tier against the
native tier would either throttle far below the target concurrency or exhaust
PostgreSQL connections. Both require the PgBouncer pooled tier
(`charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml`, `enable_pgbouncer: true`) to be
deployed and its provisional pooled-formula ceiling validated against real T4 load,
per `specs/007-pgbouncer-connection-pooling/spec.md`.

## `scripts/lab benchmark --echis-tier` sequencing guard

`scripts/lab benchmark` accepts an optional `--echis-tier T2|T3|T4|T5` flag:

- **T4/T5**: refuses to run unless `LAB_ECHIS_POOLED_TIER_CONFIRMED=true` is set,
  an explicit operator attestation that the PgBouncer pooled tier has been deployed
  (`enable_pgbouncer: true` applied via `ansible/playbooks/15-deploy-pgbouncer.yml`)
  and its connection budget validated for the target tier's replica count.
- **T3/T4/T5**: refuses to run unless the immediately preceding tier (T2, T3, T4
  respectively) has already completed successfully, tracked in
  `ansible/artifacts/lab/echis-tier-progress.json`. A successful `scripts/lab
  benchmark --echis-tier TN` run appends `TN` to that file.
- `--dry-run` logs what the guard would check without enforcing it (consistent with
  every other `scripts/lab` dry-run behavior).

Example T2 run (using the established `K6_SCRIPT` override convention from
`docs/lab-cli.md`):

```sh
FHIR_BASE_URL=http://localhost:8080/fhir \
K6_SCRIPT=benchmarks/k6/echis_load_100.js \
scripts/lab benchmark --profile load --echis-tier T2 --run "$RUN_ID"
```

## T2 re-run status (T011)

The original task plan calls for re-running T2 against a live server once the
`echis` workload and `echis_seed.rb` generator exist, to close the same
never-executed-at-scale gap that `load_1000.js` had before this work. This sandbox
has no reachable Kubernetes cluster or live FHIR server (kubectl client only, no
cluster context), so that live run could not be performed here. What was verified
locally instead, consistent with every other task in specs 007/008 that needed
infrastructure this sandbox doesn't have:

- `node --check` on all four new `echis_load_*.js` scripts (syntax only; the `k6`
  module imports cannot resolve outside the k6 runtime).
- An isolated Node reimplementation of the `dispatchOperation`/
  `runFhirWorkloadExcluding` logic in `benchmarks/k6/lib/fhir_benchmark.js`,
  confirming the excluded operation (`household_sync_write`) is never drawn by the
  `ramping-vus` scenario and remains reachable via the dedicated
  `ramping-arrival-rate` scenario.
- `scripts/echis_seed.rb --households 33333 --individuals-per-household 3
  --metadata-only` (T2-scale dry run) to confirm the generator produces the
  expected resource counts at T2 scale without needing a live FHIR endpoint.

A live T2 run against a real cluster remains an open action item for whoever has
cloud access, tracked against issue #43.

## `handleSummary` fields

Each `echis_load_*.js` script stamps, in addition to the existing
`concurrency_target`/`patient_load_target` fields `load_100.js`/`load_1000.js`
already use:

- `individual_load_target` — target individual (Patient) count for the tier.
- `household_load_target` — target household (Group) count for the tier.
- `total_record_load_target` — target total FHIR resource count for the tier,
  per the illustrative budget in `data-model.md`.

## Executor design (dual-scenario, per `research.md` Decision 7)

Each `echis_load_*.js` script runs two scenarios: a `ramping-vus` `fhir_workload`
scenario (all `echis` operations except `household_sync_write`, dispatched via
`runFhirWorkloadExcluding(data, "household_sync_write")`), and a
`ramping-arrival-rate` `household_sync` scenario (only `household_sync_write`, via
`runHouseholdSyncWrite(data)`), modeling a CHW device's end-of-day sync burst as an
arrival process independent of the read/registration VU pool, rather than tying
sync traffic to the same open concurrent-VU connections.
