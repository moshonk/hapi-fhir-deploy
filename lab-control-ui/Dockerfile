# Lab Control UI image: the Node backend (serving the built React frontend
# statically) PLUS the full scripts/lab toolchain (Terraform, Helm, kubectl,
# Ansible, Ruby, k6, Java, gcloud + gke-gcloud-auth-plugin). The container is
# the one spawning `scripts/lab` as a child process (research.md §1/§4), so
# it needs every tool `scripts/lab doctor` checks for on its own PATH --
# "always fire up the service" means the image is self-sufficient, not just
# the UI with prerequisites left to the host.
#
# Build context is this directory (lab-control-ui/); see docker-compose.yml.
# The actual scripts/lab checkout (scripts/, infra/, ansible/, benchmarks/,
# docs/) is bind-mounted at runtime, not baked into the image -- this keeps
# the image reusable across repo checkouts/branches and matches this
# feature's "runs on the same host/checkout as scripts/lab" design
# (research.md §1), now via a mount instead of a literal same-host process.
#
# Version pins (Constitution Principle III): every tool below is pinned to
# an exact, verified version. Bump deliberately, not with `latest`.
#   - Node 22.22.1 (base image tag)          -- matches package.json engines
#   - Terraform 1.9.8                        -- matches .github/workflows/ci.yml
#   - Helm v3.15.4                           -- matches docs/getting-started-benchmark-lab.md
#   - kubectl v1.35.6                        -- matches the GCP default kubernetes_version
#   - k6 2.2.0                               -- latest available on Grafana's Debian repo at pin time
#   - ansible-core 2.19.1 / kubernetes 36.0.3 -- matches ansible/requirements.txt exactly
#   - Ruby, OpenJDK 17                       -- Debian bookworm's own package versions (no
#     upstream apt repo offers exact pins for these the way Terraform/k6 do)
#   - gcloud CLI / gke-gcloud-auth-plugin    -- intentionally NOT version-pinned; Google's own
#     apt repo doesn't retain old package versions the way HashiCorp's does, and gcloud is
#     designed to self-update against Google's APIs -- pinning it here would just mean the
#     pin silently stops being installable. Documented exception to the "pin everything" rule.

FROM node:22.22.1-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22.22.1-bookworm-slim AS backend-build
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22.22.1-bookworm-slim AS runtime

# --- Terraform (HashiCorp apt repo, pinned) ---
# "bookworm" is hardcoded (not detected via lsb_release) because it's the
# base image's own codename by construction (node:*-bookworm-slim above) --
# more deterministic than depending on a tool this image doesn't otherwise need.
RUN apt-get update && apt-get install -y --no-install-recommends \
      gnupg curl ca-certificates \
    && curl -fsSL https://apt.releases.hashicorp.com/gpg \
      | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com bookworm main" \
      > /etc/apt/sources.list.d/hashicorp.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends terraform=1.9.8-1 \
    && rm -rf /var/lib/apt/lists/*

# --- k6 (Grafana apt repo, pinned) ---
RUN curl -fsSL https://dl.k6.io/key.gpg | gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
      > /etc/apt/sources.list.d/k6.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends k6=2.2.0 \
    && rm -rf /var/lib/apt/lists/*

# --- gcloud CLI + gke-gcloud-auth-plugin (Google apt repo, not version-pinned -- see header note) ---
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
      | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin \
    && rm -rf /var/lib/apt/lists/*

# --- Helm (direct binary, pinned) ---
RUN curl -fsSL https://get.helm.sh/helm-v3.15.4-linux-amd64.tar.gz | tar -xz -C /tmp \
    && mv /tmp/linux-amd64/helm /usr/local/bin/helm \
    && rm -rf /tmp/linux-amd64 \
    && helm version

# --- kubectl (direct binary, pinned to match the GCP default kubernetes_version) ---
RUN curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/v1.35.6/bin/linux/amd64/kubectl" \
    && chmod +x /usr/local/bin/kubectl \
    && kubectl version --client

# --- Ruby, OpenJDK 17, Python (for Ansible), git (scripts/lab's repo-root detection) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      ruby-full \
      openjdk-17-jre-headless \
      python3 python3-pip python3-venv \
      git \
    && rm -rf /var/lib/apt/lists/*

# --- Ansible (pip, pinned to match ansible/requirements.txt exactly) ---
# Installed system-wide (not the project-local venv the bare-metal runbook
# uses) since this container has no other Python workloads to isolate from.
# ansible-galaxy collection installs (ansible/requirements.yml) still happen
# at `deploy` time into the mounted repo's project-local
# .ansible/collections, exactly as documented -- nothing extra to bake in here.
RUN pip install --no-cache-dir --break-system-packages \
      ansible-core==2.19.1 \
      kubernetes==36.0.3

WORKDIR /app/lab-control-ui/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /src/backend/dist ./dist
COPY --from=frontend-build /src/frontend/dist /app/lab-control-ui/frontend/dist

# LAB_REPO_ROOT is set by docker-compose.yml to the mounted repo checkout's
# path -- not set here, since it's a runtime/deployment concern, not an
# image-build one (research.md §7 / config.ts's resolveConfig).
ENV LAB_UI_PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
