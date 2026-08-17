# Quickstart: eCHIS Additional Seed Datasets

Validates this feature end-to-end: facility hierarchy generation, catchment
tagging, reference data, and the new verification script. Assumes
`008-echis-workload-benchmark`'s generator already works (its own
`specs/008-echis-workload-benchmark/quickstart.md` covers that baseline).

## Prerequisites

- Ruby 3.3 (matches CI).
- For steps 3+: a reachable HAPI FHIR server (local `docker compose`/`scripts/lab`
  deployment, or any FHIR base URL that accepts transaction Bundle POSTs).

## 1. Dry-run: confirm new resource types and counts (`--metadata-only`)

```sh
scripts/echis_seed.rb --households 100 --individuals-per-household 3 \
  --seed 12345 --run-id local-smoke-010 --metadata-only \
  --metadata /tmp/echis-010-metadata.json
```

**Expected**: exits 0; `/tmp/echis-010-metadata.json`'s `echis.resource_counts`
includes `Location`, `Organization`, and `Practitioner` keys (no `Specimen` key,
since `--include-specimen` was not passed), with counts matching
`data-model.md`'s cardinality formula for `H = 100` (`C = ceil(100/100) = 1`, so
`Location = 3`, `Organization = 1`, `Practitioner = 1`). Every other existing key
(`Group`, `Patient`, `Encounter`, ...) is unchanged from pre-feature output for the
same `--households 100` invocation (SC-006).

## 2. Dry-run with the optional Specimen dataset enabled

```sh
scripts/echis_seed.rb --households 100 --individuals-per-household 3 \
  --seed 12345 --run-id local-smoke-010-specimen --metadata-only \
  --include-specimen --metadata /tmp/echis-010-specimen-metadata.json
```

**Expected**: exits 0; `resource_counts.Specimen` present and matches the
documented rotating-subset ratio within 1% (SC-006).

## 3. Live load: confirm data is queryable and correctly scoped

```sh
scripts/echis_seed.rb --households 100 --individuals-per-household 3 \
  --seed 12345 --run-id local-load-010 \
  --fhir-base-url "$FHIR_BASE_URL" \
  --metadata /tmp/echis-010-live-metadata.json
```

**Expected**: exits 0; `import.error_count` is `0`.

## 4. Run the new verification script

```sh
scripts/verify_echis_catchment_data.rb --fhir-base-url "$FHIR_BASE_URL" \
  --facility-id echis-loc-fac000000
```

**Expected**: exits 0; prints a per-check summary (Location hierarchy resolves,
facility-scoped `Group`/`Task`/`Patient`/`QuestionnaireResponse` queries return
only that facility's resources, `Organization` resolves, one CHW's `Practitioner`
resolves). This is the FR-011 reachability proof — run once per live seed load,
not as a repeated load-test operation.

## 5. Reproducibility check (sharding determinism)

```sh
scripts/echis_seed.rb --households 1000 --shard-index 0 --shard-count 4 \
  --seed 12345 --run-id shard-check-010-a --metadata-only \
  --metadata /tmp/shard0-a.json
scripts/echis_seed.rb --households 1000 --shard-index 0 --shard-count 4 \
  --seed 12345 --run-id shard-check-010-b --metadata-only \
  --metadata /tmp/shard0-b.json
diff <(ruby -rjson -e 'puts JSON.parse(File.read("/tmp/shard0-a.json"))["echis"]["resource_counts"]') \
     <(ruby -rjson -e 'puts JSON.parse(File.read("/tmp/shard0-b.json"))["echis"]["resource_counts"]')
```

**Expected**: no diff — confirms Location/Organization/Practitioner generation is
byte-reproducible across repeated shard runs (SC-005), same guarantee the existing
CHW-catchment logic already provides.

## 6. Automated test

```sh
ruby test/echis_seed_test.rb
```

**Expected**: passes. Covers the `--metadata-only` resource-count assertions above
in CI (`.github/workflows/ci.yml`), plus regression coverage for the pre-existing
008 resource-count logic that had no automated test before this feature
(`research.md` Decision 4's context note).
