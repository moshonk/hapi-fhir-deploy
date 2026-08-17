# Adding a new provider

`scripts/lab` already accepts `--cloud aws|azure|gcp`. This backend only
implements the `gcp` adapter (`gcp.ts`) for now, but every generic piece —
routes, the action runner, the SQLite layer, the command builder, the React
frontend — consumes only the [`ProviderAdapter`](./types.ts) interface.
Adding AWS or Azure support means writing one new module and registering
it — **no other file in this codebase should need to change.**

## Steps

1. Create `aws.ts` (or `azure.ts`) implementing `ProviderAdapter`:
   - `configFields`: that provider's `ConfigField[]`, each marked
     `scope: 'common' | 'provider'`. Reuse the same `key`s as `gcp.ts` for
     any field that means the same thing across providers (`lab_name`,
     `ttl_hours`, `k6_profile`, the eCHIS fields) — the frontend's
     `ConfigForm` renders `scope: 'common'` fields identically regardless
     of provider, so consistent keys let that work for free.
   - `actions`: that provider's `ActionDef[]`. Mark provider-only actions
     (GCP's `expose-fhir`/`expose-prometheus` have no AWS/Azure
     equivalent today) with `scope: 'provider'` so they don't render for
     providers that don't support them.
   - `prerequisiteChecks`: this provider's entries from
     `scripts/lab doctor`'s output for its `--cloud` value (e.g. `aws`
     already checks for the `aws` CLI — see `scripts/lab`'s
     `collect_prerequisite_checks()`).
   - `buildCommand(actionName, fieldValues)`: the exact `scripts/lab`
     argv/env for each action, mirroring
     `specs/009-lab-control-ui/contracts/cli-action-map.md`'s GCP table
     but for this provider's own flags. Write this doc's AWS/Azure table
     first, then implement against it — same discipline `gcp.ts` follows.
2. Register it in `registry.ts`:
   ```ts
   import { awsProvider } from './aws.js';
   export const providers: Record<string, ProviderAdapter> = {
     gcp: gcpProvider,
     aws: awsProvider,
   };
   ```
3. Add a `commandBuilder.test.ts`-style unit test asserting every action's
   argv against your new contracts table row-by-row (see
   `test/unit/commandBuilder.test.ts` for the GCP pattern).
4. Run `test/unit/no-provider-leakage.test.ts`'s pattern for your new
   provider too (or generalize that test to loop over every registered
   provider id) — it exists specifically to catch a provider-specific
   literal leaking into generic code.

## What you should NOT need to touch

- `src/routes/*.ts` — all routes are provider-agnostic; they look up the
  provider by id and call its `buildCommand`/read its `configFields`.
- `src/actions/runner.ts` / `commandBuilder.ts` — spawn/log/lock logic is
  identical for every provider.
- `src/db/*.ts` — `lab_configurations.provider` is just a string column.
- Any frontend component — `ConfigForm`, `ActionList`, `CommandPreview`,
  etc. all render whatever `GET /api/providers` returns, generically.

If implementing a new provider turns out to require touching one of the
above, that's a sign the generic code accidentally encoded a GCP
assumption — fix that instead of working around it in the new adapter.
