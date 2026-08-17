# Phase 0 Research: Lab Control UI

All items below were pre-decided by the user before `/speckit-specify` (same-host
execution, shared-secret auth, React frontend) or are resolved here. No
`NEEDS CLARIFICATION` markers remain in `plan.md`'s Technical Context.

## 1. Backend language/framework

**Decision**: Node.js (22.x LTS) + TypeScript + Express.

**Rationale**: The user asked for a backend recommendation given a React
frontend requirement, specifically flagging that Python (the rest of the
repo's Ansible tooling) shouldn't be assumed. Node/Express means:

- One language across frontend and backend — no context-switch for the sole
  maintainer of a "simple" tool, and no separate build toolchains.
- `child_process.spawn` gives clean, non-blocking, streamable access to
  `scripts/lab`'s stdout/stderr as it's produced — a natural fit for FR-007
  (incremental log streaming).
- Express serves both the API and the built React static assets from one
  process on one port, which keeps "reachable on port 80/443" (the spec's
  framing) to a single deployable unit instead of two.
- `nodejs` 22.22.1 is available as a pinned Debian/Ubuntu apt package
  (`apt-cache policy nodejs` confirms `22.22.1+dfsg+~cs22.19.15-1ubuntu1` as
  the candidate on this repo's target OS), satisfying the constitution's
  version-pinning principle (D5 / Principle III) without a bespoke Node
  install method.

**Alternatives considered**:
- **Python + FastAPI**: would match the Ansible tooling's language, and
  FastAPI has good WebSocket/SSE support, but splits the stack into two
  languages (Python backend, TypeScript/JSX frontend) for no functional gain
  — this is glue code around a CLI, not a place where Python's ecosystem
  (data/ML/Ansible libs) matters.
- **Go**: excellent for spawning/streaming subprocesses and single-binary
  deploys, but adds a language this repo has zero prior footprint in, and its
  frontend story (serving a separately-built React bundle) offers no
  simplicity advantage over Express doing the same thing.

## 2. Log streaming transport

**Decision**: Server-Sent Events (SSE) over plain HTTP, one stream per
Action Run (`GET /api/runs/:actionRunId/stream`).

**Rationale**: The stream is one-directional (server → browser); the browser
never needs to push data back over the same channel (actions are triggered
via separate `POST` calls). SSE gives that for free over plain HTTP/1.1 —
`EventSource` in the browser auto-reconnects, and standard reverse
proxies/firewalls (relevant since this UI sits behind whatever serves port
80/443 per the spec's HTTPS-termination assumption) pass it through without
special upgrade handling the way WebSocket needs. On connect, the endpoint
first replays the run's persisted log file in full, then tails newly
appended content — satisfying FR-008's "reconnect and see output produced
since the action started" with no separate resume/offset protocol needed
(replay-the-file is simpler than tracking `Last-Event-ID` and is cheap at
this tool's log volumes).

**Alternatives considered**:
- **WebSocket**: bidirectional, but this feature has no need for the client
  to push data over the log channel — added complexity (upgrade handling,
  ping/pong keepalive) with no corresponding requirement.
- **Long-polling**: works, but reinvents what SSE already provides natively
  in every evergreen browser, for no benefit.

## 3. Run/state storage

**Decision**: `node:sqlite` (Node's built-in SQLite module, stable as of
Node 22) writing to a single file under an ignored path,
`ansible/artifacts/lab/ui/lab-control-ui.db`, consistent with this repo's
existing convention that generated lab artifacts live under ignored
`ansible/artifacts/lab/` paths (see `docs/lab-cli.md`'s "Cost Safety"
section).

**Rationale**: Lab Configurations and Action Runs (with their status and a
pointer to their log file — the log body itself stays in a flat file, not in
a DB blob, since it's append-only and can be streamed straight from disk)
need simple structured queries (list runs for a lab, filter by status) that
flat JSON files make awkward past a handful of runs. `node:sqlite` avoids
adding a native-compiled dependency (no `node-gyp`, no prebuilt-binary
fetching at install time) and needs zero external service — in keeping with
this repo's constitution (no bundled/embedded datastore sprawl) and the
feature's "simplicity" mandate. It is a single file on the same host that
already owns all the other lab state.

**Alternatives considered**:
- **`better-sqlite3` (npm package)**: same SQL surface, but pulls in a
  native addon that needs a matching prebuilt binary or a working
  build toolchain on the host — an extra fragility this repo's "simple to
  get started" goal doesn't need when the built-in module covers the same
  ground.
- **Flat JSON files per run**: fine for the log body (already the plan —
  one file per run), but awkward for the query patterns run history needs
  (list/filter runs for a lab) without hand-rolling an index.
- **PostgreSQL**: explicitly not appropriate — the constitution's external-
  Postgres principle (D2/D4) governs the *HAPI FHIR runtime's* datasource,
  not this ops tool's own bookkeeping; standing up a second Postgres just to
  track UI run history would be a large complexity regression against a tool
  whose entire premise is reducing complexity.

## 4. Process execution and command construction

**Decision**: Each triggered action spawns `scripts/lab <subcommand> ...`
(or, for `seed`/`benchmark`, the documented env-var-prefixed invocation) as a
child process via `child_process.spawn`, with `cwd` set to the repository
root and stdout/stderr piped, tee'd to the run's log file, and fed to any
attached SSE stream. The backend holds an in-memory lock keyed by
`(labId, actionName)` for the duration of the spawned process, satisfying
FR-016 (no duplicate concurrent trigger) — a run's row moves
`pending → running → succeeded|failed` based solely on the child process's
exit code (`0` = succeeded, matching `scripts/lab`'s own `die()` convention
of always exiting `1` on failure/refusal).

The backend never re-derives or second-guesses what a valid flag
combination is: it takes the operator's Lab Configuration (defaults +
edits), maps each field to the flag/env-var `scripts/lab` already documents
for it (see `contracts/cli-action-map.md`), and lets the CLI's own
validation, default-resolution, and sequencing guards (e.g. the T2-before-T3
eCHIS tier guard, read from
`ansible/artifacts/lab/echis-tier-progress.json` by the CLI itself) be the
sole source of truth, per FR-005/FR-006. A refusal is not a distinct UI
state — it is a normal `failed` run whose captured log happens to contain
the CLI's `die()` message, which the UI just displays.

**Rationale**: This is the direct implementation of the spec's "not a second
source of truth" constraint (Assumptions section) and FR-005/FR-006.

## 5. Prerequisite checks (FR-010)

**Decision**: Add a small, additive, non-destructive subcommand to
`scripts/lab` itself — `scripts/lab doctor --cloud gcp [--format json]` —
that calls the *existing* `check_lab_prerequisites()` function (currently
only reachable from inside `cmd_up`, gated behind provisioning) directly,
always exits `0`, and supports a `--format json` flag that emits one
pass/warn/fail record per tool/credential instead of the current
log-and-die behavior. The UI's prerequisite panel shells out to this command
on load and on demand; it does not independently re-implement the tool list.

This feature also extends `check_lab_prerequisites()` itself (used by both
`up` and `doctor` — one function, one source of truth) to verify the pinned
Ansible collections from `ansible/requirements.yml` are actually installed
(e.g. via `ansible-galaxy collection list`), not just that the
`ansible-playbook`/`ansible-galaxy` binaries are on `PATH`. Today the
function only checks binary presence, which cannot detect "Ansible
installed, collections never run" — a real failure mode this feature's
FR-010 explicitly promises to surface.

**Rationale**: `check_lab_prerequisites()` already checks exactly what
FR-010 asks for (Terraform, Helm, kubectl, the Ansible venv binaries, Ruby,
k6, Java, and — for GCP — `gcloud`, `gke-gcloud-auth-plugin`, and an active
Application Default Credentials token), but today it only runs as a side
effect of `up`, which is destructive/billable and requires a lab name and
full config first. Calling `up --dry-run` as a workaround was considered and
rejected: it still requires a name/config the operator hasn't entered yet at
first load, still exercises Terraform init/plan machinery irrelevant to a
"can I even start" check, and conflates "readiness" with "attempting a
provisioning run" in a way that's a worse UX than a dedicated read-only
command. Extracting the check into its own subcommand keeps the tool list
defined in exactly one place (reused by both `up` and `doctor`), which is
what FR-005's "not a second source of truth" principle demands applied to
prerequisites specifically. This is a small, backward-compatible CLI
addition in the same spirit as this repo's recent `expose-prometheus`/
`unexpose-prometheus` additions (see git history) — implemented as a task
under this feature, not a re-architecture of `scripts/lab`.

**Alternatives considered**:
- **UI independently re-implements tool detection**: rejected — exactly the
  duplicated-logic drift risk the spec's Assumptions section warns against;
  a future new prerequisite added to `check_lab_prerequisites()` would
  silently not appear in the UI.
- **`scripts/lab up --dry-run --cloud gcp --name <placeholder>`**: rejected
  per rationale above.

## 6. Authentication

**Decision**: A single shared secret set via an environment variable
(`LAB_UI_SHARED_SECRET`) at backend startup. Login `POST`s the secret;
the backend compares it using a constant-time comparison
(`crypto.timingSafeEqual`) and, on match, issues a signed, `HttpOnly`,
`SameSite=Strict` session cookie backed by an in-memory session store
(session tokens are random, opaque, and unrelated to the secret itself).
All other API routes require a valid session.

The backend MUST refuse to start (exit nonzero with a clear startup error)
if `LAB_UI_SHARED_SECRET` is unset or empty — it must never fall back to
an unauthenticated or trivially-bypassable mode (spec.md Edge Case 5).

**Rationale**: Directly implements FR-013/014/015 with no new moving parts
(no external identity provider, no password database/hashing — there is
exactly one credential, chosen and rotated by whoever deploys the UI). An
in-memory session store means a backend restart requires re-login — recorded
as an assumption in the spec and acceptable given the single-operator,
same-host scope.

**Alternatives considered**: OAuth/SSO was already ruled out during
requirements clarification as disproportionate complexity for a single-
operator lab tool.

## 7. Serving on port 80/443

**Decision**: The Express app listens on an unprivileged internal port
(default `3000`, configurable via `LAB_UI_PORT`). Reaching it on port 80/443
is a deployment-time reverse-proxy concern (e.g. Caddy or nginx in front,
terminating TLS), documented in `quickstart.md`, not something the
application binds directly.

**Rationale**: Binding directly to port 80/443 requires running the Node
process as root or granting `cap_net_bind_service`, either of which is an
avoidable privilege increase for a tool that can trigger billable/destructive
cloud actions. A reverse proxy is also where TLS termination naturally lives
— matching the spec's own assumption that HTTPS termination is "handled by
whatever is already documented/available on the deployment host," not by
this feature.

**Concrete implementation**: `lab-control-ui/docker-compose.yml` +
`lab-control-ui/nginx/nginx.conf` implement this decision as the primary
recommended deployment path — nginx on port 80 (or `HTTP_PORT`) in front of
the app container's internal port, with SSE-specific proxy settings
(`proxy_buffering off`, a long `proxy_read_timeout`) for the live log stream
(§2 above). The `Dockerfile` also bakes in the entire `scripts/lab`
toolchain (Terraform, Helm, kubectl, Ansible, Ruby, k6, Java, gcloud), so
the reverse-proxy decision here and the "what needs to be installed to run
this at all" question are solved by the same `docker compose up`. See
`lab-control-ui/README.md`'s "Run with Docker" section.

## 8. Provider extensibility mechanism

**Decision**: A `ProviderAdapter` interface (implemented once, for `gcp`,
in this feature) declaring: its config field schema (key, label, type,
default value or default-resolver, required flag, help text — see
`data-model.md`), its available actions (name, target `scripts/lab`
subcommand, an argument-builder function from Lab Configuration to CLI
args/env, whether it needs destructive/costly confirmation and what that
confirmation should say, and which Prerequisite Checks gate it), and its
provider-specific prerequisite checks. All provider-agnostic backend code
(action triggering, process spawning, log streaming, run history, session
auth) consumes only this interface and never branches on `cloud === "gcp"`
directly.

**Rationale**: Directly implements FR-017/018 and Story 5. Adding AWS/Azure
later (both already accepted by `scripts/lab --cloud`) means writing a new
adapter module and registering it — no change to the generic action/log/
history/auth code.

## 9. Testing approach

**Decision**: Backend — Vitest for unit tests (provider adapter, CLI
argument construction, session/auth middleware, SQLite data access) plus
integration tests that spawn a small stub script standing in for
`scripts/lab` (via `LAB_CLI_PATH` override) to exercise process spawning,
log capture, exit-code-to-status mapping, and the concurrency lock, without
touching real GCP. Frontend — Vitest + React Testing Library for component
and form-default behavior (Story 1), plus a small number of integration
tests against a mocked backend API for the action-trigger/log-stream/
confirmation flows (Stories 2-4). No end-to-end browser test suite is
introduced for this feature — disproportionate to a single-operator internal
tool; manual verification against a real GCP lab is covered by
`quickstart.md`.

**Rationale**: Keeps test infrastructure proportionate to the feature's
"simplicity" mandate while still giving confidence in the parts most likely
to regress silently (argument construction correctness, and the
concurrency/reconnect guarantees in FR-008/016).
