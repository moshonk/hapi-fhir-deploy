# Feature Specification: Lab Control UI

**Feature Branch**: `009-lab-control-ui`

**Created**: 2026-08-16

**Status**: Draft

**Input**: User description: "Build a simple, extensible web control UI for operating scripts/lab labs, starting with GCP. A web UI (frontend + small backend) that runs on the same host as scripts/lab, reachable on port 80/443, that lets an operator configure a lab run with autofilled defaults, trigger lab lifecycle actions (up, deploy, expose-fhir/unexpose-fhir, expose-prometheus/unexpose-prometheus, pause-autoscaling/resume-autoscaling, seed, benchmark, report, down) as discrete steps, stream live logs to the browser with run history, check prerequisites up front with pass/warn/fail status, and warn clearly before costly or destructive actions. Protected by a simple shared-secret login. Provider-extensible beyond GCP even though only GCP is implemented now."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
-->

### User Story 1 - First-Time Operator Reaches a Runnable Configuration Fast (Priority: P1)

As an operator who has never run this lab tooling before, I open the control UI, see my prerequisite status at a glance, and land on a lab configuration form that is already filled with sensible defaults for every field except the one thing only I can know (my GCP project ID) — so I can get to a valid, launchable configuration in minutes instead of re-deriving the right flag combination from the runbook docs by hand.

**Why this priority**: This is the core value proposition ("emphasis on simplicity ... reduce complexity of getting started"). Without it, the UI is no faster than the existing terminal runbook, and every other capability is built on top of a configuration the operator was able to reach.

**Independent Test**: Load the UI with no prior state, fill in only the project ID, and confirm every other field already shows a valid default value (mirroring `docs/gcp-echis-t3-lab-runbook.md`'s example shapes) that would produce a runnable `up` invocation without further edits.

**Acceptance Scenarios**:

1. **Given** a fresh UI session with no saved configuration, **When** the operator opens the "Configure Lab" screen, **Then** every field has a pre-filled default value except fields the system cannot reasonably guess (e.g., GCP project ID), which are visibly marked as required and block the next step until filled.
2. **Given** the operator changes one field (e.g., node size), **When** they move to another field, **Then** the rest of the configuration retains its previous values rather than resetting to defaults.
3. **Given** a filled-in configuration, **When** the operator asks to see the equivalent command, **Then** the UI shows the exact `scripts/lab up ...` invocation that configuration will produce, so the mapping from form to CLI is never a black box.

---

### User Story 2 - Operator Runs the Lab Lifecycle From The UI With Live Feedback (Priority: P1)

As an operator, I trigger each lab lifecycle step (provision, deploy, expose endpoints, seed data, benchmark, publish report, tear down) from buttons in the UI, and I watch each step's output stream live in the browser as it runs, so I always know whether a long-running step is progressing or stuck without switching to a terminal.

**Why this priority**: This is the second half of the core value proposition ("trigger actions from the UI and I view the logs"). Configuration alone (Story 1) has no value if the operator still has to drop to a terminal to actually run anything.

**Independent Test**: From a provisioned lab, trigger the "deploy" step and confirm log output appears in the browser incrementally (not only after the step finishes), the step is clearly marked running/succeeded/failed, and the same output remains viewable afterward from a run history list.

**Acceptance Scenarios**:

1. **Given** a configured lab that has not been provisioned yet, **When** the operator clicks "Provision" (`up`), **Then** the UI streams that step's output live and updates the step's status to running, then succeeded or failed, without requiring a page reload.
2. **Given** a lab lifecycle step that depends on a prior step (e.g., `seed` requires `deploy` to have completed; the T3 eCHIS tier requires a prior successful T2 run, per the CLI's own sequencing guard), **When** the operator attempts to trigger it out of order, **Then** the UI reflects the CLI's own refusal (surfacing its actual error) rather than silently allowing or separately re-validating the action.
3. **Given** a step that already ran, **When** the operator opens run history, **Then** they can select that past run and view its full captured output, including which configuration produced it.
4. **Given** a step is currently running, **When** the operator closes and reopens the browser tab, **Then** they can reconnect to the in-progress log stream and see output from where the step currently stands, not just from the point they reopened.

---

### User Story 3 - Operator Sees Prerequisite and Risk Warnings Before Acting (Priority: P2)

As an operator, before I can trigger an action that would fail or cost money, the UI tells me plainly what's missing (a tool, an auth session) or what's risky (billable resource creation, opening a public 0.0.0.0/0 firewall rule, destroying infrastructure) so I don't discover a broken prerequisite mid-run or an unintended public exposure after the fact.

**Why this priority**: Directly requested ("check for prerequisites and provide warnings"). This is what keeps the simplicity of Story 1/2 from becoming a footgun — it's safety scaffolding around the actions, not a new capability of its own, so it ranks below the actions it protects.

**Independent Test**: With a required CLI tool intentionally missing or a GCP auth session intentionally expired, load the UI and confirm the missing prerequisite is shown with a clear fail status and the actions that need it are visibly blocked or flagged, without needing to trigger an action first to discover the problem.

**Acceptance Scenarios**:

1. **Given** the UI loads, **When** prerequisite checks run, **Then** each required tool/credential is shown with a pass, warn, or fail status, matching what `scripts/lab up`'s own preflight check already verifies.
2. **Given** one or more prerequisites are failing, **When** the operator attempts an action that needs them, **Then** the UI blocks or requires explicit confirmation, and states which prerequisite is the blocker.
3. **Given** the operator is about to trigger `expose-fhir`/`expose-prometheus`/`expose-grafana` with its default 0.0.0.0/0 exposure, **When** they click the action, **Then** the UI shows an explicit warning naming the exposure scope and requires confirmation before proceeding.
4. **Given** the operator is about to trigger `up` (billable resource creation) or `down` (destructive teardown), **When** they click the action, **Then** the UI requires explicit confirmation naming what will happen before proceeding.

---

### User Story 4 - Operator Logs In Before Doing Anything Else (Priority: P2)

As the operator who deployed this control UI, I must sign in with a shared secret before I can view lab state or trigger any action, so that the UI being reachable on a public port doesn't hand control of billable/destructive actions to anyone who finds the address.

**Why this priority**: A prerequisite for safely exposing Stories 1-3 on a public port at all, but it is not itself part of the "configure and run a lab" value — it's a gate in front of that value, so it can be built once the actions it's gating exist to be tested against.

**Independent Test**: With no active session, attempt to load any lab-state or action-triggering view and confirm access is refused until a valid shared secret is submitted; confirm a valid secret grants access for the rest of the session.

**Acceptance Scenarios**:

1. **Given** no active session, **When** the operator opens the UI, **Then** they are shown a login prompt and cannot view lab configuration, trigger actions, or view logs until authenticated.
2. **Given** an incorrect shared secret, **When** submitted, **Then** access is refused with a generic failure message that does not reveal whether the secret was close.
3. **Given** a valid shared secret, **When** submitted, **Then** the operator's session remains authenticated for subsequent actions until they log out or the session expires.

---

### User Story 5 - A New Provider Can Be Added Without Reworking The UI (Priority: P3)

As a maintainer, when a non-GCP provider (AWS, Azure — both already modeled by `scripts/lab --cloud`) is ready to be added, I can plug in its provider-specific configuration fields and available actions without redesigning the configuration form, action flow, or log-streaming mechanism, because those are already provider-agnostic.

**Why this priority**: Explicitly requested ("should be extendible to accommodate the other providers") and shapes the architecture, but no non-GCP provider ships in this feature — this is a design constraint validated by inspection, not a user-facing capability delivered now.

**Independent Test**: Review the configuration schema and action-mapping design and confirm GCP-specific fields (region/zone, node size, DB SKU/edition, public-exposure options) are isolated from provider-agnostic fields (lab name, ttl_hours, k6 profile) such that a second provider could declare its own field set and action availability without modifying shared UI logic.

**Acceptance Scenarios**:

1. **Given** the configuration schema, **When** a maintainer inspects it, **Then** GCP-specific fields are clearly separated from fields common to every provider.
2. **Given** the action list, **When** a maintainer inspects it, **Then** provider-only actions (e.g., `expose-fhir`, `expose-prometheus`, `expose-grafana`, which the CLI documents as GCP-only) are marked as such rather than assumed universal.

---

### Edge Cases

- What happens when the operator navigates away or the browser disconnects mid-action? The action must keep running server-side and its log history must remain retrievable on reconnect (see Story 2, Scenario 4).
- What happens when two operators (or two tabs) are logged in at once and one triggers an action already running from the other? The UI must reflect that an action is already in progress for that lab and prevent a duplicate concurrent trigger, rather than starting a second conflicting process.
- What happens when a triggered action fails partway through (e.g., `deploy` fails on a datasource error)? The step must be clearly marked failed with the captured output visible, and dependent next steps must remain blocked until it is retried successfully.
- What happens when the underlying `scripts/lab` CLI itself changes its flags/behavior (new prerequisite, new subcommand, renamed flag) in a way the UI's configuration form doesn't yet know about? The UI must fail visibly (surfacing the CLI's own error) rather than silently sending a stale or incorrect invocation.
- What happens when the shared secret is left at an insecure/default value? The UI must not fall back to running unauthenticated if login setup was skipped or misconfigured — it must refuse to serve any state or action endpoint without a valid session.
- What happens if the operator's session expires while an action is running? The action keeps running server-side; re-authenticating restores visibility into it rather than losing track of it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present a lab configuration form covering the fields used by the documented GCP lab lifecycle (provider, lab name, region/zone, node size, cluster min/max nodes, DB edition/SKU/disk size, ttl_hours, eCHIS tier or households/individuals-per-household/seed, k6 profile), with every field pre-filled with a default value derived from this repository's existing documented examples.
- **FR-002**: The system MUST require only fields that cannot be reasonably defaulted (at minimum, the GCP project ID) before a configuration is considered launchable; all other fields MUST be editable but not blocking.
- **FR-003**: The system MUST let the operator preview the exact underlying `scripts/lab` command a given configuration will produce, before the action is triggered.
- **FR-004**: The system MUST expose each lab lifecycle step documented in `docs/lab-cli.md` and `docs/gcp-echis-t3-lab-runbook.md` (provision/`up`, `deploy`, `expose-fhir`/`unexpose-fhir`, `expose-prometheus`/`unexpose-prometheus`, `expose-grafana`/`unexpose-grafana`, `pause-autoscaling`/`resume-autoscaling`, `seed`, `benchmark`, `report`, `down`) as a distinct, individually-triggerable action in the UI.
- **FR-005**: The system MUST execute each triggered action by invoking the existing `scripts/lab` CLI (or its documented environment-variable contract) rather than re-implementing the CLI's own validation, sequencing, or default-resolution logic in a second, independent form.
- **FR-006**: The system MUST surface the CLI's own success/failure/refusal outcome for an action (including sequencing refusals such as the T2-before-T3 eCHIS tier guard) to the operator, rather than presenting a separately-derived status.
- **FR-007**: The system MUST stream an in-progress action's output to the browser incrementally as it is produced, not only after the action completes.
- **FR-008**: The system MUST allow an operator to reconnect to an in-progress action's log stream (e.g., after a page reload) and see the output produced since the action started, not only output produced after reconnecting.
- **FR-009**: The system MUST retain the captured output of completed actions, associated with the lab and the configuration that produced them, and MUST let the operator browse and view this run history after the fact.
- **FR-010**: The system MUST check, on load and before allowing prerequisite-dependent actions, the presence and basic usability of each tool/credential the lab lifecycle depends on (at minimum: Terraform, Helm, kubectl, Ruby, k6, Java, the `gcloud` CLI, `gke-gcloud-auth-plugin`, the pinned Ansible virtualenv/collections, and an active `gcloud`/application-default credential with a project set), and present each as pass, warn, or fail.
- **FR-011**: The system MUST prevent, or require explicit confirmation before, triggering an action whose required prerequisite is in a failing state.
- **FR-012**: The system MUST require explicit operator confirmation, with a stated description of the consequence, before triggering an action that provisions billable cloud resources (`up`), destroys infrastructure (`down`), or opens a public network exposure (`expose-fhir`, `expose-prometheus`, `expose-grafana`).
- **FR-013**: The system MUST NOT allow any lab configuration, action trigger, log, or run-history view to be accessed without an authenticated session.
- **FR-014**: The system MUST authenticate operators via a single shared secret configured at deployment time, establishing a session upon successful submission.
- **FR-015**: The system MUST reject an incorrect shared secret without revealing whether the submitted value was partially correct.
- **FR-016**: The system MUST prevent two concurrent triggers of the same action against the same lab; a second trigger attempt while one is already running MUST be refused with a message identifying the in-progress action.
- **FR-017**: The system's configuration schema and action set MUST represent provider-specific fields and provider-specific actions (e.g., GCP's `expose-fhir`/`expose-prometheus`/`expose-grafana`, region/zone, DB SKU/edition) as distinct from fields and actions common to every provider, so that a future non-GCP provider can be added by declaring its own fields/actions without modifying shared configuration, action-triggering, or log-streaming behavior.
- **FR-018**: For this feature's scope, the system MUST implement only the GCP provider's fields and actions; other providers (`--cloud aws|azure`, already accepted by `scripts/lab` itself) are out of scope for implementation but MUST NOT be precluded by the design (see FR-017).
- **FR-019**: The system MUST continue running a triggered action to completion on the server independent of the operator's browser connection state, and MUST record its outcome regardless of whether anyone was watching when it finished.

### Key Entities

- **Lab Configuration**: A named, editable set of field values (provider, provider-agnostic fields such as name/ttl/k6 profile, and provider-specific fields such as GCP region/node size/DB SKU) that together determine the exact `scripts/lab` invocation an action will use. Has a validity state (launchable vs. blocked on a required field).
- **Action Run**: A single triggered execution of one lifecycle step (e.g., `up`, `deploy`, `seed`) against one Lab Configuration at a point in time. Has a status (pending, running, succeeded, failed), a start/end time, a captured output log, and a reference to the configuration and prior Action Runs it depended on.
- **Prerequisite Check**: A single tool/credential verification result (name, pass/warn/fail status, and human-readable detail) produced by evaluating the operator's environment against what the lab lifecycle requires.
- **Operator Session**: An authenticated state established by submitting the shared secret, scoping access to configuration, actions, and logs until it ends.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time operator with prerequisites already satisfied can go from opening the UI to having triggered lab provisioning in under 5 minutes, entering only their GCP project ID and accepting defaults for everything else.
- **SC-002**: 100% of documented lab lifecycle actions (provision, deploy, expose/unexpose FHIR, expose/unexpose Prometheus, expose/unexpose Grafana, pause/resume autoscaling, seed, benchmark, report, destroy) are triggerable from the UI without the operator needing a separate terminal session.
- **SC-003**: An operator watching a running action sees new output appear in the browser within a few seconds of it being produced, matching what they would see watching the same command in a terminal.
- **SC-004**: 100% of prerequisite failures that would cause a lab lifecycle action to fail are visible in the UI's prerequisite status before the operator triggers that action, not discovered only from the action's failure output.
- **SC-005**: Every action that creates billable resources, destroys infrastructure, or opens a public network exposure requires an explicit confirmation step naming the consequence, with zero such actions triggerable by a single accidental click.
- **SC-006**: An operator can reload the browser mid-action and, within a few seconds of the page loading, see the action's live status and log continue from where it stood, with zero loss of output produced while disconnected.
- **SC-007**: No lab state, action trigger, or log content is ever visible to a request that has not completed the shared-secret login.

## Assumptions

- The UI backend runs on the same host/checkout as `scripts/lab` (e.g., the GCE control-plane VM already used in the documented runbooks) and invokes it as a local subprocess; remote/SSH-based execution of `scripts/lab` on a different host is out of scope for this feature.
- Exactly one operator identity is assumed (a single shared secret); multi-user accounts, roles, and per-user permissions are out of scope for this feature.
- The UI is a control surface over the existing `scripts/lab` CLI and its documented environment-variable contract; it does not need to duplicate the CLI's internal default-resolution, sequencing-guard, or validation logic, only surface the CLI's own outcomes.
- Only the GCP provider's fields and actions are implemented in this feature; AWS/Azure support is a future feature built on this feature's provider-extensible design, not delivered here.
- Automated TLS certificate provisioning for serving on port 443 is out of scope; basic HTTPS termination is assumed to be handled by whatever is already documented/available on the deployment host (e.g., a reverse proxy), and the UI itself is only required to be reachable on port 80 or 443.
- "Run history" persistence is scoped to the lifetime of the control UI's own storage on its host; it is not required to survive that host being torn down (the same host that also runs the lab it is orchestrating, per the same-host assumption above).
- Mobile-optimized layout is out of scope; the UI is expected to be used from a desktop browser, consistent with the existing terminal-based operator workflow it replaces.
