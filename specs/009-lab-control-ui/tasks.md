---

description: "Task list for 009-lab-control-ui"

---

# Tasks: Lab Control UI

**Input**: Design documents from `/specs/009-lab-control-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/cli-action-map.md, quickstart.md

**Tests**: Not explicitly requested as TDD in the spec. A proportionate set of unit/integration tests is included per `research.md` §9's testing decision, embedded in each phase's implementation tasks rather than as a separate write-first TDD block.

**Organization**: Tasks are grouped by user story (spec.md priorities P1-P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5, matching spec.md)
- Paths below follow plan.md's Project Structure: `lab-control-ui/backend/`, `lab-control-ui/frontend/`, plus the additive `scripts/lab`/`docs/` changes research.md §5 calls for.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding for the new `lab-control-ui/` application.

- [X] T001 Create `lab-control-ui/backend/` and `lab-control-ui/frontend/` directory skeletons per `plan.md`'s Project Structure
- [X] T002 [P] Initialize backend TypeScript/Node 22 project (`package.json` pinned to exact versions, `tsconfig.json`, Express, `node:sqlite` types, `vitest`) in `lab-control-ui/backend/`, committing `package-lock.json`
- [X] T003 [P] Initialize frontend React 18 + TypeScript + Vite project (`package.json` pinned, `vitest` + `@testing-library/react`) in `lab-control-ui/frontend/`, committing `package-lock.json`
- [X] T004 [P] Configure ESLint + Prettier for both `lab-control-ui/backend/` and `lab-control-ui/frontend/`
- [X] T005 [P] Add `lab-control-ui/*/dist/`, `lab-control-ui/*/node_modules/`, and `ansible/artifacts/lab/ui/` to `.gitignore`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure every user story depends on — including the shared-secret auth gate (FR-013), which the spec ranks as its own lower-priority story (US4) for *value-narrative* purposes but which every other story requires as working infrastructure to be exercised through the real, login-gated app.

**⚠️ CRITICAL**: No user story phase can be considered done-and-demoable until this phase is complete.

- [X] T006 Extend `check_lab_prerequisites()` in `scripts/lab` to also verify the pinned Ansible collections from `ansible/requirements.yml` are installed (not just that `ansible-playbook`/`ansible-galaxy` binaries exist), then add a `scripts/lab doctor --cloud gcp|aws|azure [--format json]` subcommand that calls this one, extended function directly, always exits `0`, and (with `--format json`) emits one `{id, label, status, detail}` record per check instead of the current log-and-die behavior (research.md §5 — single source of truth for prerequisite checks, reused by both `up` and `doctor`)
- [X] T007 [P] Document the `doctor` subcommand in `docs/lab-cli.md`
- [X] T008 [P] Define the `ProviderAdapter`/`ConfigField`/`ActionDef`/`PrerequisiteCheckDef` TypeScript interfaces in `lab-control-ui/backend/src/providers/types.ts` (data-model.md)
- [X] T009 [P] Implement the GCP `ProviderAdapter` (full config field table with defaults, action list) in `lab-control-ui/backend/src/providers/gcp.ts`, matching `data-model.md`'s GCP field table and `contracts/cli-action-map.md` exactly
- [X] T010 Implement `node:sqlite` schema init (`lab_configurations`, `action_runs` tables) in `lab-control-ui/backend/src/db/schema.ts`, writing to `ansible/artifacts/lab/ui/lab-control-ui.db`
- [X] T011 [P] Implement DB access layer (CRUD for `lab_configurations`, `action_runs`) in `lab-control-ui/backend/src/db/queries.ts`
- [X] T012 Implement shared-secret auth: `POST /api/auth/login`/`logout` routes, constant-time secret comparison (`crypto.timingSafeEqual`), in-memory session store, and session-check middleware applied to all other routes, in `lab-control-ui/backend/src/auth/`
- [X] T013 Implement the Express app skeleton — env config (`LAB_UI_SHARED_SECRET`, `LAB_UI_PORT`, `LAB_REPO_ROOT` auto-detected via git root), route mounting, and static serving of the built frontend — in `lab-control-ui/backend/src/server.ts`. The process MUST refuse to start (nonzero exit, clear error) if `LAB_UI_SHARED_SECRET` is unset or empty (spec.md Edge Case 5 — never fail open).
- [X] T014 Implement the action runner core — `child_process.spawn` of `scripts/lab` with `cwd=LAB_REPO_ROOT`, stdout/stderr teed to `ansible/artifacts/lab/ui/runs/<actionRunId>.log`, a per-`(labId, actionName)` in-memory concurrency lock, and exit-code-to-status (`0`→succeeded, nonzero→failed) mapping — in `lab-control-ui/backend/src/actions/runner.ts`
- [X] T015 [P] Implement the CLI argument/command builder mapping `ConfigField` values to the exact `scripts/lab` invocation per `contracts/cli-action-map.md`, in `lab-control-ui/backend/src/actions/commandBuilder.ts`
- [X] T016 [P] Unit test: `commandBuilder` produces the exact invocation string for every row of `contracts/cli-action-map.md`, in `lab-control-ui/backend/test/unit/commandBuilder.test.ts`
- [X] T017 [P] Create a stub `scripts/lab` test double (records its invocation, emits scripted stdout/stderr lines with configurable delay, exits with a configurable code) for integration tests, in `lab-control-ui/backend/test/fixtures/stub-lab.sh`

**Checkpoint**: Foundation ready — auth, storage, provider registry, and process-spawning core all exist; user story phases can now build on top.

---

## Phase 3: User Story 1 - First-Time Operator Reaches a Runnable Configuration Fast (Priority: P1) 🎯 MVP

**Goal**: Autofilled configuration form where only `project_id` blocks, with a live command preview.

**Independent Test**: Load the UI with no prior state, fill in only the project ID, confirm every other field already holds a valid default that would produce a runnable `up` invocation.

### Implementation for User Story 1

- [X] T018 [P] [US1] `GET /api/providers` route serving the registered `ProviderAdapter`s' public shape, in `lab-control-ui/backend/src/routes/providers.ts`
- [X] T019 [P] [US1] `POST /api/labs`, `GET /api/labs`, `PATCH /api/labs/:id` routes — default-filling omitted fields and deriving `launchable` from `ConfigField.required` — in `lab-control-ui/backend/src/routes/labs.ts`
- [X] T020 [US1] `GET /api/labs/:id/preview?action=` route using the same `commandBuilder` the trigger endpoint will use (T015), in `lab-control-ui/backend/src/routes/labs.ts` (depends on T015, T019)
- [X] T021 [P] [US1] Integration test: `POST /api/labs` with only `project_id` set returns every other field defaulted and `launchable:true`; omitting `project_id` returns `launchable:false`, in `lab-control-ui/backend/test/integration/labs.test.ts`
- [X] T022 [P] [US1] Config form component rendering the `ConfigField` schema from `/api/providers`, grouped by `scope: common|provider`, in `lab-control-ui/frontend/src/components/ConfigForm.tsx`
- [X] T023 [US1] Wire `ConfigForm` to `/api/labs` create/update, preserving already-edited field values across edits, in `lab-control-ui/frontend/src/pages/ConfigureLab.tsx` (depends on T022)
- [X] T024 [US1] Command preview panel calling `/api/labs/:id/preview`, in `lab-control-ui/frontend/src/components/CommandPreview.tsx` (depends on T020)
- [X] T025 [P] [US1] Frontend test: only `project_id` renders as required/blocking; editing one field leaves the others unchanged, in `lab-control-ui/frontend/test/ConfigForm.test.tsx`

**Checkpoint**: A configured, launchable GCP lab can be produced and its exact command previewed end-to-end.

---

## Phase 4: User Story 2 - Operator Runs the Lab Lifecycle From The UI With Live Feedback (Priority: P1)

**Goal**: Trigger every documented lifecycle action, watch live streamed output, reconnect without losing history, browse past runs.

**Independent Test**: From a provisioned lab, trigger `deploy`, confirm output streams incrementally, status transitions correctly, and the run is later viewable in history.

### Implementation for User Story 2

- [X] T026 [US2] `POST /api/labs/:id/actions/:actionName` trigger route — resolves the command via `commandBuilder`, spawns via the runner, returns `202` with `actionRunId`/`streamUrl` — in `lab-control-ui/backend/src/routes/actions.ts` (depends on T014, T015, T019)
- [X] T027 [US2] `GET /api/runs/:actionRunId/stream` SSE route — replays the full log file on connect, then tails appended content, emits a final `status` event and closes on process exit — in `lab-control-ui/backend/src/routes/runs.ts` (depends on T014)
- [X] T028 [P] [US2] `GET /api/labs/:id/runs`, `GET /api/runs/:actionRunId`, `GET /api/runs/:actionRunId/log` routes, in `lab-control-ui/backend/src/routes/runs.ts`
- [X] T029 [P] [US2] Integration test: triggering an action against the stub `scripts/lab` (T017) transitions the run `pending→running→succeeded` and the captured log file matches the stub's emitted output; a second case configures the stub to exit `1` with a refusal-style message (simulating the T2-before-T3 guard) and asserts it surfaces verbatim as a `failed` run (FR-006), in `lab-control-ui/backend/test/integration/actions.test.ts` (depends on T017, T026)
- [X] T030 [P] [US2] Integration test: a second trigger of the same `(labId, actionName)` while one is `running` returns `409` naming the in-progress `actionRunId` (FR-016), in `lab-control-ui/backend/test/integration/actions-concurrency.test.ts` (depends on T026)
- [X] T031 [P] [US2] Integration test: reconnecting to `/api/runs/:actionRunId/stream` mid-run replays all output produced so far, not only output produced after reconnecting (FR-008); asserts elapsed time between the stub emitting a line and the SSE event arriving stays within a few seconds (SC-003), in `lab-control-ui/backend/test/integration/stream-reconnect.test.ts` (depends on T027)
- [X] T032 [P] [US2] Action button list component rendering the provider's `ActionDef`s, disabled based on two distinct inputs: (a) prerequisite/confirmation gating (FR-011/012) and (b) prior-Action-Run-outcome sequencing hints — e.g. `seed` stays disabled until this lab's most recent `deploy` run succeeded (spec.md Edge Case 3) — derived from run history the UI already owns, not a re-implementation of CLI validation — in `lab-control-ui/frontend/src/components/ActionList.tsx`
- [X] T033 [US2] Live log viewer component consuming the SSE stream via `EventSource` (native auto-reconnect), in `lab-control-ui/frontend/src/components/LogViewer.tsx` (depends on T027)
- [X] T034 [US2] Run history list + detail view (past runs, status, full captured output, originating configuration), in `lab-control-ui/frontend/src/pages/RunHistory.tsx` (depends on T028)
- [X] T035 [US2] Wire action buttons to the trigger endpoint, surfacing the CLI's own refusal text verbatim (e.g. the T2-before-T3 eCHIS tier guard) rather than a separately-worded UI message, in `lab-control-ui/frontend/src/pages/LabDashboard.tsx` (depends on T026, T032)

**Checkpoint**: The full lifecycle is operable end-to-end from the browser with live, reconnect-safe logs and browsable history.

---

## Phase 5: User Story 3 - Operator Sees Prerequisite and Risk Warnings Before Acting (Priority: P2)

**Goal**: `doctor`-backed prerequisite panel; mandatory confirmation before billable/destructive/public-exposure actions.

**Independent Test**: With a required tool intentionally missing, confirm it shows `fail` on load and blocks the actions that need it.

### Implementation for User Story 3

- [X] T036 [US3] `GET /api/prerequisites?provider=` route shelling out to `scripts/lab doctor --cloud gcp --format json` and relaying its `pass|warn|fail` records verbatim, in `lab-control-ui/backend/src/routes/prerequisites.ts` (depends on T006)
- [X] T037 [US3] Enforce `requiredPrerequisiteIds` (`412` unless `overridePrerequisites:true`) and `requiresConfirmation` (`409` unless `confirmed:true`, with `confirmationMessage`) in the trigger route, per `contracts/api.md`, in `lab-control-ui/backend/src/routes/actions.ts`. The prerequisite gate MUST re-run `scripts/lab doctor` live (or a short-TTL server-side cache) at trigger time, not trust a value the frontend fetched at page load, to avoid a stale-pass race (e.g. `gcloud` ADC expiring between load and trigger). (depends on T026, T036)
- [X] T038 [P] [US3] Integration test: triggering an action with a failing required prerequisite returns `412` naming the blocker; `overridePrerequisites:true` proceeds anyway, in `lab-control-ui/backend/test/integration/prerequisites-gate.test.ts` (depends on T037)
- [X] T039 [P] [US3] Integration test: triggering `up`/`down`/`expose-fhir`/`expose-prometheus`/`expose-grafana` without `confirmed:true` returns `409` with a `confirmationMessage` naming the concrete consequence; nothing is spawned, in `lab-control-ui/backend/test/integration/confirmation-gate.test.ts` (depends on T037). Grafana added post-implementation once `scripts/lab expose-grafana`/`unexpose-grafana` (already documented in `docs/lab-cli.md`) turned out to be missing from the GCP `ActionDef` list.
- [X] T040 [P] [US3] Prerequisite panel component (pass/warn/fail rows with detail text) polling `/api/prerequisites`, in `lab-control-ui/frontend/src/components/PrerequisitePanel.tsx` (depends on T036)
- [X] T041 [US3] Confirmation dialog component naming the concrete consequence (billable resource creation / destructive teardown / public `0.0.0.0/0`-style exposure with the actual configured range) before proceeding, wired to action triggers, in `lab-control-ui/frontend/src/components/ConfirmDialog.tsx` (depends on T032)

**Checkpoint**: No prerequisite gap or costly/destructive action can be triggered blind.

---

## Phase 6: User Story 4 - Operator Logs In Before Doing Anything Else (Priority: P2)

**Goal**: The frontend login flow completing the auth gate whose backend half (T012) already exists as Foundational infrastructure.

**Independent Test**: With no active session, confirm every view is refused until a valid shared secret is submitted.

### Implementation for User Story 4

- [X] T042 [P] [US4] Login page component (secret input, submit, generic error display) in `lab-control-ui/frontend/src/pages/Login.tsx`
- [X] T043 [US4] Frontend session-check + route guard redirecting unauthenticated requests to `Login`, in `lab-control-ui/frontend/src/api/session.ts` (depends on T042)
- [X] T044 [P] [US4] Integration test: unauthenticated requests to `/api/labs`, `/api/runs/*`, `/api/prerequisites` all return `401`, in `lab-control-ui/backend/test/integration/auth-gate.test.ts` (depends on T012)
- [X] T045 [P] [US4] Integration test: an incorrect secret returns a generic `401`; the correct secret establishes a session usable by a subsequent authenticated request; starting the server with `LAB_UI_SHARED_SECRET` unset/empty exits nonzero rather than serving traffic, in `lab-control-ui/backend/test/integration/auth-login.test.ts` (depends on T012, T013)

**Checkpoint**: The full app is usable only behind a real login; Stories 1-3 are now exercised exactly as an operator would encounter them.

---

## Phase 7: User Story 5 - A New Provider Can Be Added Without Reworking The UI (Priority: P3)

**Goal**: Validate, by inspection and by a mechanical guard, that provider-specific code stays isolated to the GCP adapter module.

**Independent Test**: Confirm GCP-specific fields/actions are isolated from provider-agnostic ones such that a second provider could be added without touching shared code.

### Implementation for User Story 5

- [X] T046 [P] [US5] Write `lab-control-ui/backend/src/providers/README.md` documenting how to add a new `ProviderAdapter` (fields, actions, prerequisite checks) without modifying generic routes/runner/db code
- [X] T047 [US5] Add a mechanical guard test asserting no `provider === "gcp"` / `cloud === "gcp"`-style conditional exists outside `lab-control-ui/backend/src/providers/gcp.ts`, in `lab-control-ui/backend/test/unit/no-provider-leakage.test.ts`

**Checkpoint**: All five user stories are functional; the provider extension point is validated, not just asserted in docs.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements spanning multiple stories; final constitution/spec gates.

- [X] T048 [P] Add a `GET /healthz` liveness endpoint (plan.md's Constitution Check Principle IV note — this tool needs the same operability bar it holds the FHIR runtime to), in `lab-control-ui/backend/src/routes/health.ts`
- [X] T049 [P] Write `lab-control-ui/README.md` with deploy/run instructions cross-linked from `quickstart.md`
- [X] T050 [P] Document the new Node.js hosting prerequisite, the `doctor` subcommand, and reverse-proxy/port-80-443 guidance in `docs/getting-started-benchmark-lab.md` and `docs/lab-cli.md`
- [X] T051 Verify `package-lock.json` is committed for both `lab-control-ui/backend/` and `lab-control-ui/frontend/` and no dependency uses a `latest`/floating range (Constitution Principle III gate)
- [X] T052 Run `quickstart.md` Scenarios 1-4 end-to-end (Scenario 4 against a real GCP T2 shape, matching `docs/gcp-echis-t3-lab-runbook.md` Step 4's cost/scope profile). Executed against project `ohs-player-499913`, driven entirely through the Lab Control UI's HTTP API: `up`, `deploy`, `seed` (583,996 resources, matching the documented T2 total), `benchmark`, `expose-fhir`, and `down` all completed for real; concurrency-lock and SSE-reconnect-mid-run behavior verified against real in-flight runs; `down` retried cleanly through transient Cloud SQL/Terraform errors and confirmed zero billable resources remained. Also caught and fixed a real Express 5 `path-to-regexp` bug in the SPA static-file fallback and a real `ansible-galaxy collection list -p PATH` path-merging bug in the T006 collections check (both fixed and verified before this run), plus three further bugs this real run itself surfaced and which are now fixed: (1) `expose-fhir`/`unexpose-fhir`/`expose-prometheus`/`unexpose-prometheus` were missing the `KUBECONFIG` env var `docs/lab-cli.md` documents them as requiring; (2) `ActionDef.confirmationMessage` was a static string never actually naming the live configured value (e.g. the real `expose_source_ranges`) despite FR-012 requiring it -- now a `{field_key}`-templated string resolved server-side per trigger, and the frontend now always round-trips through the trigger endpoint's 409 response instead of shortcutting to the static template; (3) `report` had no way to target a specific prior `seed`/`benchmark` run's artifacts -- `action_runs` now persists `cli_run_label`, and `report` defaults to the lab's most recent succeeded `benchmark` run (or an explicit `targetRunId`) instead of generating a fresh label pointing at a run directory that was never written. All three fixes covered by new unit/integration tests and re-verified live via the stub CLI.
- [X] T053 [P] Add `009-lab-control-ui` to `AGENTS.md`'s benchmark-lab-epic spec list alongside `007-pgbouncer-connection-pooling`/`008-echis-workload-benchmark`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks all user stories — in particular T012 (auth) and T014/T015 (runner/command builder) are load-bearing for every story below.
- **User Stories (Phase 3-7)**: All depend on Foundational completion. US1 and US2 are both P1 and have no dependency on each other's UI work, but US2's action-trigger routes reuse US1's `lab_configurations` routes (T019) as their config source — sequence US1 before US2 if working solo; a second developer could still start US2's backend routes in parallel once T014/T015/T019 exist.
- **US3** depends on US2's action-trigger route (T026) existing to add gating to.
- **US4**'s remaining frontend work depends on T012 (already built in Foundational) but is otherwise independent of US1-US3's feature content.
- **US5** depends on US1's GCP adapter (T009) existing to document/guard against.
- **Polish (Phase 8)**: Depends on all desired stories being complete; T052 in particular exercises every prior phase.

### Parallel Opportunities

- All Setup tasks marked `[P]` run in parallel once T001 exists.
- Within Foundational, T007-T011, T015-T017 are `[P]` against each other (distinct files); T006, T012-T014 are sequential/blocking within the phase.
- Once Foundational is complete, US1 and US4's frontend work can proceed in parallel with US2's backend route work by different contributors.
- All `[P]`-marked test tasks within a phase run in parallel against each other.

---

## Parallel Example: Foundational Phase

```bash
# After T006 (doctor subcommand) lands, these can run together:
Task: "Document the doctor subcommand in docs/lab-cli.md"
Task: "Define ProviderAdapter/ConfigField/ActionDef/PrerequisiteCheckDef interfaces in lab-control-ui/backend/src/providers/types.ts"
Task: "Implement DB access layer in lab-control-ui/backend/src/db/queries.ts"
Task: "Implement CLI argument/command builder in lab-control-ui/backend/src/actions/commandBuilder.ts"
Task: "Create stub scripts/lab test double in lab-control-ui/backend/test/fixtures/stub-lab.sh"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — note this already includes the `doctor` subcommand and auth, since both are load-bearing infrastructure even though the spec frames auth (US4) and prerequisite warnings (US3) as lower-priority stories.
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: run Scenario 2 of `quickstart.md` — a first-time operator reaches a launchable config with only `project_id` entered.
4. This alone demonstrates the core "reduce complexity of getting started" value even before any action can be triggered.

### Incremental Delivery

1. Setup + Foundational → auth-gated, empty shell.
2. Add US1 → validate Scenario 2 → demo-able config screen.
3. Add US2 → validate the bulk of Scenario 4 → full lifecycle control, the other half of the core value proposition.
4. Add US3 → validate Scenario 3 and the confirmation steps of Scenario 4 → safety scaffolding in place.
5. Add US4's frontend login page → validate Scenario 1 → the app is now safe to expose on a public port.
6. Add US5 → inspection/guard confirms the GCP-only implementation didn't foreclose future providers.
7. Phase 8 → polish, docs, and the full `quickstart.md` run against a real GCP T2 lab.

---

## Notes

- `[P]` tasks touch different files with no unmet dependency.
- Auth (US4) and prerequisite checks (US3) are built partly in Foundational (backend) because every story needs them as working infrastructure to be exercised realistically — their remaining phases finish the user-facing half the spec prioritizes independently.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently per its spec.md "Independent Test".
- `contracts/cli-action-map.md` is the single authority for exact `scripts/lab` invocations — T016 and T029 both test against it directly so the command builder cannot silently drift from the documented mapping.
