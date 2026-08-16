# API Contract: Lab Control UI Backend

All routes except `POST /api/auth/login` require a valid session cookie
(FR-013); an unauthenticated request to any other route returns `401` with
no body content beyond a generic error message.

## Auth

### `POST /api/auth/login`

Request: `{ "secret": string }`

Response `200`: sets session cookie, body `{ "ok": true }`.
Response `401`: `{ "ok": false, "error": "invalid credentials" }` — identical
body/timing regardless of how close the guess was (FR-015).

### `POST /api/auth/logout`

Clears the session. Response `200`.

## Prerequisites

### `GET /api/prerequisites?provider=gcp`

Shells out to `scripts/lab doctor --cloud gcp --format json`
(research.md §5). Response `200`:

```json
{
  "checks": [
    { "id": "terraform", "label": "Terraform", "status": "pass", "detail": "terraform 1.9.4" },
    { "id": "gcloud-adc", "label": "gcloud Application Default Credentials", "status": "warn", "detail": "no ADC token; run gcloud auth application-default login" }
  ]
}
```

`status` is one of `pass | warn | fail`, sourced verbatim from `doctor`'s
own classification — this endpoint performs no independent judgment
(research.md §5).

## Provider metadata

### `GET /api/providers`

Response `200`: the registered `ProviderAdapter`s' public shape (id, label,
`configFields`, `actions`) — this is what the frontend renders the
configuration form and action list from, so provider extensibility (FR-017)
is a backend registration, not a frontend code change.

## Lab configurations

### `GET /api/labs`

List saved `lab_configurations`, newest-updated first.

### `POST /api/labs`

Create a configuration. Request: `{ "provider": "gcp", "name": string, "fields": { ...ConfigField values... } }`.
Server fills any field the caller omits with that provider's declared
default (FR-001); fields with `required: true` (i.e. `default: null`) left
unset make the response include `"launchable": false` rather than a `400` —
an incomplete-but-saved draft is valid (FR-002 only blocks *actions*, not
saving).

### `PATCH /api/labs/:id`

Partial update to `fields`. Same fill/launchable semantics as `POST`.

### `GET /api/labs/:id/preview?action=up`

Returns `{ "command": string }` — the exact resolved `scripts/lab`
invocation for that action against that configuration's current field
values (FR-003), using the same argument-builder the trigger endpoint below
actually runs, so the preview can never drift from what executing it does.

## Actions

### `POST /api/labs/:id/actions/:actionName`

Body: `{ "confirmed": boolean }`. If `ActionDef.requiresConfirmation` is true
for this action and `confirmed` is not `true`, responds `409` with
`{ "error": "confirmation required", "confirmationMessage": string }`
instead of running anything (FR-012) — the frontend is expected to have
already shown this message and only sends `confirmed: true` after the
operator accepts, but the backend re-enforces it so confirmation can't be
bypassed by calling the API directly.

If a required prerequisite (`ActionDef.requiredPrerequisiteIds`) is
currently `fail`, responds `412` with
`{ "error": "prerequisite not satisfied", "failing": [...ids] }` unless the
request includes `"overridePrerequisites": true` (FR-011 allows explicit
confirmation past a failing prerequisite, not just a hard block).

If the same `(labId, actionName)` pair already has a `running` row, responds
`409` with `{ "error": "action already running", "actionRunId": string }`
(FR-016).

Otherwise spawns the action and responds `202` with
`{ "actionRunId": string, "streamUrl": "/api/runs/:actionRunId/stream" }`
immediately — the caller does not wait for completion.

## Runs

**Naming note**: `actionRunId` here (the `action_runs.id` UUID, used in every
`/api/runs/:actionRunId/...` path) is a distinct concept from the `--run`
flag value `scripts/lab seed`/`benchmark`/`report` take — see
`cli-action-map.md`'s `cliRunLabel` note. Do not conflate the two.

### `GET /api/labs/:id/runs`

Run history for a lab (FR-009), newest first: `id`, `action_name`, `status`,
`started_at`, `ended_at`, `exit_code`.

### `GET /api/runs/:actionRunId`

Single run detail, including `command_preview` and full metadata (but not
the log body — see stream/log endpoints below).

### `GET /api/runs/:actionRunId/log`

Full captured log body as `text/plain`, for a completed run (or the
in-progress content of a running one) — used when the operator just wants
the text, not a live stream.

### `GET /api/runs/:actionRunId/stream`

`text/event-stream` (SSE, research.md §2). On connect: emits the full
current log content as a single burst of `log` events, then continues
emitting `log` events as new output is appended. Emits one final `status`
event (`succeeded` or `failed`) and closes the stream when the process
exits. Reconnecting after a drop simply reopens this same endpoint — the
full-content replay on connect satisfies FR-008 without any client-tracked
offset.
