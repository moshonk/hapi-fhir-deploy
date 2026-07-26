// T4 tier (10,000 concurrent CHW users). BLOCKED: do not run against the native
// connection tier -- 10,000 VUs far exceeds the native ceiling documented in
// docs/autoscaling.md (maxReplicas <= floor((max_connections - reserved) /
// hikari_maximum_pool_size), 5 replicas max on the unmodified base values.yaml).
// Requires specs/007-pgbouncer-connection-pooling's pooled connection tier
// (enable_pgbouncer: true) to be deployed and its provisional pooled-formula
// ceiling validated against this tier's load first. See docs/echis-benchmark-tiers.md.
import {
  benchmarkSetup,
  benchmarkSummary,
  benchmarkTeardown,
  runFhirWorkloadExcluding,
  runHouseholdSyncWrite
} from "./lib/fhir_benchmark.js";

const PROFILE = "stress";
const WORKLOAD = "echis";

export const options = {
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max"],
  scenarios: {
    fhir_workload: {
      executor: "ramping-vus",
      stages: [
        { duration: "15m", target: 2500 },
        { duration: "15m", target: 5000 },
        { duration: "15m", target: 10000 },
        { duration: "45m", target: 10000 },
        { duration: "10m", target: 0 }
      ],
      gracefulRampDown: "2m"
    },
    household_sync: {
      executor: "ramping-arrival-rate",
      startRate: 500,
      timeUnit: "1s",
      preAllocatedVUs: 2000,
      maxVUs: 5000,
      stages: [
        { duration: "15m", target: 500 },
        { duration: "15m", target: 1000 },
        { duration: "15m", target: 2000 },
        { duration: "45m", target: 2000 },
        { duration: "10m", target: 0 }
      ],
      exec: "householdSync"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<5000", "p(99)<10000"],
    checks: ["rate>0.95"],
    fhir_health_success: ["rate==1"]
  },
  userAgent: "hapi-fhir-deploy-k6/echis-load-10000"
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
  // individual/total-record counts are what scripts/echis_seed.rb --households 3333333
  // --individuals-per-household 3 would produce, derived (not run at this scale) via
  // the formula confirmed against T2/T3's actual output -- see
  // docs/echis-benchmark-tiers.md for the derivation.
  parsed.concurrency_target = 10000;
  parsed.individual_load_target = 9999999;
  parsed.household_load_target = 3333333;
  parsed.total_record_load_target = 58399996;

  const output = {
    stdout: `${JSON.stringify(parsed, null, 2)}\n`
  };
  if (__ENV.K6_FHIR_SUMMARY_PATH) {
    output[__ENV.K6_FHIR_SUMMARY_PATH] = output.stdout;
  }
  return output;
}
