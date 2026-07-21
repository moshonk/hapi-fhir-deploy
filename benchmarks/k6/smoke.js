import {
  benchmarkSetup,
  benchmarkSummary,
  benchmarkTeardown,
  profileOptions,
  runBaselineGates,
  runFhirWorkload
} from "./lib/fhir_benchmark.js";

const PROFILE = "smoke";

export const options = profileOptions(PROFILE);

export function setup() {
  return benchmarkSetup(PROFILE);
}

export default function (data) {
  runFhirWorkload(data);
}

export function teardown(data) {
  benchmarkTeardown(data);
}

export function baselineGates(data) {
  runBaselineGates(data);
}

export function handleSummary(data) {
  return benchmarkSummary(data, PROFILE);
}
