# Contract: `WORKLOADS` Registry in `benchmarks/k6/lib/fhir_benchmark.js`

## Purpose

Generalize the existing hardcoded `OPERATION_WEIGHTS`/handler set into a registry keyed by workload name, so `generic` (today's behavior) and `echis` (new) coexist without either affecting the other.

## Shape

```js
const WORKLOADS = {
  generic: {
    operationWeights: OPERATION_WEIGHTS,        // unchanged: capability_statement:5, patient_search:18, ...
    handlers: { /* unchanged existing handlers */ },
  },
  echis: {
    operationWeights: {
      household_sync_write: <highest weight>,
      worklist_read: <weight>,
      household_roster_read: <weight>,
      registration_write: <lower weight>,
      supervisor_dashboard_read: <small weight>,
    },
    handlers: { /* new handlers, see below */ },
  },
};

export function benchmarkSetup(profile, workload = "generic") { /* ... */ }
```

## Invariants

1. `benchmarkSetup(profile)` called with no `workload` argument (the existing call signature used by `smoke.js`, `baseline.js`, `load.js`, `stress.js`, `load_100.js`, `load_1000.js`) MUST behave identically to today — `workload` defaults to `"generic"`, and `WORKLOADS.generic` MUST be byte-equivalent in behavior to today's `OPERATION_WEIGHTS`/handlers.
2. Adding `WORKLOADS.echis` MUST NOT require changes to any existing caller of `benchmarkSetup`/`runFhirWorkload`/`benchmarkSummary` outside of the new `echis_load_*.js` files.
3. The request helper MUST support POST/PUT with a JSON body (today's lib is GET-only) — required by `household_sync_write` and `registration_write`. This extension MUST NOT change the signature or behavior of existing GET-only call sites.

## New `echis` operation handlers

| Operation | Method | Target | Notes |
| --- | --- | --- | --- |
| `household_sync_write` | POST (transaction Bundle) | FHIR base root | Bundles an `Encounter` + `Observation` + `Condition` (when applicable) + `QuestionnaireResponse` + a `Task` status update for one household visit. Highest weight — majority of simulated traffic per spec FR-005. |
| `worklist_read` | GET | `Task?owner={chwId}&status=requested` | Simulates a CHW checking their worklist. |
| `household_roster_read` | GET | `Group?_id={id}&_include=Group:member` | Simulates a CHW reviewing their assigned household's members. A `_id` search, not a direct `Group/{id}` instance read — the latter would 404 before the household has been written yet for a given VU, since this workload is self-sufficient against a server with no pre-existing data (no dependency on `scripts/echis_seed.rb`). A search always returns a Bundle (200), empty or not. |
| `registration_write` | POST (transaction Bundle) | FHIR base root | Bundles a new `Patient` + (if new household) `Group` + `RelatedPerson`. Lower weight than `household_sync_write`. |
| `supervisor_dashboard_read` | GET | aggregate/`_summary=count` search | Small, distinct VU subset representing supervisors, not CHWs, per spec Acceptance Scenario US3.3. |

## Executor contract (per `research.md` Decision 7)

`household_sync_write` MUST be assignable to a `ramping-arrival-rate`/`constant-arrival-rate` k6 scenario independent of the `ramping-vus` scenario(s) covering the read-heavy operations — both scenario types coexist in one `options.scenarios` object, following the existing precedent of `baseline`'s `baseline_gates` scenario running alongside its main workload scenario.
