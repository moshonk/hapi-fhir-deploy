# `manifests/seed-job/`

`echis-seed-job.yaml`: a Kubernetes Indexed Job that runs distributed eCHIS
dataset generation across `parallelism` parallel shards, per
`specs/008-echis-workload-benchmark/contracts/shard-job.md`
(`specs/008-echis-workload-benchmark/tasks.md` task T026, User Story 4).
Currently targets `scripts/minimal_fhir_seed.rb` for de-risking — see the
comment header in the manifest for why shard ID overlap is expected and safe
at this stage. Task T031 retargets it at `scripts/echis_seed.rb`, whose
`--shard-index`/`--shard-count` flags give each shard a genuinely disjoint ID
range.

## Before `kubectl apply`

The manifest uses `<ANGLE_BRACKET>` placeholder tokens that must be
substituted (e.g. via `envsubst`, or the future `scripts/lab` wiring — task
T038, not yet implemented):

| Token | Meaning |
| --- | --- |
| `<SHARD_COUNT>` | Number of parallel shards (`parallelism`/`completions`). |
| `<PATIENTS_PER_SHARD>` | Patient count each shard generates. |
| `<SEED>` | Deterministic seed recorded in each shard's metadata. |
| `<RUN_ID>` | Run identifier; each shard appends its own index. |
| `<FHIR_BASE_URL>` | Target FHIR server base URL. |
| `<SEED_SCRIPTS_CONFIGMAP>` | Name of a pre-created ConfigMap containing the seed script(s) — see below. |
| `<SHARD_OUTPUT_PVC>` | Name of a pre-created `ReadWriteMany` PVC mounted at `/shard-output`, so every shard's `dataset-metadata.json` is addressable by its index and `scripts/merge_seed_shards.rb` can read them all. |

Create the scripts ConfigMap before applying (name must match
`<SEED_SCRIPTS_CONFIGMAP>`):

```sh
kubectl create configmap echis-seed-job-scripts \
  --from-file=minimal_fhir_seed.rb=scripts/minimal_fhir_seed.rb \
  --from-file=echis_seed.rb=scripts/echis_seed.rb \
  -n fhir
```

## Merging shard output

Once all shards complete, combine their `dataset-metadata.json` files with
`scripts/merge_seed_shards.rb --shard-dir /shard-output --shard-count N
--output dataset-metadata.json`. It sums resource counts, fails loudly if any
shard index is missing (rather than silently producing a partial aggregate,
per `contracts/shard-job.md` invariant 3), and works against either
generator's metadata shape (`minimal_fhir_seed.rb`'s `synthea` key or
`echis_seed.rb`'s `echis` key) without a flag, by detecting which one is
present.

## Pinned image (task T001, no `latest` per Constitution Principle III)

```text
docker.io/library/ruby:3.3.12-alpine3.24@sha256:c162e46df6458be2bc169956f207225abd4b017adc0f0a6f7ad50640b93fcf82
```

Matches this repo's CI-pinned Ruby minor version (`ruby-version: "3.3"` in
`.github/workflows/ci.yml`). Alpine variant chosen because the seed generator
scripts (`scripts/minimal_fhir_seed.rb`, `scripts/echis_seed.rb`) are
stdlib-only Ruby with no native gem dependencies, so no build toolchain is
needed in the image.
