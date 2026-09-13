import http from "k6/http";
import encoding from "k6/encoding";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const PROFILE_CONFIGS = {
  smoke: {
    executor: "constant-vus",
    vus: 1,
    duration: "1m",
    sleepSeconds: 1,
    httpFailureThreshold: "rate<0.05",
    durationThresholds: ["p(95)<3000", "p(99)<5000"]
  },
  baseline: {
    executor: "constant-vus",
    vus: 5,
    duration: "5m",
    sleepSeconds: 0.5,
    httpFailureThreshold: "rate<0.01",
    durationThresholds: ["p(95)<2000", "p(99)<5000"],
    gateStartTime: "5m10s",
    requirePrometheusGates: true
  },
  load: {
    executor: "ramping-vus",
    stages: [
      { duration: "5m", target: 10 },
      { duration: "10m", target: 25 },
      { duration: "5m", target: 25 },
      { duration: "2m", target: 0 }
    ],
    sleepSeconds: 0.25,
    httpFailureThreshold: "rate<0.01",
    durationThresholds: ["p(95)<3000", "p(99)<7000"]
  },
  stress: {
    executor: "ramping-vus",
    stages: [
      { duration: "5m", target: 25 },
      { duration: "10m", target: 50 },
      { duration: "10m", target: 75 },
      { duration: "5m", target: 0 }
    ],
    sleepSeconds: 0.1,
    httpFailureThreshold: "rate<0.02",
    durationThresholds: ["p(95)<5000", "p(99)<10000"]
  }
};

const OPERATION_WEIGHTS = [
  ["capability_statement", 5],
  ["patient_search", 18],
  ["patient_read", 22],
  ["observation_search", 25],
  ["encounter_search", 12],
  ["condition_search", 12],
  ["mixed_search", 6]
];

const DEFAULT_HEADERS = {
  Accept: "application/fhir+json"
};

export const healthSuccess = new Rate("fhir_health_success");
export const prometheusGateAvailable = new Rate("fhir_prometheus_gate_available");
export const noPodRestarts = new Rate("fhir_no_pod_restarts");
export const hikariConnectionHeadroom = new Rate("fhir_hikari_connection_headroom");
export const operationDuration = new Trend("fhir_operation_duration", true);
export const operationTotal = new Counter("fhir_operation_total");
export const capabilityStatementTotal = new Counter("fhir_operation_capability_statement_total");
export const patientSearchTotal = new Counter("fhir_operation_patient_search_total");
export const patientReadTotal = new Counter("fhir_operation_patient_read_total");
export const observationSearchTotal = new Counter("fhir_operation_observation_search_total");
export const encounterSearchTotal = new Counter("fhir_operation_encounter_search_total");
export const conditionSearchTotal = new Counter("fhir_operation_condition_search_total");
export const bulkExportTotal = new Counter("fhir_operation_bulk_export_total");
export const householdSyncWriteTotal = new Counter("fhir_operation_household_sync_write_total");
export const registrationWriteTotal = new Counter("fhir_operation_registration_write_total");
export const worklistReadTotal = new Counter("fhir_operation_worklist_read_total");
export const householdRosterReadTotal = new Counter("fhir_operation_household_roster_read_total");
export const supervisorDashboardReadTotal = new Counter("fhir_operation_supervisor_dashboard_read_total");
export const syncDownloadReadTotal = new Counter("fhir_operation_sync_download_read_total");
export const patientEverythingReadTotal = new Counter("fhir_operation_patient_everything_read_total");
export const householdScopedReadTotal = new Counter("fhir_operation_household_scoped_read_total");
export const syncUploadWriteTotal = new Counter("fhir_operation_sync_upload_write_total");

const OPERATION_COUNTERS = {
  capability_statement: capabilityStatementTotal,
  patient_search: patientSearchTotal,
  patient_read: patientReadTotal,
  observation_search: observationSearchTotal,
  encounter_search: encounterSearchTotal,
  condition_search: conditionSearchTotal,
  bulk_export: bulkExportTotal,
  household_sync_write: householdSyncWriteTotal,
  registration_write: registrationWriteTotal,
  worklist_read: worklistReadTotal,
  household_roster_read: householdRosterReadTotal,
supervisor_dashboard_read: supervisorDashboardReadTotal,
  sync_download_read: syncDownloadReadTotal,
  patient_everything_read: patientEverythingReadTotal,
  household_scoped_read: householdScopedReadTotal,
  sync_upload_write: syncUploadWriteTotal
};

export function profileOptions(profile) {
  const config = profileConfig(profile);
  const thresholds = {
    http_req_failed: [config.httpFailureThreshold],
    http_req_duration: config.durationThresholds,
    checks: ["rate>0.95"],
    fhir_health_success: ["rate==1"]
  };

  if (config.requirePrometheusGates) {
    thresholds.fhir_prometheus_gate_available = ["rate==1"];
    thresholds.fhir_no_pod_restarts = ["rate==1"];
    thresholds.fhir_hikari_connection_headroom = ["rate==1"];
  }

  const scenarios = {
    fhir_workload: scenarioFor(config)
  };

  if (config.requirePrometheusGates) {
    scenarios.baseline_gates = {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: config.gateStartTime || config.duration,
      exec: "baselineGates"
    };
  }

  return {
    summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max"],
    scenarios,
    thresholds,
    userAgent: `hapi-fhir-deploy-k6/${profile}`
  };
}

export function benchmarkSetup(profile, workload = "generic") {
  const baseUrl = requiredEnv("FHIR_BASE_URL");
  const config = profileConfig(profile);
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);
  workloadFor(workload); // fail fast on an unknown workload name

  const patientIds = discoverPatientIds(normalizedBaseUrl);
  const prometheusBefore = config.requirePrometheusGates
    ? prometheusSnapshot("before")
    : { available: false };

  return {
    profile,
    workload,
    baseUrl: normalizedBaseUrl,
    patientIds,
    bulkExportEnabled: envBool("BULK_EXPORT_ENABLED", false),
    observationDateStart: __ENV.OBSERVATION_DATE_START || "1900-01-01",
supervisorCountWindowHours: envNumber("SUPERVISOR_COUNT_WINDOW_HOURS", 1),
echisSeededHouseholds: envNumber("ECHIS_SEEDED_HOUSEHOLDS", 0),
echisSeededIndividualsPerHousehold: envNumber("ECHIS_SEEDED_INDIVIDUALS_PER_HOUSEHOLD", 3),
echisSyncPageSize: envNumber("ECHIS_SYNC_PAGE_SIZE", 200),
echisSyncMaxPages: envNumber("ECHIS_SYNC_MAX_PAGES", 3),
echisSyncWindowMinutes: envNumber("ECHIS_SYNC_WINDOW_MINUTES", 60),
    sleepSeconds: config.sleepSeconds,
    prometheusBefore
  };
}

export function runFhirWorkload(data) {
  if (__ITER === 0) {
    healthCheck(data);
  }

  const workloadConfig = workloadFor(data.workload);
  dispatchOperation(data, operationWeightsFor(data, workloadConfig), workloadConfig.handlers, data.bulkExportEnabled);

  sleep(data.sleepSeconds);
}

// Runs the same dispatch as runFhirWorkload but with one or more operations excluded
// from the weighted draw -- for tier scripts that run those operations on a separate
// scenario/executor instead (see
// specs/008-echis-workload-benchmark/contracts/workloads-registry.md's Executor contract).
export function runFhirWorkloadExcluding(data, ...excludedOperations) {
  if (__ITER === 0) {
    healthCheck(data);
  }

  const workloadConfig = workloadFor(data.workload);
  const weights = operationWeightsFor(data, workloadConfig).filter(([name]) => !excludedOperations.includes(name));
  // chooseOperation() re-adds bulk_export on its own whenever bulkExportEnabled is true
  // and a handler exists, regardless of what's in the filtered weights -- so excluding
  // "bulk_export" here must also suppress it via bulkExportEnabled, not just the weights.
  const bulkExportEnabled = data.bulkExportEnabled && !excludedOperations.includes("bulk_export");
  dispatchOperation(data, weights, workloadConfig.handlers, bulkExportEnabled);

  sleep(data.sleepSeconds);
}

function dispatchOperation(data, operationWeights, handlers, bulkExportEnabled) {
  const operation = chooseOperation({ operationWeights, handlers }, bulkExportEnabled);

  if (operation === "mixed_search") {
    group("mixed read/search traffic", () => {
      patientSearch(data);
      patientRead(data);
      observationSearch(data);
    });
  } else {
    const handler = handlers[operation];
    if (typeof handler !== "function") {
      throw new Error(`No handler registered for operation "${operation}" in workload "${data.workload}"`);
    }
    handler(data);
  }
}

export function benchmarkTeardown() {}

export function runBaselineGates(data) {
  healthCheck(data);

  if (!profileConfig(data.profile).requirePrometheusGates) {
    return;
  }

  const after = prometheusSnapshot("after");
  prometheusGateAvailable.add(after.available);

  if (!after.available || !data.prometheusBefore.available) {
    noPodRestarts.add(false);
    hikariConnectionHeadroom.add(false);
    return;
  }

  noPodRestarts.add(after.podRestarts === data.prometheusBefore.podRestarts);
  hikariConnectionHeadroom.add(after.hikariHeadroomOk === true);
}

export function benchmarkSummary(data, profile) {
  // total_requests/failed_requests/duration_seconds exist so a multi-shard run
  // (scripts/merge_k6_shards.rb, spec 008 US4) can recompute merged throughput
  // and failure rate from summed absolute counts, per
  // specs/008-echis-workload-benchmark/contracts/merged-report.md -- a rate
  // alone can't be summed or averaged across shards without distorting it.
  const totalRequests = metricValue(data.metrics.http_reqs, "count") || 0;
  const httpFailureRate = metricValue(data.metrics.http_req_failed, "rate") || 0;
  // http_req_failed is a Rate metric, whose k6 summary values include an exact
  // count alongside the rate -- prefer it over round(total * rate), which can
  // drift from the true count and would make merge_k6_shards.rb recompute
  // merged failure rates from already-inaccurate inputs.
  //
  // Counter-intuitively, k6's own "passes"/"fails" keys name which BOOLEAN
  // VALUE was added to the Rate sink, not which outcome is semantically good
  // or bad for this particular metric: "passes" = count of true additions,
  // "fails" = count of false additions. Since http_req_failed adds `true`
  // for a FAILED request, "passes" is the failed-request count and "fails"
  // is the successful-request count -- the reverse of what the names
  // suggest. This is k6's own well-known upstream naming quirk (confirmed
  // live: a run with a true 1.03% failure rate reported failed_requests as
  // ~99% of total here before this fix) -- see grafana/k6#2386, #5679,
  // #4751.
  const exactFailedRequests = metricValue(data.metrics.http_req_failed, "passes");
  const failedRequests = exactFailedRequests !== null ? exactFailedRequests : Math.round(totalRequests * httpFailureRate);
  const durationSeconds =
    data.state && typeof data.state.testRunDurationMs === "number" ? data.state.testRunDurationMs / 1000 : null;

  const summary = {
    profile: profile || __ENV.PROFILE || "unknown",
    latency_ms: trendSummary(data.metrics.http_req_duration),
    throughput_reqs_per_sec: metricValue(data.metrics.http_reqs, "rate"),
    http_failure_rate: httpFailureRate,
    total_requests: totalRequests,
    failed_requests: failedRequests,
    duration_seconds: durationSeconds,
    operation_mix: operationMix(data.metrics),
    gates: {
      health_success_rate: metricValue(data.metrics.fhir_health_success, "rate"),
      prometheus_gate_available_rate: metricValue(data.metrics.fhir_prometheus_gate_available, "rate"),
      no_pod_restarts_rate: metricValue(data.metrics.fhir_no_pod_restarts, "rate"),
      hikari_connection_headroom_rate: metricValue(data.metrics.fhir_hikari_connection_headroom, "rate")
    }
  };

  const output = {
    stdout: `${JSON.stringify(summary, null, 2)}\n`
  };
  if (__ENV.K6_FHIR_SUMMARY_PATH) {
    output[__ENV.K6_FHIR_SUMMARY_PATH] = `${JSON.stringify(summary, null, 2)}\n`;
  }
  return output;
}

function scenarioFor(config) {
  if (config.executor === "ramping-vus") {
    return {
      executor: config.executor,
      stages: config.stages,
      gracefulRampDown: "30s"
    };
  }

  return {
    executor: config.executor,
    vus: config.vus,
    duration: config.duration,
    gracefulStop: "30s"
  };
}

function profileConfig(profile) {
  const config = PROFILE_CONFIGS[profile];
  if (!config) {
    throw new Error(`Unsupported k6 profile: ${profile}`);
  }
  return config;
}

function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function envNumber(name, defaultValue) {
  const value = __ENV[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envBool(name, defaultValue) {
  const value = __ENV[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].indexOf(String(value).toLowerCase()) >= 0;
}

function discoverPatientIds(baseUrl) {
  const configured = (__ENV.FHIR_PATIENT_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (configured.length > 0) {
    return configured;
  }

  const response = http.get(`${baseUrl}/Patient?_count=20`, {
    headers: DEFAULT_HEADERS,
    tags: { fhir_operation: "patient_search", fhir_phase: "setup" }
  });
  if (response.status !== 200) {
    console.warn(`Patient discovery failed with HTTP ${response.status}; patient read/search operations will degrade to searches.`);
    return [];
  }

  const bundle = parseJson(response);
  return (bundle.entry || [])
    .map((entry) => entry.resource || {})
    .filter((resource) => resource.resourceType === "Patient" && resource.id)
    .map((resource) => resource.id);
}

function chooseOperation(workload, bulkExportEnabled) {
  // Only offer bulk_export if the workload actually registers a handler for
  // it (today only `generic` does) -- otherwise a workload with no
  // bulk_export handler (e.g. the `echis` placeholder) could have it drawn
  // and then crash on a missing handler instead of failing clearly.
  const canBulkExport = bulkExportEnabled && typeof workload.handlers.bulk_export === "function";
  const effectiveWeights = canBulkExport
    ? workload.operationWeights.concat([["bulk_export", 1]])
    : workload.operationWeights;
  if (effectiveWeights.length === 0) {
    throw new Error("No operations configured for this workload");
  }
  const total = effectiveWeights.reduce((sum, entry) => sum + entry[1], 0);
  let draw = Math.random() * total;

  for (const entry of effectiveWeights) {
    draw -= entry[1];
    if (draw <= 0) {
      return entry[0];
    }
  }
  return effectiveWeights[effectiveWeights.length - 1][0];
}

const operationHandlers = {
  capability_statement: capabilityStatement,
  patient_search: patientSearch,
  patient_read: patientRead,
  observation_search: observationSearch,
  encounter_search: encounterSearch,
  condition_search: conditionSearch,
  bulk_export: bulkExport
};

// household_sync_write + registration_write MUST account for the majority
// of traffic (spec 008 FR-005). supervisor_dashboard_read is deliberately
// low-weight rather than gated to a VU subset -- see the comment on
// supervisorDashboardRead() for why.
const ECHIS_OPERATION_WEIGHTS = [
  ["household_sync_write", 50],
  ["registration_write", 10],
  ["worklist_read", 20],
  ["household_roster_read", 15],
["supervisor_dashboard_read", 5]
];

// Sync-engine operations against a dataset scripts/echis_seed.rb loaded,
// from the "OHS FHIR Sync -- API Call Inventory & Performance Simulation
// Baseline" document: tag-scoped first/incremental pulls, Patient
// $everything, known-household roster reads, and PUT+PATCH uploads. Unlike
// the operations above these read SEEDED ids, so they join the draw only
// when ECHIS_SEEDED_HOUSEHOLDS is set to that seed run's --households;
// unset, the echis mix (and every existing tier's comparability) is
// unchanged.
const ECHIS_SEEDED_SYNC_OPERATION_WEIGHTS = [
  ["sync_download_read", 20],
  ["patient_everything_read", 8],
  ["household_scoped_read", 7],
  ["sync_upload_write", 5]
];

function operationWeightsFor(data, workloadConfig) {
  if (data.workload === "echis" && data.echisSeededHouseholds > 0) {
    return workloadConfig.operationWeights.concat(ECHIS_SEEDED_SYNC_OPERATION_WEIGHTS);
  }
  return workloadConfig.operationWeights;
}

const echisOperationHandlers = {
  household_sync_write: householdSyncWrite,
  worklist_read: worklistRead,
  household_roster_read: householdRosterRead,
  registration_write: registrationWrite,
supervisor_dashboard_read: supervisorDashboardRead,
  sync_download_read: syncDownloadRead,
  patient_everything_read: patientEverythingRead,
  household_scoped_read: householdScopedRead,
  sync_upload_write: syncUploadWrite
};

// Generalizes the operation-weight/handler set so `generic` (today's
// unchanged behavior) and `echis` (specs/008-echis-workload-benchmark,
// populated by that spec's US3) can coexist. See
// specs/008-echis-workload-benchmark/contracts/workloads-registry.md.
const WORKLOADS = {
  generic: {
    operationWeights: OPERATION_WEIGHTS,
    handlers: operationHandlers
  },
  echis: {
    operationWeights: ECHIS_OPERATION_WEIGHTS,
    handlers: echisOperationHandlers
  }
};

function workloadFor(name) {
  const workload = WORKLOADS[name];
  if (!workload) {
    throw new Error(`Unsupported k6 workload: ${name}`);
  }
  return workload;
}

function capabilityStatement(data) {
  requestOperation(data, "capability_statement", "/metadata", (response) => (
    response.status === 200 && jsonResourceType(response) === "CapabilityStatement"
  ));
}

function healthCheck(data) {
  const response = http.get(`${data.baseUrl}/metadata`, {
    headers: DEFAULT_HEADERS,
    tags: { fhir_operation: "capability_statement", fhir_phase: "gate" }
  });
  const healthy = response.status === 200 && jsonResourceType(response) === "CapabilityStatement";
  healthSuccess.add(healthy);
  check(response, {
    "FHIR capability statement health gate is successful": () => healthy
  });
}

// _total=none on every paginated list search below (not on
// supervisorDashboardRead's /Patient?_summary=count, which asks for a
// total BY DESIGN): live root-cause via Cloud SQL Query Insights during a
// `load`-profile run showed a single query --
// `SELECT COUNT(DISTINCT t0.RES_ID) FROM HFJ_RESOURCE t0 WHERE
// t0.RES_TYPE = $1 AND t0.RES_DELETED_AT IS NULL` -- as by far the
// costliest in the whole run (~4,121s of cumulative DB time from one
// shard alone, more than the run's own wall-clock duration). That's
// HAPI's default per-search Bundle.total computation: with no predicate
// narrower than RES_TYPE, a plain `?_count=20` list search forces an
// unfiltered COUNT DISTINCT over the whole (large, concurrently-written)
// resource table for every single page fetched. It directly explains the
// separately-observed p99 tail (docs/autoscaling.md "Tail latency"):
// server-side hikaricp_connections_usage_seconds_max/
// http_server_requests_seconds_max both showed individual requests
// holding a connection for 60-142s under concurrent write load, while
// connection ACQUIRE wait and GC pauses were both trivial -- i.e. the
// stall was inside a query, not the pool. This starter image has no
// exposed config surface for JpaStorageSettings' default total mode
// (checked live: hapi-fhir-jpaserver-starter's AppProperties.java has no
// such property), so `_total=none` per-request is the only lever
// available short of forking the pinned image. `_total=none` is also a
// recognized real-world FHIR client performance practice, not just a
// benchmark workaround -- these operations don't consume Bundle.total.
function patientSearch(data) {
  requestOperation(data, "patient_search", "/Patient?_count=20&_total=none", (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function patientRead(data) {
  const id = randomPatientId(data);
  if (!id) {
    patientSearch(data);
    return;
  }
  requestOperation(data, "patient_read", `/Patient/${encodeURIComponent(id)}`, (response) => (
    response.status === 200 && jsonResourceType(response) === "Patient"
  ));
}

function observationSearch(data) {
  const id = randomPatientId(data);
  const query = id
    ? `patient=${encodeURIComponent(id)}&date=ge${encodeURIComponent(data.observationDateStart)}&_count=20&_total=none`
    : `_count=20&_total=none`;
  requestOperation(data, "observation_search", `/Observation?${query}`, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function encounterSearch(data) {
  const id = randomPatientId(data);
  const query = id ? `patient=${encodeURIComponent(id)}&_count=20&_total=none` : `_count=20&_total=none`;
  requestOperation(data, "encounter_search", `/Encounter?${query}`, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function conditionSearch(data) {
  const id = randomPatientId(data);
  const query = id ? `patient=${encodeURIComponent(id)}&_count=20&_total=none` : `_count=20&_total=none`;
  requestOperation(data, "condition_search", `/Condition?${query}`, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function bulkExport(data) {
  requestOperation(data, "bulk_export", "/$export?_type=Patient,Observation,Encounter,Condition", (response) => (
    response.status === 202 || response.status === 200
  ), {
    Accept: "application/fhir+json",
    Prefer: "respond-async"
  });
}

// --- echis workload (specs/008-echis-workload-benchmark, User Story 3) ---
//
// Resource IDs are derived from k6's __VU/__ITER globals rather than
// requiring a pre-seeded dataset, so this workload is self-sufficient and
// runnable against a server with no pre-existing data (spec Independent
// Test for US3): each VU maintains one stable "assigned" household
// (echis-hh-vu<VU>) that householdSyncWrite/householdRosterRead read and
// revisit every iteration via idempotent PUT, while each call to
// registrationWrite creates a genuinely new household
// (echis-hh-vu<VU>-reg<ITER>), representing new registrations happening
// over the course of the run.
//
// __VU is local to each k6 process: running this workload distributed across
// manifests/k6-shard-job/ pods (multiple independent k6 processes, each with
// its own VU numbering starting at 1) would otherwise collide every shard's
// VU N onto the identical resource IDs, serializing writes across shards on
// the same rows. SHARD_ID disambiguates them; it defaults to "0" so a single,
// non-sharded k6 run is unaffected.
const SHARD_ID = __ENV.SHARD_INDEX || "0";

function householdSyncWrite(data) {
  const vu = __VU;
  const iter = __ITER;
  const unitId = selfContainedUnitId();
  const householdId = `echis-hh-s${SHARD_ID}-vu${vu}`;
  const patientId = `echis-p-s${SHARD_ID}-vu${vu}`;
  const chwId = `echis-chw-s${SHARD_ID}-vu${vu}`;
  const encounterId = `echis-enc-s${SHARD_ID}-vu${vu}-${iter}`;
  const observationId = `echis-obs-s${SHARD_ID}-vu${vu}-${iter}`;
  const conditionId = `echis-cond-s${SHARD_ID}-vu${vu}-${iter}`;
  const questionnaireResponseId = `echis-qr-s${SHARD_ID}-vu${vu}-${iter}`;
  const taskId = `echis-task-s${SHARD_ID}-vu${vu}`;
  const now = new Date().toISOString();

  const bundle = echisTransactionBundle([
    // taskResource below references this by id -- must exist in the same
    // transaction, since nothing else in this workload ever creates a
    // PractitionerRole, and Task.owner is validated on write (HAPI-1094).
    practitionerRoleResource(chwId, unitId),
    householdResource(householdId, [patientId], chwId, unitId),
    patientResource(patientId, vu, unitId, chwId),
    encounterResource(encounterId, patientId, now, unitId),
    observationResource(observationId, patientId, encounterId, questionnaireResponseId, now, iter, unitId),
    conditionResource(conditionId, patientId, vu, unitId),
    questionnaireResponseResource(questionnaireResponseId, patientId, encounterId, now, iter, unitId),
    // "requested", not "completed": worklistRead() searches status=requested,
    // so the follow-up task this visit creates/refreshes must match that
    // query -- otherwise a VU's own household_sync_write writes would never
    // be findable by its own worklist_read (review comment).
    taskResource(taskId, patientId, chwId, "requested", unitId)
  ]);

  requestWriteOperation(data, "household_sync_write", "POST", "/", bundle, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function registrationWrite(data) {
  const vu = __VU;
  const iter = __ITER;
  const unitId = selfContainedUnitId();
  const householdId = `echis-hh-s${SHARD_ID}-vu${vu}-reg${iter}`;
  const headPatientId = `echis-p-s${SHARD_ID}-vu${vu}-reg${iter}`;
  const relatedPersonId = `echis-rp-s${SHARD_ID}-vu${vu}-reg${iter}`;

  // No managingEntity/generalPractitioner here: this bundle carries no
  // PractitionerRole, and a registration can run before this VU's first
  // household_sync_write has created one (HAPI enforces the reference).
  const bundle = echisTransactionBundle([
    householdResource(householdId, [headPatientId], null, unitId),
    patientResource(headPatientId, vu * 100000 + iter, unitId, null),
    relatedPersonResource(relatedPersonId, headPatientId, unitId)
  ]);

  requestWriteOperation(data, "registration_write", "POST", "/", bundle, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function worklistRead(data) {
  const chwId = `echis-chw-s${SHARD_ID}-vu${__VU}`;
  requestOperation(
    data,
    "worklist_read",
    `/Task?owner=${encodeURIComponent(`PractitionerRole/${chwId}`)}&status=requested&_count=20&_total=none`,
    (response) => response.status === 200 && jsonResourceType(response) === "Bundle"
  );
}

function householdRosterRead(data) {
  const householdId = `echis-hh-s${SHARD_ID}-vu${__VU}`;
  // A _id search (not a direct instance GET) so this always returns a
  // Bundle (200), even before householdSyncWrite/registrationWrite has run
  // for this VU yet -- a direct `Group/{id}` read would 404 in that window.
  requestOperation(
    data,
    "household_roster_read",
    `/Group?_id=${encodeURIComponent(householdId)}&_include=Group:member&_count=20&_total=none`,
    (response) => response.status === 200 && jsonResourceType(response) === "Bundle"
  );
}

function supervisorDashboardRead(data) {
  // Spec calls for a "small, distinct VU subset representing supervisors."
  // Implemented as a low weight (5 of 100, see ECHIS_OPERATION_WEIGHTS)
  // shared across all VUs instead of gating by VU identity: it achieves the
  // same low-volume traffic shape without adding a second selection
  // dimension (which VUs vs. which operations) to chooseOperation.
  //
  // The count is BOUNDED by a recent _lastUpdated window, not taken over
  // the whole table. This used to be a bare `/Patient?_summary=count` --
  // an exact count of every Patient in the database -- and that single
  // choice dominated every tail-latency number this benchmark has ever
  // produced. Measured, at ~2M patients (EXPLAIN ANALYZE against the live
  // lab, idle db-custom-2-7680): a ~3.5s parallel sequential scan plus an
  // external-merge sort that spills to disk, and no index can help,
  // because Patient is ~41% of hfj_resource -- far past the selectivity
  // where a B-tree beats a seq scan (every index-forced plan measured
  // 13-94s against the planner's own 3.5s). At this workload's ~6.8%
  // share and the T3 shape's ~380 req/s, that is ~26 such queries/sec,
  // each holding a PgBouncer backend connection for its full ~3.5s: ~90
  // connection-seconds/sec of demand against a 40-connection backend
  // budget, 2.2x the entire budget before any other traffic is served.
  // That is why every OTHER operation's p99 also sat at 12-14s while p50
  // stayed near 100ms -- head-of-line blocking behind this one query, not
  // a cost of their own (see docs/autoscaling.md's tail-latency section
  // and the capacity-enhancement benchmark series).
  //
  // A supervisor dashboard tile is realistically "registrations in my
  // recent window", not "recount every patient who has ever existed, 26
  // times a second". Scoping by _lastUpdated turns it into a bounded range
  // scan over hfj_resource's existing idx_res_date (res_updated).
  //
  // SUPERVISOR_COUNT_WINDOW_HOURS=0 restores the old unbounded query, so a
  // run can still be made directly comparable to the stage 0-5 series that
  // predates this change.
  // The window start is floored to the MINUTE, not taken at millisecond
  // precision. HAPI caches search results by URL, and an exact timestamp
  // makes every request's URL unique -- defeating that cache and writing a
  // fresh search entity per call. Flooring means every supervisor request
  // inside the same minute shares one URL, so the cache does the repeat
  // work. A dashboard tile has no use for sub-minute freshness anyway.
  const windowHours = data.supervisorCountWindowHours;
  const windowStart = new Date(Date.now() - windowHours * 3600 * 1000);
  windowStart.setUTCSeconds(0, 0);
  const path =
    windowHours > 0
      ? `/Patient?_lastUpdated=gt${encodeURIComponent(windowStart.toISOString())}&_summary=count`
      : "/Patient?_summary=count";

  requestOperation(
    data,
    "supervisor_dashboard_read",
    path,
    (response) => response.status === 200 && jsonResourceType(response) === "Bundle"
  );
}

// Dedicated exec target for a k6 arrival-rate scenario, per research.md
// Decision 7 / specs/008-echis-workload-benchmark/contracts/workloads-registry.md's
// executor contract. Wired into an options.scenarios object in the
// echis_load_*.js tier scripts (spec 008 US1) alongside a ramping-vus scenario
// running runFhirWorkloadExcluding(data, "household_sync_write"), which avoids
// double-counting household_sync_write against this dedicated scenario.
export function runHouseholdSyncWrite(data) {
  householdSyncWrite(data);
  sleep(data.sleepSeconds);
}

function echisTransactionBundle(resources) {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: resources.map(putEntry)
  };
}

function putEntry(resource) {
  return { resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` } };
}

// --- echis resource shapes ---
//
// Mirror scripts/echis_seed.rb and the eCHIS dev server
// (docs/echis-data-model.md): supervision-location sync tag on every
// patient-data resource, NPHIIS CHV role, field Encounters linked to their
// PlanDefinition, and under-5 assessment responses whose Observations are
// derivedFrom the response. The self-contained operations tag their writes
// with a per-shard pseudo-unit so they never mix into a seeded unit's sync
// scope.
const SUPERVISION_LOCATION_TAG_SYSTEM = "https://www.example.com/CodeSystem/supervision-location";
const PLAN_DEFINITION_EXTENSION = "http://icl.ohs.echis.reference/fhir/StructureDefinition/instantiates-plan-definition";
const LAST_LAUNCHED_EXTENSION = "http://github.com/google-android/questionnaire-lastLaunched-timestamp";
const ECHIS_QUESTIONNAIRE_BASE = "https://echisv3.intellisoftkenya.com/fhir/Questionnaire";
const UNDER_FIVE_OBSERVATION_SYSTEM = "https://echisv3.intellisoftkenya.com/fhir/CodeSystem/under-5-observation";
const NPHIIS_ROLE_SYSTEM = "https://nphiis.health.go.ke/fhir/CodeSystem/nphiis-roles";

function selfContainedUnitId() {
  return `echis-loc-chu-k6-s${SHARD_ID}`;
}

function syncTag(unitId) {
  return { tag: [{ system: SUPERVISION_LOCATION_TAG_SYSTEM, code: unitId }] };
}

function planDefinitionExtension(planDefinitionId) {
  return { url: PLAN_DEFINITION_EXTENSION, valueCanonical: `PlanDefinition/${planDefinitionId}` };
}

function householdResource(id, memberPatientIds, chwId, unitId) {
  const resource = {
    resourceType: "Group",
    id,
    meta: syncTag(unitId),
    identifier: [{ system: "urn:demo:household", value: id }],
    active: true,
    type: "person",
    actual: true,
    name: `${id} Household`,
    member: memberPatientIds.map((patientId) => ({ entity: { reference: `Patient/${patientId}` } }))
  };
  if (chwId) {
    resource.managingEntity = { reference: `PractitionerRole/${chwId}` };
  }
  return resource;
}

function patientResource(id, index, unitId, chwId) {
  const birthYear = 1950 + (index % 60);
  const resource = {
    resourceType: "Patient",
    id,
    meta: syncTag(unitId),
    identifier: [{ system: "urn:demo:patient", value: id }],
    active: true,
    name: [{ use: "official", family: `EchisHousehold${index}`, given: [`Member${index}`] }],
    telecom: [{ system: "phone", value: `07${String(index % 100000000).padStart(8, "0")}`, use: "mobile" }],
    gender: index % 2 === 0 ? "female" : "male",
    birthDate: `${birthYear}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    address: [{ use: "home", city: "Benchmark Village", state: "Nairobi", country: "KE" }]
  };
  if (chwId) {
    resource.generalPractitioner = [{ reference: `PractitionerRole/${chwId}` }];
  }
  return resource;
}

function relatedPersonResource(id, headPatientId, unitId) {
  return {
    resourceType: "RelatedPerson",
    id,
    meta: syncTag(unitId),
    active: true,
    patient: { reference: `Patient/${headPatientId}` },
    relationship: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "SPS", display: "Spouse" }]
    }],
    name: [{ family: "EchisDependent", given: ["Member"] }]
  };
}

function encounterResource(id, patientId, timestamp, unitId, planDefinitionId = "plandefinition-under-5-workflow") {
  return {
    resourceType: "Encounter",
    id,
    meta: syncTag(unitId),
    extension: [planDefinitionExtension(planDefinitionId)],
    status: "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "FLD", display: "Field" },
    subject: { reference: `Patient/${patientId}` },
    period: { start: timestamp, end: timestamp }
  };
}

const ECHIS_OBSERVATION_ANSWERS = [
  {
    code: "fever",
    display: "Does {{name}} have a fever (hotness of the body)?",
    value: { valueCodeableConcept: { coding: [{ code: "no", display: "No" }] } }
  },
  { code: "breaths-per-minute", display: "How many breaths per minute?", value: { valueInteger: 32 } },
  {
    code: "muac-color",
    display: "What is the MUAC color?",
    value: { valueCodeableConcept: { coding: [{ code: "green", display: "Green" }] } }
  }
];

function observationResource(id, patientId, encounterId, questionnaireResponseId, timestamp, iter, unitId) {
  const selected = ECHIS_OBSERVATION_ANSWERS[iter % ECHIS_OBSERVATION_ANSWERS.length];
  return Object.assign(
    {
      resourceType: "Observation",
      id,
      meta: syncTag(unitId),
      status: "final",
      code: { coding: [{ system: UNDER_FIVE_OBSERVATION_SYSTEM, code: selected.code, display: selected.display }] },
      subject: { reference: `Patient/${patientId}` },
      encounter: { reference: `Encounter/${encounterId}` },
      effectiveDateTime: timestamp
    },
    selected.value,
    { derivedFrom: [{ reference: `QuestionnaireResponse/${questionnaireResponseId}` }] }
  );
}

const ECHIS_CONDITION_CODES = [
  { code: "61462000", display: "Malaria" },
  { code: "44054006", display: "Diabetes mellitus type 2" },
  { code: "56717001", display: "Tuberculosis" }
];

function conditionResource(id, patientId, vu, unitId) {
  const selected = ECHIS_CONDITION_CODES[vu % ECHIS_CONDITION_CODES.length];
  return {
    resourceType: "Condition",
    id,
    meta: syncTag(unitId),
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }]
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "provisional" }]
    },
    code: { coding: [{ system: "http://snomed.info/sct", code: selected.code, display: selected.display }] },
    subject: { reference: `Patient/${patientId}` }
  };
}

function questionnaireResponseResource(id, patientId, encounterId, timestamp, iter, unitId) {
  return {
    resourceType: "QuestionnaireResponse",
    id,
    meta: syncTag(unitId),
    extension: [
      { url: LAST_LAUNCHED_EXTENSION, valueDateTime: timestamp },
      planDefinitionExtension("plandefinition-under-5-workflow")
    ],
    questionnaire: `${ECHIS_QUESTIONNAIRE_BASE}/under-5-assessment-service-questionnaire`,
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    authored: timestamp,
    item: [
      {
        linkId: "page-intro",
        text: "Introduction",
        item: [{ linkId: "is-child-name-sick", text: "Is the child sick?", answer: [{ valueCoding: { code: "yes", display: "Yes" } }] }]
      },
      {
        linkId: "page-breathing",
        text: "Breathing",
        item: [{ linkId: "how-many-breaths-per-minute", text: "How many breaths per minute?", answer: [{ valueInteger: 30 + (iter % 12) }] }]
      },
      {
        linkId: "page-nutrition-muac",
        text: "Nutrition (MUAC)",
        item: [{ linkId: "what-is-the-muac-color", text: "What is the MUAC color?", answer: [{ valueCoding: { code: "green", display: "Green" } }] }]
      }
    ]
  };
}

function referralFollowUpResponse(id, patientId, encounterId, timestamp, unitId) {
  return {
    resourceType: "QuestionnaireResponse",
    id,
    meta: syncTag(unitId),
    extension: [
      { url: LAST_LAUNCHED_EXTENSION, valueDateTime: timestamp },
      planDefinitionExtension("plandefinition-referral-follow-up")
    ],
    questionnaire: `${ECHIS_QUESTIONNAIRE_BASE}/referral-follow-up-questionnaire`,
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    authored: timestamp,
    item: [
      { linkId: "is-available", text: "Is the client available?", answer: [{ valueCoding: { code: "yes", display: "Yes" } }] },
      { linkId: "did-go-to-the-health-facility", text: "Did the client go to the health facility?", answer: [{ valueCoding: { code: "yes", display: "Yes" } }] }
    ]
  };
}

function practitionerRoleResource(id, unitId) {
  return {
    resourceType: "PractitionerRole",
    id,
    meta: syncTag(unitId),
    active: true,
    code: [{ coding: [{ system: NPHIIS_ROLE_SYSTEM, code: "CHV", display: "CHV" }] }]
  };
}

function taskResource(id, patientId, chwId, status, unitId) {
  return {
    resourceType: "Task",
    id,
    meta: syncTag(unitId),
    extension: [planDefinitionExtension("plandefinition-referral-follow-up-alert")],
    instantiatesCanonical: "ActivityDefinition/act-refer-patient",
    status,
    intent: "order",
    priority: "urgent",
    code: { coding: [{ code: "follow-up-on-referral", display: "Follow up on referral" }] },
    for: { reference: `Patient/${patientId}` },
    owner: { reference: `PractitionerRole/${chwId}` }
  };
}

// --- echis seeded-dataset sync operations (opt-in, ECHIS_SEEDED_HOUSEHOLDS) ---
//
// Ids and catchment sizing mirror scripts/echis_seed.rb: 1,000 households
// per Community Health Unit (the sync-tag scope), and household sizes that
// cycle N, N+1, N-1 around ECHIS_SEEDED_INDIVIDUALS_PER_HOUSEHOLD.
const SEEDED_HOUSEHOLDS_PER_UNIT = 1000;
const SYNC_DOWNLOAD_TYPES = ["Group", "Patient", "Task", "QuestionnaireResponse", "Encounter", "Observation"];
const FIRST_SYNC_SHARE = 0.2;

function isBundleResponse(response) {
  return response.status === 200 && jsonResourceType(response) === "Bundle";
}

function zeroPad(value, width) {
  return String(value).padStart(width, "0");
}

function seededHouseholdIndex(data) {
  return Math.floor(Math.random() * data.echisSeededHouseholds);
}

function seededUnitId(householdIndex) {
  return `echis-loc-chu${zeroPad(Math.floor(householdIndex / SEEDED_HOUSEHOLDS_PER_UNIT), 6)}`;
}

function seededHouseholdId(householdIndex) {
  return `echis-hh${zeroPad(householdIndex, 8)}`;
}

function seededHeadPatientId(data, householdIndex) {
  const perHousehold = data.echisSeededIndividualsPerHousehold;
  const first = perHousehold < 2
    ? householdIndex * perHousehold
    : householdIndex * perHousehold + (householdIndex % 3 === 2 ? 1 : 0);
  return `echis-p${zeroPad(first, 8)}`;
}

// Floored to the minute for the same reason as supervisorDashboardRead():
// HAPI caches searches by URL, and devices syncing within the same minute
// realistically share a floor.
function syncWindowStart(data) {
  const start = new Date(Date.now() - data.echisSyncWindowMinutes * 60 * 1000);
  start.setUTCSeconds(0, 0);
  return encodeURIComponent(start.toISOString());
}

function tagParam(unitId) {
  return encodeURIComponent(`${SUPERVISION_LOCATION_TAG_SYSTEM}|${unitId}`);
}

function nextLink(response) {
  const link = (parseJson(response).link || []).find((candidate) => candidate.relation === "next");
  return link ? link.url : null;
}

// Pages a search the way the sync engine does, following each Bundle's
// "next" link up to ECHIS_SYNC_MAX_PAGES. The link is re-rooted on
// data.baseUrl because HAPI builds it from the address it saw (e.g. an
// in-cluster Service name behind a port-forward), not the one k6 dialed.
function requestPagedOperation(data, operation, path) {
  let response = requestOperation(data, operation, path, isBundleResponse);
  for (let page = 1; page < data.echisSyncMaxPages && response.status === 200; page += 1) {
    const next = nextLink(response);
    const queryStart = next ? next.indexOf("?") : -1;
    if (queryStart < 0) {
      break;
    }
    response = requestOperation(data, operation, next.substring(queryStart), isBundleResponse);
  }
}

function syncDownloadRead(data) {
  const unitId = seededUnitId(seededHouseholdIndex(data));
  const type = SYNC_DOWNLOAD_TYPES[Math.floor(Math.random() * SYNC_DOWNLOAD_TYPES.length)];
  // Most pulls are incremental; FIRST_SYNC_SHARE are a device's first sync
  // of this type, with no _lastUpdated floor.
  const floor = Math.random() < FIRST_SYNC_SHARE ? "" : `&_lastUpdated=gt${syncWindowStart(data)}`;
  requestPagedOperation(
    data,
    "sync_download_read",
    `/${type}?_tag=${tagParam(unitId)}&_count=${data.echisSyncPageSize}&_sort=_lastUpdated${floor}`
  );
}

function patientEverythingRead(data) {
  const patientId = seededHeadPatientId(data, seededHouseholdIndex(data));
  const since = Math.random() < 0.5 ? `?_since=${syncWindowStart(data)}` : "";
  requestPagedOperation(data, "patient_everything_read", `/Patient/${patientId}/$everything${since}`);
}

function householdScopedRead(data) {
  const first = seededHouseholdIndex(data);
  const ids = [first, first + 1, first + 2]
    .filter((householdIndex) => householdIndex < data.echisSeededHouseholds)
    .map(seededHouseholdId);
  const floor = Math.random() < 0.5 ? `&_lastUpdated=gt${syncWindowStart(data)}` : "";
  requestOperation(data, "household_scoped_read", `/Group?_id=${ids.join(",")}&_include=Group:member${floor}`, isBundleResponse);
}

// Upload sub-phase: new visit resources as PUTs plus a JSON Patch to an
// existing seeded Patient, in one transaction -- the patch makes a real
// change (HumanName.text), so it creates a new Patient version the way a
// device edit would.
function syncUploadWrite(data) {
  const householdIndex = seededHouseholdIndex(data);
  const unitId = seededUnitId(householdIndex);
  const patientId = seededHeadPatientId(data, householdIndex);
  const suffix = `s${SHARD_ID}-vu${__VU}-${__ITER}`;
  const encounterId = `echis-enc-sync-${suffix}`;
  const now = new Date().toISOString();
  const patch = [{ op: "add", path: "/name/0/text", value: `Synced ${now.substring(0, 16)}` }];

  const bundle = {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      putEntry(encounterResource(encounterId, patientId, now, unitId, "plandefinition-referral-follow-up")),
      putEntry(referralFollowUpResponse(`echis-qr-sync-${suffix}`, patientId, encounterId, now, unitId)),
      {
        resource: {
          resourceType: "Binary",
          contentType: "application/json-patch+json",
          data: encoding.b64encode(JSON.stringify(patch))
        },
        request: { method: "PATCH", url: `Patient/${patientId}` }
      }
    ]
  };

  requestWriteOperation(data, "sync_upload_write", "POST", "/", bundle, isBundleResponse);
}

function requestOperation(data, operation, path, successful, headers) {
  const response = http.get(`${data.baseUrl}${path}`, {
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    tags: { fhir_operation: operation }
  });

  return finishOperation(operation, response, successful);
}

// POST/PUT counterpart to requestOperation, for write-heavy workloads
// (specs/008-echis-workload-benchmark). Added alongside, not in place of,
// requestOperation so every existing GET-only call site is unaffected.
function requestWriteOperation(data, operation, method, path, body, successful, headers) {
  if (method !== "POST" && method !== "PUT") {
    throw new Error(`Unsupported write method "${method}" for operation "${operation}"; expected POST or PUT`);
  }
  const requestFn = method === "PUT" ? http.put : http.post;
  const response = requestFn(`${data.baseUrl}${path}`, JSON.stringify(body), {
    headers: Object.assign({ "Content-Type": "application/fhir+json" }, DEFAULT_HEADERS, headers || {}),
    tags: { fhir_operation: operation }
  });

  return finishOperation(operation, response, successful);
}

function finishOperation(operation, response, successful) {
  recordOperation(operation, response);
  check(response, {
    [`${operation} successful`]: successful
  });
  return response;
}

function recordOperation(operation, response) {
  operationTotal.add(1, { operation });
  operationDuration.add(response.timings.duration, { operation });

  const counter = OPERATION_COUNTERS[operation];
  if (counter) {
    counter.add(1);
  }
}

function randomPatientId(data) {
  if (!data.patientIds || data.patientIds.length === 0) {
    return null;
  }
  return data.patientIds[Math.floor(Math.random() * data.patientIds.length)];
}

function jsonResourceType(response) {
  return parseJson(response).resourceType;
}

function parseJson(response) {
  try {
    return response.json();
  } catch (error) {
    return {};
  }
}

function prometheusSnapshot(phase) {
  const prometheusBaseUrl = __ENV.PROMETHEUS_BASE_URL;
  if (!prometheusBaseUrl) {
    console.warn(`PROMETHEUS_BASE_URL is required for baseline ${phase} gates.`);
    return { available: false };
  }

  const podRestarts = prometheusQueryNumber(
    trimTrailingSlash(prometheusBaseUrl),
    __ENV.POD_RESTARTS_QUERY || defaultPodRestartsQuery()
  );
  const hikariActive = prometheusQueryNumber(
    trimTrailingSlash(prometheusBaseUrl),
    __ENV.HIKARI_ACTIVE_QUERY || defaultHikariActiveQuery()
  );
  const hikariMaxMetric = prometheusQueryNumber(
    trimTrailingSlash(prometheusBaseUrl),
    __ENV.HIKARI_MAX_QUERY || defaultHikariMaxQuery()
  );
  const fallbackCapacity = Number(__ENV.HIKARI_MAX_POOL_SIZE || 10) * Number(__ENV.HAPI_REPLICAS || 2);
  const hikariCapacity = Number.isFinite(hikariMaxMetric) && hikariMaxMetric > 0
    ? hikariMaxMetric
    : fallbackCapacity;
  const maxUtilization = Number(__ENV.HIKARI_MAX_UTILIZATION || 0.8);

  return {
    available: Number.isFinite(podRestarts) && Number.isFinite(hikariActive) && Number.isFinite(hikariCapacity),
    podRestarts,
    hikariActive,
    hikariCapacity,
    hikariHeadroomOk: Number.isFinite(hikariActive) && hikariActive < hikariCapacity * maxUtilization
  };
}

function prometheusQueryNumber(prometheusBaseUrl, query) {
  const response = http.get(`${prometheusBaseUrl}/api/v1/query?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
    tags: { fhir_operation: "prometheus_gate" }
  });

  if (response.status !== 200) {
    console.warn(`Prometheus query failed with HTTP ${response.status}: ${query}`);
    return Number.NaN;
  }

  const body = parseJson(response);
  const result = (((body || {}).data || {}).result || [])[0];
  const value = result && result.value ? Number(result.value[1]) : Number.NaN;
  if (!Number.isFinite(value)) {
    console.warn(`Prometheus query returned no numeric value: ${query}`);
  }
  return value;
}

function defaultPodRestartsQuery() {
  const namespace = __ENV.HAPI_NAMESPACE || "fhir";
  const podRegex = __ENV.HAPI_POD_REGEX || "hapi-fhir-hapi-fhir-jpaserver-.*";
  return `sum(kube_pod_container_status_restarts_total{namespace="${namespace}",pod=~"${podRegex}"})`;
}

function defaultHikariActiveQuery() {
  const namespace = __ENV.HAPI_NAMESPACE || "fhir";
  return `sum(hikaricp_connections_active{namespace="${namespace}"})`;
}

function defaultHikariMaxQuery() {
  const namespace = __ENV.HAPI_NAMESPACE || "fhir";
  return `sum(hikaricp_connections_max{namespace="${namespace}"})`;
}

function trendSummary(metric) {
  return {
    p50: metricValue(metric, "p(50)"),
    p95: metricValue(metric, "p(95)"),
    p99: metricValue(metric, "p(99)")
  };
}

function operationMix(metrics) {
  return {
    capability_statement: metricValue(metrics.fhir_operation_capability_statement_total, "count") || 0,
    patient_search: metricValue(metrics.fhir_operation_patient_search_total, "count") || 0,
    patient_read: metricValue(metrics.fhir_operation_patient_read_total, "count") || 0,
    observation_search: metricValue(metrics.fhir_operation_observation_search_total, "count") || 0,
    encounter_search: metricValue(metrics.fhir_operation_encounter_search_total, "count") || 0,
    condition_search: metricValue(metrics.fhir_operation_condition_search_total, "count") || 0,
    bulk_export: metricValue(metrics.fhir_operation_bulk_export_total, "count") || 0,
    household_sync_write: metricValue(metrics.fhir_operation_household_sync_write_total, "count") || 0,
    registration_write: metricValue(metrics.fhir_operation_registration_write_total, "count") || 0,
    worklist_read: metricValue(metrics.fhir_operation_worklist_read_total, "count") || 0,
    household_roster_read: metricValue(metrics.fhir_operation_household_roster_read_total, "count") || 0,
supervisor_dashboard_read: metricValue(metrics.fhir_operation_supervisor_dashboard_read_total, "count") || 0,
sync_download_read: metricValue(metrics.fhir_operation_sync_download_read_total, "count") || 0,
patient_everything_read: metricValue(metrics.fhir_operation_patient_everything_read_total, "count") || 0,
household_scoped_read: metricValue(metrics.fhir_operation_household_scoped_read_total, "count") || 0,
sync_upload_write: metricValue(metrics.fhir_operation_sync_upload_write_total, "count") || 0
  };
}

function metricValue(metric, key) {
  if (!metric || !metric.values) {
    return null;
  }
  const value = metric.values[key];
  return value === undefined ? null : value;
}
