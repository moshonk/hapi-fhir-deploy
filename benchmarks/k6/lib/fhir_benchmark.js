import http from "k6/http";
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

const OPERATION_COUNTERS = {
  capability_statement: capabilityStatementTotal,
  patient_search: patientSearchTotal,
  patient_read: patientReadTotal,
  observation_search: observationSearchTotal,
  encounter_search: encounterSearchTotal,
  condition_search: conditionSearchTotal,
  bulk_export: bulkExportTotal
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

export function benchmarkSetup(profile) {
  const baseUrl = requiredEnv("FHIR_BASE_URL");
  const config = profileConfig(profile);
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  const patientIds = discoverPatientIds(normalizedBaseUrl);
  const prometheusBefore = config.requirePrometheusGates
    ? prometheusSnapshot("before")
    : { available: false };

  return {
    profile,
    baseUrl: normalizedBaseUrl,
    patientIds,
    bulkExportEnabled: envBool("BULK_EXPORT_ENABLED", false),
    observationDateStart: __ENV.OBSERVATION_DATE_START || "1900-01-01",
    sleepSeconds: config.sleepSeconds,
    prometheusBefore
  };
}

export function runFhirWorkload(data) {
  if (__ITER === 0) {
    healthCheck(data);
  }

  const operation = chooseOperation(data.bulkExportEnabled);

  if (operation === "mixed_search") {
    group("mixed read/search traffic", () => {
      patientSearch(data);
      patientRead(data);
      observationSearch(data);
    });
  } else {
    operationHandlers[operation](data);
  }

  sleep(data.sleepSeconds);
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
  const summary = {
    profile: profile || __ENV.PROFILE || "unknown",
    latency_ms: trendSummary(data.metrics.http_req_duration),
    throughput_reqs_per_sec: metricValue(data.metrics.http_reqs, "rate"),
    http_failure_rate: metricValue(data.metrics.http_req_failed, "rate"),
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

function chooseOperation(bulkExportEnabled) {
  const weights = bulkExportEnabled
    ? OPERATION_WEIGHTS.concat([["bulk_export", 1]])
    : OPERATION_WEIGHTS;
  const total = weights.reduce((sum, entry) => sum + entry[1], 0);
  let draw = Math.random() * total;

  for (const entry of weights) {
    draw -= entry[1];
    if (draw <= 0) {
      return entry[0];
    }
  }
  return weights[weights.length - 1][0];
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

function patientSearch(data) {
  requestOperation(data, "patient_search", "/Patient?_count=20", (response) => (
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
    ? `patient=${encodeURIComponent(id)}&date=ge${encodeURIComponent(data.observationDateStart)}&_count=20`
    : `_count=20`;
  requestOperation(data, "observation_search", `/Observation?${query}`, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function encounterSearch(data) {
  const id = randomPatientId(data);
  const query = id ? `patient=${encodeURIComponent(id)}&_count=20` : `_count=20`;
  requestOperation(data, "encounter_search", `/Encounter?${query}`, (response) => (
    response.status === 200 && jsonResourceType(response) === "Bundle"
  ));
}

function conditionSearch(data) {
  const id = randomPatientId(data);
  const query = id ? `patient=${encodeURIComponent(id)}&_count=20` : `_count=20`;
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

function requestOperation(data, operation, path, successful, headers) {
  const response = http.get(`${data.baseUrl}${path}`, {
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    tags: { fhir_operation: operation }
  });

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
    bulk_export: metricValue(metrics.fhir_operation_bulk_export_total, "count") || 0
  };
}

function metricValue(metric, key) {
  if (!metric || !metric.values) {
    return null;
  }
  const value = metric.values[key];
  return value === undefined ? null : value;
}
