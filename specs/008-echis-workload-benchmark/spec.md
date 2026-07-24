# Feature Specification: eCHIS Progressive Workload Benchmark

**Feature Branch**: `008-echis-workload-benchmark`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Progressive performance benchmark for an electronic Community Health Information System (eCHIS), scaling from a small dataset to a peak of 100,000 concurrent users, 10,000,000 households, 30,000,000 individuals, and 180,000,000 base FHIR records. Realistic household/CHW data model (Group, RelatedPerson, PractitionerRole/CareTeam, Task, QuestionnaireResponse) and write-heavy CHW field workload (registration, home visits, sync), extending the existing k6/Synthea benchmark lab rather than replacing it."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Progressive Tier Execution Builds Confidence Incrementally (Priority: P1)

As a performance engineer, I can run a defined sequence of progressively larger eCHIS benchmark tiers against the same deployment, each validating a specific concurrent-user count and dataset size, so that confidence in peak-scale readiness is built incrementally rather than risked in one untested leap straight to peak load.

**Why this priority**: Every other capability in this spec exists to make one of these tiers executable. Without an ordered, verifiable tier sequence, there is no way to know whether the system is ready for the next order of magnitude.

**Independent Test**: Execute a single named tier end-to-end (dataset generation, load run, result publication) and confirm its recorded concurrent-user count, dataset totals, and pass/fail thresholds match that tier's definition.

**Acceptance Scenarios**:

1. **Given** a lower tier has already passed, **When** the next tier in the sequence is run, **Then** its target concurrent-user count and dataset size are strictly larger and clearly labeled.
2. **Given** a tier's thresholds are not met, **When** the run completes, **Then** the result is recorded as failed and the next tier is not attempted.
3. **Given** the two smallest existing tiers (100 concurrent users / 100,000 individuals and 1,000 concurrent users / 1,000,000 individuals), **When** they are re-run under this benchmark's data model, **Then** their previously-proven pass thresholds still hold, or the discrepancy is explicitly documented.

---

### User Story 2 - Realistic Household/CHW Data Model (Priority: P1)

As a solution architect evaluating eCHIS readiness, I can generate a synthetic dataset that represents households, the individuals who belong to them, community health workers, and each individual's visit and assessment history, so the benchmark reflects the actual shape of production eCHIS data rather than generic, unconnected patient records.

**Why this priority**: A benchmark that ignores households and CHWs cannot credibly claim to represent an eCHIS. This is what distinguishes this work from the existing generic-patient benchmark.

**Independent Test**: Generate a small dataset and confirm every individual belongs to exactly one household, every household is reachable from a community health worker's assigned catchment, and each individual has a plausible set of visit and assessment records.

**Acceptance Scenarios**:

1. **Given** a target household count and average household size, **When** the dataset is generated, **Then** the resulting individual count matches the target within a documented tolerance.
2. **Given** a generated household, **When** its members are inspected, **Then** each member is linked to that household and to at least one responsible community health worker.
3. **Given** a target total record count, **When** the dataset is generated, **Then** the actual total record count matches the target within a documented tolerance.

---

### User Story 3 - Write-Heavy CHW Field Workload (Priority: P1)

As a performance engineer, I can run a load test that simulates community health worker field activity — household registration, home-visit synchronization, and worklist checks — rather than only read and search traffic, so the benchmark exercises the write path that dominates real eCHIS usage.

**Why this priority**: The existing benchmark is entirely read-heavy and does not represent how CHWs actually use the system. Validating write throughput and correctness under load is at least as important as read latency for this use case.

**Independent Test**: Run the workload against a populated dataset and confirm that a majority of simulated traffic is write operations (registration and visit sync), with a documented minority of read operations (worklist checks, supervisor dashboards).

**Acceptance Scenarios**:

1. **Given** a running load test, **When** its operation mix is inspected, **Then** household-visit-sync and registration writes account for the majority of simulated traffic.
2. **Given** a simulated household visit, **When** the write completes successfully, **Then** the visit's encounter, observation, condition, and assessment records are all retrievable afterward.
3. **Given** a small subset of simulated users represent supervisors, **When** the workload runs, **Then** their traffic volume and operation mix are distinct from and much lower than CHW traffic.

---

### User Story 4 - Distributed Execution Beyond Single-Machine Capacity (Priority: P2)

As a performance engineer, I can run benchmark tiers whose dataset size or concurrent-user count exceeds what a single machine can generate or execute, by distributing the work across many parallel workers, so that the two highest tiers are actually executable rather than only theoretical.

**Why this priority**: The peak tiers are, by construction, larger than any single process can generate or drive. Without distributed execution, this spec's largest tiers cannot run at all.

**Independent Test**: Split a dataset-generation or load-generation task across multiple parallel workers and confirm the combined result matches what a single-worker run would have produced for an equivalent smaller target, with no duplicate or missing work across workers.

**Acceptance Scenarios**:

1. **Given** a generation task split across N workers, **When** all workers complete, **Then** the combined dataset contains no duplicate identifiers and no gaps in the target range.
2. **Given** a load-generation task split across N workers, **When** results are combined, **Then** throughput and failure-rate figures are summed correctly and latency percentiles are not computed by naively averaging per-worker percentiles.
3. **Given** one worker in a distributed run fails, **When** the overall task is evaluated, **Then** the failure is visible in the combined result rather than silently absorbed.

---

### User Story 5 - Comparable Published Results Across Tiers (Priority: P3)

As a stakeholder reviewing benchmark results, I can see a published report for each tier showing throughput, latency percentiles, failure rate, and dataset/concurrency context, so I can compare tiers and communicate readiness to decision-makers without inspecting raw logs.

**Why this priority**: The tiers only build confidence (User Story 1) if their results are legible and comparable; this is the reporting layer on top of the other capabilities.

**Independent Test**: After a tier completes, confirm a published report exists containing that tier's concurrent-user target, dataset totals, throughput, latency percentiles, and failure rate, in the same format as other tiers' reports.

**Acceptance Scenarios**:

1. **Given** two completed tiers, **When** their published reports are compared side by side, **Then** the same set of fields is present and comparable in both.
2. **Given** a tier run with distributed execution, **When** its report is published, **Then** it is a single combined report, not one report per worker.

### Edge Cases

- What happens when a distributed generation worker fails partway through its shard — is the tier's dataset considered valid, and how is a partial shard detected and retried?
- How does the system handle a household with zero members or an unusually large number of members, deviating from the average ratio?
- What happens when the community-health-worker-to-household ratio can't be evenly divided across the target household count?
- How does the workload behave when a simulated CHW's household roster or worklist is empty at the start of a run?
- What happens if a lower tier's previously-proven thresholds don't hold under the new write-heavy workload, even though they held under the old generic read-only workload?
- How is a tier's result handled if the run is interrupted before completion — is a partial result published, or discarded and re-run?
- What happens when the two highest tiers are attempted before the companion connection-pooling capability is available?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define an ordered sequence of benchmark tiers, each specifying a target concurrent-user count, individual count, household count, and total-record count, progressing from today's proven scale toward the peak target.
- **FR-002**: Each tier's dataset generation MUST be verifiable against its target household, individual, and total-record counts before that tier's load test begins.
- **FR-003**: The synthetic dataset MUST represent households, individuals belonging to households, community health workers, and each CHW's assigned household catchment as distinct, linked entities.
- **FR-004**: The synthetic dataset MUST include a representative mix of visit, observation, condition, task, and structured-assessment records per individual, consistent with a documented average records-per-individual ratio.
- **FR-005**: The load-test workload MUST include write operations representing household registration and home-visit synchronization, and these MUST account for the majority of simulated traffic.
- **FR-006**: The load-test workload MUST include a CHW worklist-check read pattern and a lower-volume supervisor/dashboard read pattern that is distinct from CHW-volume traffic.
- **FR-007**: The existing 100-concurrent-user and 1,000-concurrent-user generic-workload benchmark tiers and their prior results MUST remain available and unmodified so previously-recorded evidence stays comparable.
- **FR-008**: For tiers whose target concurrent-user count or dataset size exceeds single-machine generation or execution capacity, the system MUST support distributing dataset generation and load generation across multiple parallel workers.
- **FR-009**: Distributed execution MUST produce a single combined result per tier — dataset totals, throughput, failure rate, and operation mix — rather than requiring a reviewer to manually reconcile per-worker outputs.
- **FR-010**: Distributed execution MUST NOT report a combined latency percentile computed by naively averaging per-worker percentiles; percentile latency for distributed tiers MUST come from a single authoritative measurement source.
- **FR-011**: Each tier's published result MUST record its concurrent-user target, dataset totals, throughput, latency percentiles, and failure rate in a format comparable across tiers.
- **FR-012**: The two highest tiers MUST be documented as dependent on the connection-pooling capability defined in the companion infrastructure spec and MUST NOT be attempted against the unmodified native connection ceiling.
- **FR-013**: The benchmark MUST document, as an explicit known gap rather than a silent omission, that simulated workload traffic does not include per-user authentication.

### Key Entities

- **Household**: A home unit containing one or more member individuals; the unit through which a community health worker's catchment is organized.
- **Individual**: A person belonging to a household; the primary subject of visit, observation, condition, task, and assessment records.
- **Community Health Worker**: Field staff responsible for a catchment of households, generated at much lower cardinality than individuals, and the primary actor driving write traffic in the workload.
- **Visit / Assessment Record**: The set of clinical and workflow records (encounter, observation, condition, task, structured assessment) generated per individual, tied together by a single visit.
- **Benchmark Tier**: A named, ordered step in the progression, each with a target concurrent-user count and dataset size, and its own pass/fail thresholds.
- **Shard**: A partition of dataset generation or load generation assigned to one parallel worker, combined into a single result after completion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The 100-concurrent-user / 100,000-individual tier continues to pass its previously-proven latency, throughput, and failure-rate thresholds under the new data model, with no regression from prior results.
- **SC-002**: The 1,000-concurrent-user / 1,000,000-individual tier executes successfully at least once with recorded results, closing the previously undemonstrated gap.
- **SC-003**: The 10,000-concurrent-user / 10,000,000-individual tier executes successfully at least once with zero connection-budget violations, after the companion connection-pooling capability is in place.
- **SC-004**: The peak tier (100,000 concurrent users / 30,000,000 individuals / 10,000,000 households / 180,000,000 total records) executes successfully at least once with recorded, published results.
- **SC-005**: Every tier's dataset generation matches its target household, individual, and total-record counts within 1%.
- **SC-006**: A reviewer can compare throughput, latency, and failure rate across all tiers using only the published results, without inspecting raw logs.
- **SC-007**: Distributed dataset generation for the two highest tiers completes within a documented, bounded time window determined by an empirical calibration run, rather than the multi-day duration implied by extrapolating single-threaded generation.

## Assumptions

- Average household size (3 individuals) and average total records per individual (6, including the individual's own core record) are representative defaults for this benchmark and may be revised in future iterations.
- Community health workers are generated at roughly one per 100 households, consistent with real-world CHW-to-household ratios in comparable national programs; this ratio anchors the peak tier's concurrent-user target.
- The two highest tiers depend on the connection-pooling capability defined in the companion infrastructure spec (`007-pgbouncer-connection-pooling`) being implemented first; they are not achievable against today's unmodified deployment.
- The existing 100-user and 1,000-user generic-workload benchmark scripts and their results remain untouched and are preserved as historical evidence, not superseded by this work.
- Simulated CHW traffic does not include per-user authentication overhead; this is a deliberate, documented scope boundary for this iteration, not an oversight.
- Wall-clock time and infrastructure cost for the two highest tiers are not committed to fixed targets until an empirical calibration run establishes real throughput-per-worker figures.

## Source Context

- GitHub issues: #1 (Rev2 roadmap epic, referenced for context), #18 (benchmark-lab epic, extended by this spec). A new tracking issue should be filed that cross-references both #1 and #18 without nesting under either, since this work spans both.
- Related specs: `007-pgbouncer-connection-pooling` (companion infrastructure spec; the two highest tiers in this spec depend on its completion).
