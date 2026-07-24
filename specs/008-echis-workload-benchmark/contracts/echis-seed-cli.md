# Contract: `scripts/echis_seed.rb` CLI

Mirrors `scripts/minimal_fhir_seed.rb`'s CLI contract (`Usage: scripts/minimal_fhir_seed.rb --patients N --seed S --run-id RUN_ID --metadata FILE --fhir-base-url URL`), extended for households and sharding.

## Flags

| Flag | Type | Default | Notes |
| --- | --- | --- | --- |
| `--households N` | Integer, required | — | Target household count for this invocation (or this shard's slice — see `--shard-count`). |
| `--individuals-per-household N` | Integer | `3` | Average individuals per household (spec Assumptions default). |
| `--seed S` | Integer, required | — | Deterministic seed, same role as in `minimal_fhir_seed.rb`. |
| `--run-id RUN_ID` | String, required | — | Same role as in `minimal_fhir_seed.rb`. |
| `--metadata FILE` | Path, required | — | Dataset metadata JSON output path. |
| `--fhir-base-url URL` | URL, required unless `--metadata-only` | — | Same role as in `minimal_fhir_seed.rb`. |
| `--batch-size N` | Integer | `100` | Households per transaction bundle (bundle size in resources scales with `individuals-per-household` and the per-individual record mix). |
| `--timeout SECONDS` | Integer | `120` | Same role as in `minimal_fhir_seed.rb`. |
| `--shard-index N` | Integer | `0` | This invocation's shard number (0-based). |
| `--shard-count N` | Integer | `1` | Total number of shards; `--shard-index` MUST be `< --shard-count`. |
| `--metadata-only` | Flag | off | Same role as in `minimal_fhir_seed.rb` (dry-run, no HTTP calls). |

## Sharding contract

- Shard `i` of `N` owns household index range `[floor(households * i / N), floor(households * (i+1) / N))` — a contiguous range, per `research.md` Decision 3.
- Generated resource IDs MUST be derived only from the global household/individual index, never from `shard_index` — so re-running a single failed shard reproduces byte-identical output, and shards never collide on IDs regardless of run order.
- A shard's `dataset-metadata.json` output MUST record its owned index range (`shard_index`, `shard_count`, `start_index`, `end_index`) so `scripts/merge_seed_shards.rb` can detect gaps (a missing shard file, or a shard whose recorded range doesn't abut its neighbors) rather than silently producing an incomplete aggregate.

## Output metadata schema (extends `minimal_fhir_seed.rb`'s existing shape)

```json
{
  "run_id": "...",
  "echis": {
    "households": 10000000,
    "individuals_per_household": 3,
    "seed": 12345,
    "generator": "echis_seed",
    "shard_index": 0,
    "shard_count": 1000,
    "start_index": 0,
    "end_index": 10000,
    "transaction_bundle_count": 100,
    "resource_counts": {
      "Group": 10000, "Patient": 30000, "PractitionerRole": 100, "CareTeam": 100,
      "Encounter": 40000, "Observation": 40000, "Condition": 15000,
      "Task": 20000, "QuestionnaireResponse": 25000
    }
  },
  "import": { "...": "same shape as minimal_fhir_seed.rb's import block" }
}
```

## Exit codes

Same convention as `minimal_fhir_seed.rb`: exit `0` and print a summary on success; exit `1` and print errors to stderr (plus write them into the metadata file's `import.errors`) on any partial-transaction or HTTP failure.
