import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getProvider } from '../providers/registry.js';
import {
  defaultFieldValues,
  isLaunchable,
  buildCommand,
  formatCommandPreview,
} from '../actions/commandBuilder.js';
import {
  createLabConfiguration,
  getLabConfiguration,
  latestSucceededActionRun,
  listActionRunsForLab,
  listLabConfigurations,
  updateLabConfiguration,
  type LabConfigurationRow,
} from '../db/queries.js';

function toResponseShape(row: LabConfigurationRow) {
  const provider = getProvider(row.provider);
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    fields: row.fields,
    launchable: provider ? isLaunchable(provider, row.fields) : false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createLabsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ labs: listLabConfigurations(db).map(toResponseShape) });
  });

  router.post('/', (req, res) => {
    const body = req.body as { provider?: unknown; name?: unknown; fields?: unknown };
    const providerId = typeof body.provider === 'string' ? body.provider : '';
    const provider = getProvider(providerId);
    if (!provider) {
      res.status(400).json({ error: `unknown provider: ${providerId}` });
      return;
    }

    const suppliedFields = (
      typeof body.fields === 'object' && body.fields !== null ? body.fields : {}
    ) as Record<string, unknown>;
    // FR-001: every field the caller omits is filled from the provider's
    // declared default; only fields with no default (required) stay unset.
    const fields = { ...defaultFieldValues(provider), ...suppliedFields };
    const name =
      typeof body.name === 'string' && body.name.trim() !== ''
        ? body.name
        : String(fields.lab_name ?? 'lab');

    const row = createLabConfiguration(db, { provider: providerId, name, fields });
    res.status(201).json(toResponseShape(row));
  });

  router.get('/:id', (req, res) => {
    const row = getLabConfiguration(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(toResponseShape(row));
  });

  router.patch('/:id', (req, res) => {
    const body = req.body as { name?: unknown; fields?: unknown };
    const patch: { name?: string; fields?: Record<string, unknown> } = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.fields === 'object' && body.fields !== null)
      patch.fields = body.fields as Record<string, unknown>;

    const row = updateLabConfiguration(db, req.params.id, patch);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(toResponseShape(row));
  });

  router.get('/:id/runs', (req, res) => {
    const row = getLabConfiguration(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const runs = listActionRunsForLab(db, req.params.id).map((r) => ({
      id: r.id,
      action_name: r.action_name,
      status: r.status,
      started_at: r.started_at,
      ended_at: r.ended_at,
      exit_code: r.exit_code,
    }));
    res.json({ runs });
  });

  router.get('/:id/preview', (req, res) => {
    const row = getLabConfiguration(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const provider = getProvider(row.provider);
    if (!provider) {
      res.status(400).json({ error: `unknown provider: ${row.provider}` });
      return;
    }
    const actionName = typeof req.query.action === 'string' ? req.query.action : '';
    if (!provider.actions.some((a) => a.name === actionName)) {
      res.status(400).json({ error: `unknown action: ${actionName}` });
      return;
    }

    // `report` targets a PRIOR benchmark run's artifacts -- preview the
    // same cliRunLabel the trigger endpoint would actually resolve to
    // (labs.ts and actions.ts intentionally share this fallback rule:
    // "report" -> latest succeeded "benchmark" run), so the preview can't
    // show a different --run than what triggering it actually uses.
    const cliRunLabel =
      actionName === 'report'
        ? latestSucceededActionRun(db, row.id, 'benchmark')?.cli_run_label
        : undefined;

    try {
      const cmd = buildCommand(provider, actionName, row.fields, { cliRunLabel });
      res.json({ command: formatCommandPreview(cmd) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
