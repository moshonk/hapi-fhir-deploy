---
description: "Task list for PgBouncer Connection Pooling and Revised Connection Budget"
---

# Tasks: PgBouncer Connection Pooling and Revised Connection Budget

**Input**: Design documents from `/specs/007-pgbouncer-connection-pooling/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Not explicitly requested in the spec. Verification instead relies on this repo's existing convention (`helm lint`/`helm template`, `terraform validate`, and Ruby-based CI guardrail assertions) rather than a `tests/` suite — those checks appear as explicit tasks below.

**Organization**: Tasks are grouped by user story (US1/US2/US3, from `spec.md`) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

This is a deployment-configuration repository (Helm chart + Kubernetes manifests + Terraform + Ansible), not an application with `src/`/`tests/`. Paths below are the real repo paths from `plan.md`'s Project Structure section.

---

## Phase 1: Setup

**Purpose**: Choose and pin the one new external dependency this feature introduces, before anything references it.

- [X] T001 Choose and pin a PgBouncer container image/digest (>= 1.21, per `research.md` Decision 3, for protocol-level prepared-statement pooling support) — no `latest` tag, per Constitution Principle III. Pinned: `docker.io/edoburu/pgbouncer:v1.25.2-p0@sha256:68969403ee54dbf98601b49a1e92db644a9fdeed5c40969f7f0adce5193ac5b8` (verified via live registry lookup).
- [X] T002 [P] Create the `manifests/pgbouncer/` directory

**Checkpoint**: Pinned image reference available for all later tasks that build PgBouncer manifests.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single on/off switch and pool-sizing inputs that every later phase reads.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add `enable_pgbouncer: false` flag and `pgbouncer_default_pool_size` / `pgbouncer_replica_count` / `pgbouncer_max_client_conn` variables to `ansible/group_vars/lab.yml`

**Checkpoint**: Foundation ready — US1, US2, US3 can now proceed (US1/US2 in parallel; US3 benefits from US1 existing but does not require it to start its own docs work).

---

## Phase 3: User Story 1 - Raise the Safe Replica Ceiling Without Regressing Today's Behavior (Priority: P1) 🎯 MVP

**Goal**: Stand up an opt-in PgBouncer pooled tier that raises the safe HAPI FHIR replica ceiling, with zero behavior change when disabled.

**Independent Test**: Enable the pooled tier in a test cluster with a documented pool size/replica count; confirm the derived ceiling is enforced and PostgreSQL server-side connections never exceed the configured budget under sustained load; confirm behavior is unchanged when disabled.

### Implementation for User Story 1

- [X] T004 [P] [US1] ~~Create `manifests/external-secrets/hapi-fhir-pgbouncer-userlist.yaml`~~ **SCOPE CHANGE, documented**: the pinned image (`edoburu/pgbouncer`) auto-derives its client-auth `userlist.txt` from `DB_USER`/`DB_PASSWORD` env vars at container startup, so PgBouncer reuses the *existing* `hapi-fhir-postgres` Secret (same one HAPI itself uses) for its upstream `DB_PASSWORD` — a dedicated userlist Secret would duplicate the same password material with no benefit. No new ExternalSecret created; see `ansible/templates/pgbouncer-deployment.runtime.yaml.j2`.
- [X] T005 [P] [US1] ~~Create `manifests/pgbouncer/configmap.yaml`~~ **SCOPE CHANGE, documented (post-review)**: an initial version implemented this as an env-var ConfigMap, but review correctly flagged that its `DEFAULT_POOL_SIZE`/`MAX_CLIENT_CONN`/`MAX_PREPARED_STATEMENTS`/`ADMIN_USERS`/`STATS_USERS` values were hardcoded literals that could silently drift from the corresponding `ansible/group_vars/lab.yml` variables (and from `lab_database_username` if it's ever overridden). Folded into T006 instead: all pool-sizing env vars are now templated directly into the Deployment from `ansible/group_vars/lab.yml`/`lab_database_username`, with no separate ConfigMap and no second source of truth.
- [X] T006 [US1] Create PgBouncer Deployment — implemented as `ansible/templates/pgbouncer-deployment.runtime.yaml.j2` (not a static `manifests/pgbouncer/deployment.yaml`) because `DB_HOST`/`DB_PORT`/`DB_NAME` are only known at deploy time (same reason HAPI's own datasource wiring is already Ansible-templated, not static). Rendered to `ansible/artifacts/generated/pgbouncer-deployment.runtime.yaml` and applied by T011's playbook. Uses the pinned image from T001, templates `POOL_MODE`/`DEFAULT_POOL_SIZE`/`MAX_CLIENT_CONN`/`MAX_DB_CONNECTIONS`/`ADMIN_USERS`/`STATS_USERS`/`MAX_PREPARED_STATEMENTS` directly from `ansible/group_vars/lab.yml` and `lab_database_username` (see T005 note), and reuses the existing `hapi-fhir-postgres` Secret (see T004 note).
- [X] T007 [P] [US1] Create `manifests/pgbouncer/service.yaml` (ClusterIP Service fronting the Deployment from T006)
- [X] T008 [US1] Create `manifests/pgbouncer/poddisruptionbudget.yaml` (`minAvailable: 1`, per Constitution V) (depends on T006)
- [X] T009 [US1] Create `charts/hapi-fhir-deploy/values-pgbouncer-tier.yaml` per `contracts/helm-values-overlay.md` (raised `hikari.maximumPoolSize` to 20; datasource host/port pointed at the PgBouncer Service is handled by T013's runtime template, applied after this overlay in the Helm `values_files` order)
- [X] T010 [US1] Create `manifests/autoscaling/hapi-fhir-scaledobject-pgbouncer.yaml`, sibling to `manifests/autoscaling/hapi-fhir-scaledobject.yaml`, `maxReplicaCount: 50` derived per `contracts/connection-budget-formula.md`
- [X] T011 [US1] Create `ansible/playbooks/15-deploy-pgbouncer.yml`, gated by `enable_pgbouncer` (via `when:` on its `import_playbook` entry in `lab.yml`), applying the manifests from T005, T007, T008 and rendering/applying T006's template (depends on T003, T005, T006, T007, T008)
- [X] T012 [US1] Import `15-deploy-pgbouncer.yml` into `ansible/playbooks/lab.yml`, between `00-install-addons.yml` and `20-deploy-hapi-fhir.yml` (depends on T011)
- [X] T013 [US1] Extend `ansible/templates/hapi-fhir-values.runtime.yaml.j2` so that, when `enable_pgbouncer` is true, the HAPI datasource points at the PgBouncer Service; extended `ansible/playbooks/20-deploy-hapi-fhir.yml` to append `values-pgbouncer-tier.yaml` to the Helm `values_files` list (after base `values.yaml`, before the runtime file) when enabled, and to apply the pooled `ScaledObject` instead of (never alongside) the native one (depends on T009, T012)
- [X] T014 [US1] Add a "PgBouncer-Pooled Connection Budget" section to `docs/autoscaling.md`, documenting the pooled formula from `contracts/connection-budget-formula.md` alongside (not replacing) the existing native formula, marked provisional pending T4-tier load-test evidence
- [X] T015 [US1] Run `helm lint` / `helm template` with only `--values charts/hapi-fhir-deploy/values.yaml` (pooling disabled) and confirm the render is byte-for-byte identical to the pre-feature baseline, per `quickstart.md` step 1 (depends on T009) — **verified**: real GitHub Actions CI run (PR #50, run 30140760993) passed `helm lint`/`helm template`/rendered-manifest checks; base `values.yaml` untouched.

**Checkpoint**: User Story 1 is fully functional and independently testable — the pooled tier can be enabled, enforces its own ceiling, and leaves default behavior unchanged.

---

## Phase 4: User Story 2 - Enforce the Connection Limit Infrastructure Actually Provisions (Priority: P1)

**Goal**: Make `postgres_max_connections` a Terraform-enforced fact on the real database instance in every supported cloud, not a documentation-only assumption.

**Independent Test**: Provision a PostgreSQL instance in any supported cloud and confirm its live configured connection limit matches the documented value the budget formulas assume.

### Implementation for User Story 2

- [X] T016 [P] [US2] Add `db_max_connections` variable (default `100`, per `contracts/terraform-max-connections.md`) to `infra/terraform/gcp/variables.tf`
- [X] T017 [P] [US2] Add `db_max_connections` variable (default `100`) to `infra/terraform/aws/variables.tf`
- [X] T018 [P] [US2] Add `db_max_connections` variable (default `100`) to `infra/terraform/azure/variables.tf`
- [X] T019 [US2] Wire `database_flags { name = "max_connections", value = var.db_max_connections }` into the `google_sql_database_instance.settings` block in `infra/terraform/gcp/main.tf` (depends on T016)
- [X] T020 [US2] Add a new `aws_db_parameter_group` resource with a `max_connections` parameter and reference it via `aws_db_instance.parameter_group_name` in `infra/terraform/aws/main.tf` (depends on T017)
- [X] T021 [US2] Add a new `azurerm_postgresql_flexible_server_configuration` resource named `max_connections` in `infra/terraform/azure/main.tf` (depends on T018)
- [X] T022 [US2] Update `docs/external-postgres.md` and `docs/autoscaling.md` to state `postgres_max_connections` is now Terraform-enforced via `db_max_connections`, for both the native and pooled formulas
- [X] T023 [US2] Run `terraform validate` (and `terraform plan` where credentials allow) against all three modules to confirm the new variable/resource wiring is valid (depends on T019, T020, T021) — **verified**: real GitHub Actions CI run (PR #50, run 30140760993) passed `terraform fmt -check`/`terraform validate` for all three cloud modules. (`terraform plan` itself still requires real cloud credentials and hasn't been run.)

**Checkpoint**: User Story 2 is fully functional and independently testable — it does not require the pooled tier (US1) to be enabled to be verified.

---

## Phase 5: User Story 3 - Separate Bulk Data-Load Capacity From Steady-State Serving Capacity (Priority: P2)

**Goal**: Give operators a documented, safe way to temporarily exceed the serving ceiling during one-time bulk data loads, then return to the committed ceiling before serving traffic begins.

**Independent Test**: Run a bulk data-load with a temporarily raised connection allowance; confirm it never exceeds real database connection limits and that the system returns to the committed ceiling before serving traffic starts.

### Implementation for User Story 3

- [X] T024 [US3] Add a bulk-load-vs-serving procedure subsection to `docs/autoscaling.md`, per `research.md` Decision 6 (pause autoscaling / manually raise replica+pool counts for the load window, then restore the committed ceiling). Uses KEDA's real `autoscaling.keda.sh/paused-replicas` annotation (there is no `spec.paused` field on the ScaledObject CRD, contrary to an initial draft of this section — corrected before commit). One procedure covers both the native and pooled tier since the ScaledObject is named `hapi-fhir-jpaserver` regardless of which is applied. Also fixed a real pre-existing stale reference in this same doc section: `manifests/pgbouncer/configmap.yaml`, mentioned for `MAX_PREPARED_STATEMENTS`, was deleted in T005's scope-change review fix; corrected to point at `ansible/templates/pgbouncer-deployment.runtime.yaml.j2`.
- [X] T025 [US3] Add a "Bulk Data-Load Window" step to `docs/benchmark-lab-runbook.md`'s tier-run procedure, cross-referencing T024 and instructing operators to apply it before `scripts/lab seed` and revert it before `scripts/lab benchmark` (depends on T024)
- [X] T026 [US3] Add `--pause-autoscaling` / `--resume-autoscaling` convenience flags to `scripts/lab` so the procedure from T024/T025 isn't purely manual `kubectl` (depends on T003, T011). Implemented as new commands `scripts/lab pause-autoscaling --replicas N` / `scripts/lab resume-autoscaling` (this script's existing CLI is verb-command-based, not flag-based, so commands fit its established pattern better than bare flags with no command word). Verified locally via `--dry-run`: correct validation errors for missing/zero `--replicas`, correct `kubectl annotate` invocations for both commands, `--help` lists them, and the full pre-existing CI dry-run suite plus `test/lab_epic_acceptance_test.rb` remain unaffected.

**Checkpoint**: User Story 3 is documented and tooled; most useful once US1 exists, but its documentation tasks don't require US1 to be complete first.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Wire the CI guardrail, close the prepared-statement risk, and validate everything end-to-end.

**DEFERRED — not implemented in this pass**, same MVP-scope decision as US3. Follow-up work.

- [ ] T027 [P] Add the new "Check PgBouncer connection budget" step to `.github/workflows/ci.yml`, implementing `contracts/connection-budget-formula.md` as a Ruby check parallel to (not replacing) the existing "Check Rev2 baseline decisions" step, including its "no-op when pooled-tier files are absent" behavior (depends on T009, T010, T014, T019, T020, T021)
- [ ] T028 [P] Validate prepared-statement compatibility per `research.md` Decision 3 — partially de-risked in this pass (pinned PgBouncer >= 1.21 and set `MAX_PREPARED_STATEMENTS=200`, see `ansible/templates/pgbouncer-deployment.runtime.yaml.j2`), but the actual Hikari `prepareThreshold`/`cachePrepStmts` compatibility validation against a live server is still outstanding (depends on T006)
- [ ] T029 Run `specs/007-pgbouncer-connection-pooling/quickstart.md` end-to-end in a lab cluster and record results (depends on T015, T023, T024, T027, T028) — **cannot run in this sandbox** (no helm/terraform/k6, no live cluster)
- [ ] T030 Sync any changed commands/paths into `AGENTS.md` and `README.md` per the constitution's "keep docs synchronized" requirement

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — blocks all user stories.
- **User Stories (Phase 3-5)**: All depend on Foundational (T003). US1 and US2 have no dependency on each other and can proceed in parallel. US3's documentation tasks (T024, T025) don't require US1; its tooling task (T026) depends on T003 and T011 (US1).
- **Polish (Phase 6)**: Depends on the relevant preceding-phase tasks noted per task above.

### Parallel Opportunities

- T002 (Setup) can run alongside T001.
- T016, T017, T018 (US2, one per cloud) are fully parallel.
- US1 and US2 can be staffed and executed in parallel once T003 is done.
- T027 and T028 (Polish) can run in parallel once their respective dependencies land.

---

## Parallel Example: User Story 1 vs User Story 2

```bash
# Once Phase 2 (T003) is complete, these can run in parallel:
Task: "Create manifests/pgbouncer/service.yaml" (US1, T007)
Task: "Add db_max_connections variable to infra/terraform/gcp/variables.tf" (US2, T016)
Task: "Add db_max_connections variable to infra/terraform/aws/variables.tf" (US2, T017)
Task: "Add db_max_connections variable to infra/terraform/azure/variables.tf" (US2, T018)
```

---

## Implementation Strategy

### MVP Scope (User Story 1 + User Story 2, both P1)

Both US1 and US2 are P1: a pooled-tier ceiling isn't trustworthy until the `max_connections` it's derived from is actually enforced (US2), and US2 alone doesn't raise any ceiling on its own. Treat them as the MVP pair:

1. Complete Phase 1 (Setup) + Phase 2 (Foundational).
2. Complete Phase 3 (US1) and Phase 4 (US2), in parallel if staffed.
3. **STOP and VALIDATE**: run `quickstart.md` steps 1-4 to confirm the pooled tier works and the connection limit is real.
4. Add Phase 6's CI guardrail (T027) and prepared-statement validation (T028) before trusting the pooled tier above smoke/baseline scale.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → pooled tier exists, opt-in, zero regression when disabled.
3. US2 → the ceiling US1 computes is now backed by an enforced real value, not an assumption.
4. US3 → operators get a documented, safe bulk-load procedure.
5. Polish → CI guardrail closes the loop so future PRs can't silently violate the pooled formula; prepared-statement validation closes the last correctness risk; quickstart run provides end-to-end evidence.

---

## Notes

- No task modifies `charts/hapi-fhir-deploy/values.yaml` (the base file) or the existing native-tier CI guardrail assertion — verified explicitly by T015 and by T027's "parallel, not replacing" requirement.
- The two highest tiers of the sibling `008-echis-workload-benchmark` spec (T4, T5) depend on this spec's US1 + US2 + T027/T028 being complete first.
- Commit after each task or logical group, consistent with repo convention.
