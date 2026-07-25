# `manifests/seed-job/`

Placeholder for the Kubernetes Indexed Job that runs distributed eCHIS dataset
generation, per `specs/008-echis-workload-benchmark/contracts/shard-job.md`.
Not yet implemented — the actual `echis-seed-job.yaml` manifest is
`specs/008-echis-workload-benchmark/tasks.md` task T026 (User Story 4), which
targets `scripts/minimal_fhir_seed.rb` first for de-risking before being
retargeted at `scripts/echis_seed.rb` (T031).

**Pinned image** (task T001, no `latest` per Constitution Principle III):

```text
docker.io/library/ruby:3.3.12-alpine3.24@sha256:c162e46df6458be2bc169956f207225abd4b017adc0f0a6f7ad50640b93fcf82
```

Matches this repo's CI-pinned Ruby minor version (`ruby-version: "3.3"` in
`.github/workflows/ci.yml`). Alpine variant chosen because the seed generator
scripts (`scripts/minimal_fhir_seed.rb`, and the future `scripts/echis_seed.rb`)
are stdlib-only Ruby with no native gem dependencies, so no build toolchain is
needed in the image.
