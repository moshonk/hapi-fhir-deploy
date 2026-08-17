# Implementation Plan: Lab Control UI

**Branch**: `009-lab-control-ui` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-lab-control-ui/spec.md`

## Summary

A small, self-contained web application (React frontend + Node/Express
backend, one deployable process serving both) that gives an operator a
browser-based control surface over the existing `scripts/lab` CLI: an
autofilled, provider-extensible configuration form; buttons that trigger
each documented lifecycle action (`up`, `deploy`, `expose-fhir`/
`unexpose-fhir`, `expose-prometheus`/`unexpose-prometheus`,
`pause-autoscaling`/`resume-autoscaling`, `seed`, `benchmark`, `report`,
`down`) as local subprocesses of `scripts/lab` itself; live SSE log
streaming with reconnect-safe replay and persisted run history; a
prerequisite panel backed by a new non-destructive `scripts/lab doctor`
subcommand; and shared-secret session auth gating all of the above. GCP is
the only implemented provider; a `ProviderAdapter` interface isolates
provider-specific config/actions so AWS/Azure can be added later without
touching the generic action/log/history/auth code.

## Technical Context

**Language/Version**: TypeScript on Node.js 22.x (backend and frontend
build); React 18 for the frontend.

**Primary Dependencies**: Express (HTTP + SSE), `node:sqlite` (built-in,
structured storage), `child_process` (spawning `scripts/lab`), React +
Vite (frontend build/dev server), `vitest` + `@testing-library/react`
(tests). No native-compiled npm dependencies (research.md §3).

**Storage**: SQLite via `node:sqlite`, single file at
`ansible/artifacts/lab/ui/lab-control-ui.db` (ignored path, matching this
repo's existing convention for generated lab artifacts). Action Run log
bodies are flat append-only files under
`ansible/artifacts/lab/ui/runs/<actionRunId>.log`, not DB blobs. Operator
sessions are in-memory only (not persisted).

**Testing**: Vitest for backend unit/integration tests (including a stub
`scripts/lab` replacement for process-spawning tests) and frontend
component/integration tests with React Testing Library. No end-to-end
browser suite in this feature's scope (research.md §9); real-GCP validation
is manual, via `quickstart.md`.

**Target Platform**: Linux server — the same host/checkout that already
runs `scripts/lab` (e.g. the GCE control-plane VM used in
`docs/gcp-echis-t3-lab-runbook.md`), reached on port 80/443 via a reverse
proxy in front of the app's internal port (research.md §7).

**Project Type**: Web application (frontend + backend), added to this repo
as a new top-level `lab-control-ui/` directory — see Project Structure
below.

**Performance Goals**: Log output visible in the browser within a few
seconds of being produced (SC-003); UI interactions (form edits, action
triggers) respond within normal single-operator web-app expectations — no
high-concurrency or multi-tenant performance target applies (single
operator, single host, scoped to however many labs one operator runs at
once).

**Constraints**: Must not duplicate `scripts/lab`'s own default-resolution,
sequencing-guard, or validation logic (spec Assumptions; research.md §4-5);
must require explicit confirmation before billable/destructive/public-
exposure actions (FR-012); must keep an in-progress action running and
resumable-by-log independent of browser connection state (FR-008, FR-019);
must gate every route behind shared-secret session auth (FR-013).

**Scale/Scope**: Single operator, one shared-secret credential, GCP-only
provider implementation with an extension point for others. Not designed
for multi-tenant or many-concurrent-operator use (explicitly out of scope
per spec Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

This feature is an operations tool that sits beside the HAPI FHIR Helm
deployment and controls its ephemeral benchmark-lab lifecycle; it does not
modify the HAPI FHIR chart, runtime, or datasource. Constitution principles
evaluated for applicability:

| Principle | Applies? | Assessment |
|---|---|---|
| I. Chart-First Deployment | No | This feature adds no Helm chart values, no standalone Kubernetes manifests for the FHIR runtime, and does not touch `charts/hapi-fhir-deploy`. It is a separate application, not a runtime component. |
| II. Explicit External PostgreSQL | No | The `spring.datasource.*`/`hapi-fhir-postgres` Secret contract this principle governs belongs to the HAPI FHIR runtime the lab *deploys*; this feature's own SQLite storage (research.md §3) is unrelated bookkeeping for UI run history, not a HAPI FHIR datasource. Explicitly distinguished in research.md §3's alternatives-considered. |
| III. Version Pinning and Reproducibility | **Yes** | Node runtime version pinned (research.md §1: `22.x` via the pinned apt candidate on the target OS); all npm dependencies MUST be locked via a committed lockfile (`package-lock.json`) with no `latest`/floating ranges, matching D5. Verified as a task-level gate (`npm ci`, not `npm install`, in build/deploy steps). |
| IV. Observable and Operable Runtime | Partially, by analogy | Not a HAPI FHIR runtime concern directly, but this feature is itself a runtime an operator depends on — it MUST expose a basic health/liveness signal and keep its own logs (the app's own process logs, distinct from captured `scripts/lab` run logs) inspectable, so operating *this* tool doesn't regress below the operability bar the rest of the repo holds the FHIR runtime to. Added as a plan-level expectation, not a spec requirement, since the spec itself doesn't ask for it. |
| V. Bounded Scale and Safe Rollouts | No, by analogy only | Governs HAPI FHIR replica/Hikari/PDB behavior specifically. This feature's own analog — never letting a destructive/costly action fire without confirmation — is already captured as FR-012 and is a spec requirement, not a gap this check needs to flag. |

No violations requiring the Complexity Tracking table. The one net-new
piece of complexity against the existing `scripts/lab` surface — the new
`doctor` subcommand (research.md §5) — is justified there as the
alternative that avoids, not creates, a second source of truth, and is a
small additive change in the same pattern as this repo's recent
`expose-prometheus`/`unexpose-prometheus` additions.

**Post-Phase-1 re-check**: Data model (SQLite schema) and contracts (API,
CLI action map) introduce no new Helm/manifest/datasource surface and no
new unpinned dependencies. Gate still passes unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/009-lab-control-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   ├── api.md             # HTTP/SSE API contract
│   └── cli-action-map.md  # UI action -> scripts/lab invocation mapping
└── tasks.md              # Phase 2 output (/speckit-tasks - not created by /speckit-plan)
```

### Source Code (repository root)

```text
lab-control-ui/
├── backend/
│   ├── src/
│   │   ├── providers/          # ProviderAdapter interface + gcp/ implementation
│   │   ├── actions/             # action trigger endpoint, process spawn/lock, log capture
│   │   ├── auth/                 # shared-secret login, session middleware
│   │   ├── db/                   # node:sqlite schema + queries (lab_configurations, action_runs)
│   │   ├── routes/               # Express route handlers per contracts/api.md
│   │   └── server.ts             # app entrypoint; serves frontend/dist as static assets
│   ├── test/
│   │   ├── unit/
│   │   └── integration/          # uses a stub scripts/lab via LAB_CLI_PATH override
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── src/
│   │   ├── components/           # config form, action buttons, log viewer, prereq panel
│   │   ├── pages/                 # login, lab dashboard, run history
│   │   └── api/                   # typed client for contracts/api.md
│   ├── test/
│   ├── package.json
│   └── package-lock.json
└── README.md                      # deploy/run instructions, cross-linked from quickstart.md

scripts/lab                        # existing CLI, gains a new `doctor` subcommand (research.md §5)
docs/lab-cli.md                    # existing doc, gains a `doctor` subcommand entry
```

**Structure Decision**: New top-level `lab-control-ui/` directory (sibling
to `scripts/`, `ansible/`, `infra/`), containing independent `backend/` and
`frontend/` npm projects, matching the template's "web application" option.
Kept separate from `scripts/` because this is a standalone deployable
application with its own dependency tree and build step, not a single CLI
script; `scripts/lab` itself only grows one small additive subcommand
(`doctor`) rather than moving or being wrapped by the new app. The backend
locates the `scripts/lab` checkout via `LAB_REPO_ROOT` (defaulting to the
git repository root, auto-detected at startup), so `lab-control-ui/` never
hardcodes a path assumption about where it lives relative to `scripts/`.

## Complexity Tracking

*No Constitution Check violations requiring justification — table omitted.*
