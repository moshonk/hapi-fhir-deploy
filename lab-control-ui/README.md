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
├── frontend/   React app (built to frontend/dist, served statically)
├── Dockerfile  App + the full scripts/lab toolchain (Terraform, Helm, kubectl,
│               Ansible, Ruby, k6, Java, gcloud), see "Run with Docker" below
├── docker-compose.yml
└── nginx/      Reverse proxy config for the Docker deployment
```

## Run with Docker (recommended)

The one-command way to "always have this running": builds an image with the
app **and** the entire `scripts/lab` toolchain baked in (so `scripts/lab
doctor` reports all-green without installing anything else on the host),
fronted by nginx on port 80. `scripts/lab` itself — `scripts/`, `infra/`,
`ansible/`, `benchmarks/`, `docs/` — is bind-mounted live from this checkout,
not baked into the image, so it always operates against your actual repo
state and every lab artifact (Terraform state/outputs, kubeconfigs, seed/
benchmark results, this app's own SQLite DB and run logs) lands under the
already-gitignored `ansible/artifacts/lab/` exactly as it would bare-metal.

```sh
cd lab-control-ui
cp .env.example .env
# Edit .env: set LAB_UI_SHARED_SECRET (e.g. `openssl rand -base64 24`),
# and HTTP_PORT if 80 is already taken on this host.

gcloud auth application-default login   # on the HOST, once — the container
                                         # reads this, it doesn't manage login

docker compose up -d --build
```

Open `http://localhost` (or your `HTTP_PORT`) and sign in with the shared
secret. `docker compose logs -f app` follows the backend's own process logs
(distinct from captured `scripts/lab` run logs, which the UI itself streams).

Restarts automatically (`restart: unless-stopped`) if the host reboots or
the container crashes — genuinely "always fire up the service" rather than
something you have to remember to `npm start` again.

To rebuild after pulling changes to `lab-control-ui/backend` or `frontend`:

```sh
docker compose up -d --build
```

To stop:

```sh
docker compose down       # containers only -- your lab data under
                           # ansible/artifacts/lab/ is on the host, untouched
```

**What's in `.env`** (copy from `.env.example`, gitignored):

| Variable | Meaning |
|---|---|
| `LAB_UI_SHARED_SECRET` | *(required)* Login credential. `docker compose up` refuses to start the app without it. |
| `HTTP_PORT` | Host port nginx binds (default `80`). |
| `GCLOUD_CONFIG_DIR` | Host path to your `gcloud` config (default `~/.config/gcloud`), mounted read-only for GCP credentials. |
| `LAB_UI_COOKIE_SECURE` | Set `true` only once nginx is actually terminating HTTPS (see below). |

**Version pins**: every tool in the image (Terraform, Helm, kubectl, k6,
Ansible, Node) is pinned to an exact version — see the
[`Dockerfile`](Dockerfile)'s header comment for the full list and rationale.
`gcloud`/`gke-gcloud-auth-plugin` are the one documented exception (Google's
apt repo doesn't retain old versions the way Terraform's does).

**TLS**: nginx serves plain HTTP by default (matching this feature's scope —
automated certificate provisioning is out of scope). To serve real HTTPS,
bring your own certificate, mount it into the nginx container, and uncomment
the HTTPS `server` block in [`nginx/nginx.conf`](nginx/nginx.conf) — see that
file's comments for the exact steps, and set `LAB_UI_COOKIE_SECURE=true`
once you do.

**Known limitation**: `docker compose down`/host shutdown does not
gracefully signal any `scripts/lab` step (e.g. a k6 benchmark) that happens
to be running at that moment. Let an in-progress action finish, or use the
UI to trigger `down` on your lab, before stopping the container.

## Run without Docker

```sh
cd lab-control-ui/backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd ../backend
LAB_UI_SHARED_SECRET="choose-a-real-secret" \
LAB_REPO_ROOT="$(git rev-parse --show-toplevel)" \
npm start
```

Open `http://localhost:3000` (or whatever your reverse proxy maps to it —
see "Reaching port 80/443" below) and sign in with the shared secret.

**The app refuses to start if `LAB_UI_SHARED_SECRET` is unset or empty** —
it never falls back to serving unauthenticated (spec.md Edge Case 5).

Prerequisites beyond what `docs/getting-started-benchmark-lab.md` already
requires for the lab lifecycle itself (checked live by the app's own
prerequisite panel via `scripts/lab doctor`): **Node.js 22.x**
(`sudo apt-get install nodejs` on Debian/Ubuntu, or an equivalent pinned
install) and, if you want the app reachable on port 80/443 with TLS, a
reverse proxy (the Docker path above already includes one).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `LAB_UI_SHARED_SECRET` | *(required)* | Login credential. No default — startup fails without it. |
| `LAB_UI_PORT` | `3000` | Internal port the app listens on. |
| `LAB_REPO_ROOT` | auto-detected via `git rev-parse --show-toplevel` | Repo checkout containing `scripts/lab`. |
| `LAB_CLI_PATH` | `$LAB_REPO_ROOT/scripts/lab` | Override to point at a different `scripts/lab` (e.g. a stub, for testing). |
| `LAB_UI_DB_PATH` | `$LAB_REPO_ROOT/ansible/artifacts/lab/ui/lab-control-ui.db` | SQLite state file (ignored path, per this repo's convention). |
| `LAB_UI_RUNS_DIR` | `$LAB_REPO_ROOT/ansible/artifacts/lab/ui/runs` | Per-run captured log files. |
| `LAB_UI_FRONTEND_DIST` | `$LAB_REPO_ROOT/lab-control-ui/frontend/dist` | Where the built frontend lives. Only needs overriding when it's built somewhere other than inside `LAB_REPO_ROOT` (the Docker image sets this explicitly, since the frontend is baked into the image while `LAB_REPO_ROOT` there points at the separately bind-mounted checkout). |
| `LAB_UI_COOKIE_SECURE` | `false` | Set `true` when served over HTTPS so the session cookie gets the `Secure` flag. |

### Development

```sh
cd lab-control-ui/backend && npm run dev      # tsx watch, auto-restart
cd lab-control-ui/frontend && npm run dev     # Vite dev server, proxies /api to :3000
```

### Testing

```sh
cd lab-control-ui/backend && npm test         # vitest: unit + integration (stub scripts/lab, no real GCP)
cd lab-control-ui/frontend && npm test        # vitest + React Testing Library
```

### Reaching port 80/443 without Docker

The app itself binds an unprivileged port (avoiding the privilege increase
of running as root just to bind 80/443). Put a reverse proxy in front of it
for TLS termination and the public port, e.g. a minimal Caddyfile:

```
your-host.example.com {
  reverse_proxy localhost:3000
}
```

Caddy handles automatic HTTPS. Any reverse proxy works equally well — the
app has no opinion here beyond listening on plain HTTP internally. If you
use nginx instead of Caddy, base your config on
[`nginx/nginx.conf`](nginx/nginx.conf) (used by the Docker path) rather than
starting from scratch — it already has the SSE-specific settings the live
log stream needs (`proxy_buffering off`, a long `proxy_read_timeout`).
