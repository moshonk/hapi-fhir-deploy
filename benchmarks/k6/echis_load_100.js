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
  // Connection reuse (k6's default) plus Kubernetes' per-connection
  // (not per-request) Service load balancing pins each VU's traffic to
  // whichever pod its keep-alive connection first landed on, largely
  // deciding "which replica does the work" during the early ramp rather
  // than letting KEDA-added replicas actually share load -- see
  // echis_load_1000.js's options comment for the full diagnosis (found
  // live against T3, applies equally here).
  noConnectionReuse: true,
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
    },
    household_sync: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 50,
      stages: [
        { duration: "5m", target: 5 },
        { duration: "5m", target: 10 },
        { duration: "10m", target: 20 },
        { duration: "20m", target: 20 },
        { duration: "2m", target: 0 }
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
  userAgent: "hapi-fhir-deploy-k6/echis-load-100"
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
  // individual/total-record counts are what scripts/echis_seed.rb --households 33333
  // --individuals-per-household 3 actually produces (verified locally), not the round
  // 100,000/600,000 figures a flat "individuals-per-household * 6 records" estimate
  // would suggest -- see docs/echis-benchmark-tiers.md for the derivation.
  parsed.concurrency_target = 100;
  parsed.individual_load_target = 99999;
  parsed.household_load_target = 33333;
  parsed.total_record_load_target = 583996;

  const output = {
    stdout: `${JSON.stringify(parsed, null, 2)}\n`
  };
  if (__ENV.K6_FHIR_SUMMARY_PATH) {
    output[__ENV.K6_FHIR_SUMMARY_PATH] = output.stdout;
  }
  return output;
}
