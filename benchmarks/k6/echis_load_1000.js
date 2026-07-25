import {
  benchmarkSetup,
  benchmarkSummary,
  benchmarkTeardown,
  runFhirWorkloadExcluding,
  runHouseholdSyncWrite
} from "./lib/fhir_benchmark.js";

const PROFILE = "load";
const WORKLOAD = "echis";

export const options = {
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max"],
  scenarios: {
    fhir_workload: {
      executor: "ramping-vus",
      stages: [
        { duration: "15m", target: 250 },
        { duration: "15m", target: 500 },
        { duration: "15m", target: 1000 },
        { duration: "30m", target: 1000 },
        { duration: "5m", target: 0 }
      ],
      gracefulRampDown: "1m"
    },
    household_sync: {
      executor: "ramping-arrival-rate",
      startRate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 500,
      stages: [
        { duration: "15m", target: 50 },
        { duration: "15m", target: 100 },
        { duration: "15m", target: 200 },
        { duration: "30m", target: 200 },
        { duration: "5m", target: 0 }
      ],
      exec: "householdSync"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<3000", "p(99)<7000"],
    checks: ["rate>0.95"],
    fhir_health_success: ["rate==1"]
  },
  userAgent: "hapi-fhir-deploy-k6/echis-load-1000"
};

export function setup() {
  return benchmarkSetup(PROFILE, WORKLOAD);
}

export default function (data) {
  runFhirWorkloadExcluding(data, "household_sync_write");
}

export function householdSync(data) {
  runHouseholdSyncWrite(data);
}

export function teardown(data) {
  benchmarkTeardown(data);
}

export function handleSummary(data) {
  const summary = benchmarkSummary(data, PROFILE);
  const parsed = JSON.parse(summary.stdout);
  parsed.concurrency_target = 1000;
  parsed.individual_load_target = 1000000;
  parsed.household_load_target = 333333;
  parsed.total_record_load_target = 6000000;

  const output = {
    stdout: `${JSON.stringify(parsed, null, 2)}\n`
  };
  if (__ENV.K6_FHIR_SUMMARY_PATH) {
    output[__ENV.K6_FHIR_SUMMARY_PATH] = output.stdout;
  }
  return output;
}
