// T5 (peak) tier -- 100,000 concurrent CHW users, 30M individuals, 10M households,
// 180M total records. BLOCKED: do not run against the native connection tier --
// this far exceeds the native ceiling documented in docs/autoscaling.md
// (maxReplicas <= floor((max_connections - reserved) / hikari_maximum_pool_size),
// 5 replicas max on the unmodified base values.yaml). Requires
// specs/007-pgbouncer-connection-pooling's pooled connection tier
// (enable_pgbouncer: true) to be deployed and its provisional pooled-formula
// ceiling validated at the T4 tier first, plus distributed k6 execution (see
// US4, manifests/k6-shard-job/) since one k6 process cannot host 100,000 VUs.
// See docs/echis-benchmark-tiers.md.
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
        { duration: "20m", target: 25000 },
        { duration: "20m", target: 50000 },
        { duration: "20m", target: 100000 },
        { duration: "60m", target: 100000 },
        { duration: "15m", target: 0 }
      ],
      gracefulRampDown: "3m"
    },
    household_sync: {
      executor: "ramping-arrival-rate",
      startRate: 5000,
      timeUnit: "1s",
      preAllocatedVUs: 20000,
      maxVUs: 50000,
      stages: [
        { duration: "20m", target: 5000 },
        { duration: "20m", target: 10000 },
        { duration: "20m", target: 20000 },
        { duration: "60m", target: 20000 },
        { duration: "15m", target: 0 }
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
  userAgent: "hapi-fhir-deploy-k6/echis-load-100000"
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
  // individual count matches data-model.md's peak budget exactly (10,000,000
  // households * 3 = 30,000,000). total_record_load_target (175,200,000) is what
  // scripts/echis_seed.rb --households 10000000 actually produces, not
  // data-model.md's illustrative 180,000,000 budget figure -- see
  // docs/echis-benchmark-tiers.md for the derivation.
  parsed.concurrency_target = 100000;
  parsed.individual_load_target = 30000000;
  parsed.household_load_target = 10000000;
  parsed.total_record_load_target = 175200000;

  const output = {
    stdout: `${JSON.stringify(parsed, null, 2)}\n`
  };
  if (__ENV.K6_FHIR_SUMMARY_PATH) {
    output[__ENV.K6_FHIR_SUMMARY_PATH] = output.stdout;
  }
  return output;
}
