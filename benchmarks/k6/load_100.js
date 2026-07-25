import {
  benchmarkSetup,
  benchmarkSummary,
  benchmarkTeardown,
  runFhirWorkload
} from "./lib/fhir_benchmark.js";

const PROFILE = "load";

export const options = {
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max"],
  scenarios: {
    fhir_workload: {
      executor: "ramping-vus",
      stages: [
        { duration: "5m", target: 25 },
        { duration: "5m", target: 50 },
        { duration: "10m", target: 100 },
        { duration: "20m", target: 100 },
        { duration: "2m", target: 0 }
      ],
      gracefulRampDown: "30s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<3000", "p(99)<7000"],
    checks: ["rate>0.95"],
    fhir_health_success: ["rate==1"]
  },
  userAgent: "hapi-fhir-deploy-k6/load-100"
};

export function setup() {
  return benchmarkSetup(PROFILE);
}

export default function (data) {
  runFhirWorkload(data);
}

export function teardown(data) {
  benchmarkTeardown(data);
}

export function handleSummary(data) {
  const summary = benchmarkSummary(data, PROFILE);
  const parsed = JSON.parse(summary.stdout);
  parsed.concurrency_target = 100;
  parsed.patient_load_target = 100000;

  const output = {
    stdout: `${JSON.stringify(parsed, null, 2)}\n`
  };
  if (__ENV.K6_FHIR_SUMMARY_PATH) {
    output[__ENV.K6_FHIR_SUMMARY_PATH] = output.stdout;
  }
  return output;
}
