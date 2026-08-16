# Quickstart: Lab Control UI

Validation guide for this feature once implemented. This is not the
implementation itself — see `tasks.md` for build steps and
`contracts/`/`data-model.md` for the design it validates against.

## Prerequisites

Everything `docs/getting-started-benchmark-lab.md` already requires for
GCP (Terraform, Helm, kubectl, Ruby, k6, Java, `gcloud` +
`gke-gcloud-auth-plugin`, the pinned Ansible venv), **plus**, new for this
feature:

- Node.js 22.x (`sudo apt-get install nodejs` on the target host, or an
  equivalent pinned install — see `research.md` §1). This is a prerequisite
  of *hosting the control UI*, distinct from the lab-lifecycle
  prerequisites the UI's own "doctor" panel checks.
- A reverse proxy (e.g. Caddy) if you want the UI reachable on port 80/443
  with TLS — the app itself listens on an internal port
  (`LAB_UI_PORT`, default `3000`); see `research.md` §7.

## Setup

```sh
cd lab-control-ui/backend
npm ci
LAB_UI_SHARED_SECRET="choose-a-real-secret" \
LAB_REPO_ROOT="$(git rev-parse --show-toplevel)" \
npm run build

cd ../frontend
npm ci
npm run build   # emits static assets the backend serves
```

```sh
cd ../backend
LAB_UI_SHARED_SECRET="choose-a-real-secret" \
LAB_REPO_ROOT="$(git rev-parse --show-toplevel)" \
npm start
```

## Scenario 1 — Login gate (validates Story 4 / FR-013-015)

1. Open `http://localhost:3000/` without logging in.
2. Confirm no configuration, action, or log content is visible — only a
   login prompt.
3. Submit an incorrect secret; confirm a generic rejection (not "close, try
   again").
4. Submit the real secret; confirm the configuration screen loads.

## Scenario 2 — Fast path to a launchable config (validates Story 1 / FR-001-003)

1. On the "Configure Lab" screen, confirm every field is pre-filled except
   **GCP project ID**, and that the "Provision" action is disabled/blocked
   until it's filled.
2. Enter a real GCP project ID.
3. Open the command preview and confirm it matches
   `contracts/cli-action-map.md`'s `up` row with your entered values
   substituted in.
4. Change `node_size` to a different value; confirm the rest of the form
   keeps its prior values (nothing resets).

## Scenario 3 — Prerequisite panel (validates Story 3 / FR-010-011)

1. Confirm the prerequisites panel shows a `pass`/`warn`/`fail` row per tool
   listed in `docs/getting-started-benchmark-lab.md`'s Prerequisites
   section, matching what `scripts/lab doctor --cloud gcp --format json`
   reports directly (`ansible/.venv/bin/... scripts/lab doctor --cloud gcp
   --format json` should produce the same statuses run by hand).
2. Temporarily rename a required binary (e.g. `helm`) off `PATH`; reload;
   confirm it now shows `fail` and that triggering `up` is blocked or
   requires explicit override, naming `helm` as the blocker.
3. Restore `PATH`; confirm the check returns to `pass` on next refresh.

## Scenario 4 — Full lifecycle with live logs and confirmation gates
(validates Story 2 / Story 3's confirmation requirements, FR-004, FR-006-009, FR-012, FR-016, FR-019)

Uses the same T2 shape as `docs/gcp-echis-t3-lab-runbook.md` Step 4 — small,
cheap, safe to run end-to-end as a real validation.

1. Trigger **Provision** (`up`). Confirm a billable-resource-creation
   warning is shown and requires explicit confirmation before it starts.
2. While it runs, confirm output streams into the browser incrementally
   (not only at completion). Reload the browser tab mid-run; confirm the
   log view reconnects and shows the full output produced so far, not just
   from the reload point (FR-008).
3. Attempt to trigger **Provision** again while the first is still running;
   confirm it's refused with a message naming the in-progress run (FR-016).
4. Once `up` succeeds, trigger **Deploy**. Confirm it becomes available only
   after `up` has succeeded.
5. Set the eCHIS tier to **T3** before T2 has completed on this checkout;
   confirm the UI surfaces the CLI's own T2-before-T3 sequencing refusal
   (FR-006) rather than silently allowing or independently blocking it with
   a different message.
6. Run T2's `seed` and `benchmark` steps; confirm `echis-tier-progress.json`
   guard now allows T3 selection.
7. Trigger **expose-fhir**; confirm the confirmation dialog names the actual
   `0.0.0.0/0` (or configured) source range before proceeding (FR-012).
8. Open run history for this lab; confirm every step above appears with its
   status and is individually viewable, including the full captured output
   of a step that already finished (FR-009).
9. Trigger **Destroy** (`down`); confirm a destructive-teardown confirmation
   is required, and that it also cleans up the `expose-fhir` exposure from
   step 7 (matching `docs/lab-cli.md`'s documented `down` behavior).

## Expected outcome

All nine scenario groups pass with zero manual terminal use for lifecycle
actions — only the initial `npm`/setup commands above run outside the
browser, matching SC-001/SC-002 of `spec.md`.
