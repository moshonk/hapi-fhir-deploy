import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { join, resolve as resolvePath, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getActionRun } from '../db/queries.js';
import { getRunEmitter, readLogSoFar } from '../actions/runner.js';

export interface RunsRouterDeps {
  db: DatabaseSync;
  /** scripts/lab's RUN_ROOT -- where seed/benchmark/report --run
   * {cliRunLabel} write result artifacts (data-model.md/cli-action-map.md).
   * Distinct from this UI's own per-actionRun *log* directory. */
  cliRunsDir: string;
  /** scripts/lab report's default publisher's RESULT_ROOT (report.md,
   * environment.json, summary.csv). */
  resultsDir: string;
}

/** Known result-artifact basenames worth surfacing in the UI, checked
 * inside a run's cliRunsDir directory -- an explicit allowlist, not a
 * directory listing, so this can never serve an arbitrary file (and never
 * k6-raw.jsonl, which is a multi-gigabyte NDJSON dump, wildly unsuitable
 * for a single JSON HTTP response). Order is display order. */
const RUN_DIR_JSON_FILES = [
  'k6-fhir-summary.json',
  'benchmark-metadata.json',
  'k6-summary.json',
  'dataset-metadata.json',
] as const;

interface ArtifactFile {
  name: string;
  kind: 'json' | 'text';
  content: unknown;
}

async function readJsonIfPresent(path: string, name: string): Promise<ArtifactFile | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return { name, kind: 'json', content: JSON.parse(raw) };
  } catch {
    return null;
  }
}

async function readTextIfPresent(path: string, name: string): Promise<ArtifactFile | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return { name, kind: 'text', content: raw };
  } catch {
    return null;
  }
}

/** `report`'s default publisher (scripts/publish_results.rb) prints
 * exactly one line on success -- the absolute results/<dir> path it just
 * wrote (`puts result_dir`) -- and nothing else to stdout. Recovering that
 * path from the already-captured run log avoids needing any new
 * DB column just to link a `report` action_run to its output directory.
 * Returns null if the log doesn't end in a path actually inside
 * resultsDir (e.g. a custom LAB_REPORT_CMD was used, or the run failed
 * before publishing) -- resolvePath + a trailing-separator-aware prefix
 * check so resultsDir itself can never be "escaped" via a crafted line. */
function resolveReportResultDir(logContent: string, resultsDir: string): string | null {
  const lines = logContent.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) return null;

  const candidate = resolvePath(lastLine);
  const root = resolvePath(resultsDir);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

export function createRunsRouter(deps: RunsRouterDeps): Router {
  const { db, cliRunsDir, resultsDir } = deps;
  const router = Router();

  router.get('/:runId', (req, res) => {
    const run = getActionRun(db, req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(run);
  });

  router.get('/:runId/log', async (req, res) => {
    const run = getActionRun(db, req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const log = await readLogSoFar(run.log_file_path);
    res.type('text/plain').send(log);
  });

  // Result artifacts (not the process log -- see /log and /stream above):
  // seed's dataset-metadata.json, benchmark's k6-fhir-summary.json/
  // k6-summary.json/benchmark-metadata.json, and report's published
  // report.md/environment.json/summary.csv. Empty `files` (never a 404)
  // for actions other than seed/benchmark/report -- commandBuilder
  // generates a cliRunLabel for every action regardless of whether it's
  // actually used (ResolvedCommand's own doc comment), so cli_run_label
  // being non-empty does NOT by itself mean a run directory exists (e.g.
  // "up" has one but never writes into ansible/artifacts/lab/runs/) -- or
  // for a run that hasn't produced any of the known files yet (still
  // running, or failed before writing anything): "no results yet" is a
  // normal state, not an error.
  const RUN_DIR_ACTIONS = new Set(['seed', 'benchmark', 'report']);

  router.get('/:runId/artifacts', async (req, res) => {
    const run = getActionRun(db, req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!run.cli_run_label || !RUN_DIR_ACTIONS.has(run.action_name)) {
      res.json({ cliRunLabel: run.cli_run_label, files: [] });
      return;
    }

    const runDir = join(cliRunsDir, run.cli_run_label);
    const jsonReads = RUN_DIR_JSON_FILES.map((name) =>
      readJsonIfPresent(join(runDir, name), name),
    );
    const files = (await Promise.all(jsonReads)).filter((f): f is ArtifactFile => f !== null);

    if (run.action_name === 'report') {
      const log = await readLogSoFar(run.log_file_path);
      const resultDir = resolveReportResultDir(log, resultsDir);
      if (resultDir) {
        const published = await Promise.all([
          readTextIfPresent(join(resultDir, 'report.md'), 'report.md'),
          readJsonIfPresent(join(resultDir, 'environment.json'), 'environment.json'),
          readTextIfPresent(join(resultDir, 'summary.csv'), 'summary.csv'),
        ]);
        files.push(...published.filter((f): f is ArtifactFile => f !== null));
      }
    }

    res.json({ cliRunLabel: run.cli_run_label, files });
  });

  // SSE (T027, research.md §2): replays the full log on connect, then tails
  // appended content. FR-008 -- reconnecting after a drop is just reopening
  // this same endpoint, no client-tracked offset needed.
  router.get('/:runId/stream', async (req, res) => {
    const run = getActionRun(db, req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendLog = (chunk: string) => {
      for (const line of chunk.split('\n')) {
        res.write(`event: log\ndata: ${line}\n\n`);
      }
    };

    const initial = await readLogSoFar(run.log_file_path);
    if (initial) sendLog(initial);

    if (run.status === 'succeeded' || run.status === 'failed') {
      res.write(`event: status\ndata: ${run.status}\n\n`);
      res.end();
      return;
    }

    const emitter = getRunEmitter(run.id);
    if (!emitter) {
      // Run is recorded as still in-flight but the process/emitter is gone
      // (e.g. a backend restart mid-run) -- close the stream with what the
      // log file has rather than hanging forever.
      res.end();
      return;
    }

    const onLog = (chunk: string) => sendLog(chunk);
    const onStatus = (status: string) => {
      res.write(`event: status\ndata: ${status}\n\n`);
      res.end();
    };
    emitter.on('log', onLog);
    emitter.once('status', onStatus);

    req.on('close', () => {
      emitter.off('log', onLog);
      emitter.off('status', onStatus);
    });
  });

  return router;
}
