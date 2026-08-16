import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getActionRun } from '../db/queries.js';
import { getRunEmitter, readLogSoFar } from '../actions/runner.js';

export function createRunsRouter(db: DatabaseSync): Router {
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
