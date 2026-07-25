# `manifests/k6-shard-job/`

Placeholder for the Kubernetes Indexed Job that runs distributed k6 load
generation, per `specs/008-echis-workload-benchmark/contracts/shard-job.md`.
Not yet implemented — the actual `echis-k6-shard-job.yaml` manifest is
`specs/008-echis-workload-benchmark/tasks.md` task T027 (User Story 4), which
targets an existing generic k6 script first for de-risking before being
retargeted at the `echis_load_*.js` scripts (T031).

**Pinned image** (task T001, no `latest` per Constitution Principle III):

```text
docker.io/grafana/k6:2.1.0@sha256:68e78d94140704ec4ee0cb7c5cf6cd12a32b7d310a6f98d94931ee9b0b9dc629
```

The non-browser variant — this lab only exercises HTTP/FHIR REST traffic, per
the existing `benchmarks/k6/` scripts, so the smaller image without headless
browser support is sufficient.
