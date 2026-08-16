# Lab Control UI

A browser-based control surface over [`scripts/lab`](../scripts/lab):
configure a lab with autofilled defaults, trigger each lifecycle step, watch
live logs, and browse run history — without a terminal. GCP is the only
implemented provider (see [`src/providers/README.md`](backend/src/providers/README.md)
for how to add another).

Full design docs: [`specs/009-lab-control-ui/`](../specs/009-lab-control-ui/)
(spec, plan, research, data model, API/CLI contracts). Runnable validation
scenarios: [`specs/009-lab-control-ui/quickstart.md`](../specs/009-lab-control-ui/quickstart.md).

## Architecture

One Node/Express process serves both the JSON API and the built React
frontend on a single port. It runs on the same host/checkout as
`scripts/lab` (e.g. the GCE control-plane VM used in the GCP runbooks) and
invokes it as a local subprocess — no remote execution layer.

```
lab-control-ui/
├── backend/    Express API + process runner + SQLite state
└── frontend/   React app (built to backend/../frontend/dist, served statically)
```

## Prerequisites

Everything `docs/getting-started-benchmark-lab.md` already requires for the
lab lifecycle itself (checked live by the app's own prerequisite panel via
`scripts/lab doctor`), **plus**, new for hosting this UI:

- **Node.js 22.x** (`sudo apt-get install nodejs` on Debian/Ubuntu, or an
  equivalent pinned install)
- A reverse proxy (e.g. Caddy or nginx) if you want the app reachable on
  port 80/443 with TLS — the app itself listens on an internal port
  (default `3000`), never binding a privileged port directly.

## Setup

```sh
cd lab-control-ui/backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
```

## Run

```sh
cd lab-control-ui/backend
LAB_UI_SHARED_SECRET="choose-a-real-secret" \
LAB_REPO_ROOT="$(git rev-parse --show-toplevel)" \
npm start
```

Open `http://localhost:3000` (or whatever your reverse proxy maps to it)
and sign in with the shared secret.

**The app refuses to start if `LAB_UI_SHARED_SECRET` is unset or empty** —
it never falls back to serving unauthenticated (spec.md Edge Case 5).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `LAB_UI_SHARED_SECRET` | *(required)* | Login credential. No default — startup fails without it. |
| `LAB_UI_PORT` | `3000` | Internal port the app listens on. |
| `LAB_REPO_ROOT` | auto-detected via `git rev-parse --show-toplevel` | Repo checkout containing `scripts/lab`. |
| `LAB_CLI_PATH` | `$LAB_REPO_ROOT/scripts/lab` | Override to point at a different `scripts/lab` (e.g. a stub, for testing). |
| `LAB_UI_DB_PATH` | `$LAB_REPO_ROOT/ansible/artifacts/lab/ui/lab-control-ui.db` | SQLite state file (ignored path, per this repo's convention). |
| `LAB_UI_RUNS_DIR` | `$LAB_REPO_ROOT/ansible/artifacts/lab/ui/runs` | Per-run captured log files. |
| `LAB_UI_COOKIE_SECURE` | `false` | Set `true` when served over HTTPS so the session cookie gets the `Secure` flag. |

## Development

```sh
cd lab-control-ui/backend && npm run dev      # tsx watch, auto-restart
cd lab-control-ui/frontend && npm run dev     # Vite dev server, proxies /api to :3000
```

## Testing

```sh
cd lab-control-ui/backend && npm test         # vitest: unit + integration (stub scripts/lab, no real GCP)
cd lab-control-ui/frontend && npm test        # vitest + React Testing Library
```

## Deployment note: reaching port 80/443

The app itself binds an unprivileged port (avoiding the privilege increase
of running as root just to bind 80/443). Put a reverse proxy in front of it
for TLS termination and the public port, e.g. a minimal Caddyfile:

```
your-host.example.com {
  reverse_proxy localhost:3000
}
```

Caddy handles automatic HTTPS. Any reverse proxy (nginx, an existing
load balancer) works equally well — the app has no opinion here beyond
listening on plain HTTP internally.
