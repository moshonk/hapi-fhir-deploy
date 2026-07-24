# Contract: Indexed Job Sharding (seed and k6)

Applies to both `manifests/seed-job/echis-seed-job.yaml` and `manifests/k6-shard-job/echis-k6-shard-job.yaml`. One contract, two instantiations, so the mechanism is identical whether it's driving `scripts/echis_seed.rb` or a k6 tier script.

## Job shape

```yaml
apiVersion: batch/v1
kind: Job
spec:
  completionMode: Indexed
  parallelism: <N>
  completions: <N>
  template:
    spec:
      containers:
        - env:
            - name: SHARD_INDEX
              valueFrom: { fieldRef: { fieldPath: "metadata.annotations['batch.kubernetes.io/job-completion-index']" } }
            - name: SHARD_COUNT
              value: "<N>"
      restartPolicy: Never
  backoffLimit: <per-shard retry count>
```

## Invariants

1. `SHARD_INDEX` MUST come from the Kubernetes-provided completion index (`JOB_COMPLETION_INDEX` / the `batch.kubernetes.io/job-completion-index` annotation), never a manually assigned value — this is what guarantees every index in `[0, N)` is covered exactly once across a successful Job run.
2. Each shard's output (dataset-metadata JSON for seed shards, k6 summary JSON for load-generation shards) MUST be written to a location addressable by its `SHARD_INDEX` (e.g., a shared volume or object storage path keyed by index), so the merge step (`scripts/merge_seed_shards.rb` / `scripts/merge_k6_shards.rb`) can detect a missing shard by its absent index rather than only by an aggregate count mismatch.
3. A failed shard (non-zero exit) MUST be visible in the combined result, per spec FR-009/Acceptance Scenario US4.3 — the merge scripts MUST fail loudly (non-zero exit, explicit error listing missing/failed shard indices) rather than silently producing a partial aggregate.
4. This mechanism MUST be validated against the *existing* generic generator (`scripts/minimal_fhir_seed.rb`) and existing k6 workload before being pointed at the new eCHIS generator/workload, per the approved feature plan's de-risking order — i.e., the first implementation task for this contract targets the existing tooling, and only a later task swaps in `scripts/echis_seed.rb`/`echis_load_*.js`.
5. Container images referenced by these Job manifests MUST be pinned to reviewed digests (Constitution Principle III) — no `latest`.

## Non-goals

- This contract does not define autoscaling or resource-request sizing for shard pods — that is left to the implementation task per-cloud, informed by the calibration spike (`research.md` Decision 5), not fixed here.
