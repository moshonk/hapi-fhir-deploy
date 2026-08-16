// Action runner core (T014). Spawns scripts/lab as a child process, tees
// its output to a per-run log file, enforces a per-(labId, actionName)
// concurrency lock (FR-016), and maps its exit code to a run status --
// entirely independent of whether any browser is watching (FR-019).

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';
import { markActionRunFinished, markActionRunStarted } from '../db/queries.js';

export interface RunnerDeps {
  db: DatabaseSync;
  labCliPath: string;
  repoRoot: string;
}

export interface SpawnActionInput {
  runId: string;
  labConfigurationId: string;
  actionName: string;
  argv: string[];
  env: Record<string, string>;
  logFilePath: string;
}

/** One emitter per in-flight run, so SSE handlers (T027) can attach after
 * the process has already started and still receive every subsequent
 * chunk; the log file itself (read on connect) covers everything emitted
 * before they attached. */
const runEmitters = new Map<string, EventEmitter>();

/** In-memory concurrency lock: (labConfigurationId, actionName) -> runId
 * currently in flight. FR-016. */
const inFlight = new Map<string, string>();

function lockKey(labConfigurationId: string, actionName: string): string {
  return `${labConfigurationId}::${actionName}`;
}

export function currentlyRunning(
  labConfigurationId: string,
  actionName: string,
): string | undefined {
  return inFlight.get(lockKey(labConfigurationId, actionName));
}

export function getRunEmitter(runId: string): EventEmitter | undefined {
  return runEmitters.get(runId);
}

export async function readLogSoFar(logFilePath: string): Promise<string> {
  try {
    return await readFile(logFilePath, 'utf8');
  } catch {
    return '';
  }
}

/** Spawns the action. Resolves once the process has started (not once it
 * finishes) -- callers get an immediate runId/streamUrl per contracts/api.md,
 * consistent with a 202-Accepted trigger response. */
export function spawnAction(deps: RunnerDeps, input: SpawnActionInput): void {
  const key = lockKey(input.labConfigurationId, input.actionName);
  if (inFlight.has(key)) {
    throw new Error(`action already running for this lab: ${inFlight.get(key)}`);
  }

  mkdirSync(dirname(input.logFilePath), { recursive: true });
  const logStream = createWriteStream(input.logFilePath, { flags: 'a' });
  const emitter = new EventEmitter();
  runEmitters.set(input.runId, emitter);
  inFlight.set(key, input.runId);

  markActionRunStarted(deps.db, input.runId);

  const child = spawn(deps.labCliPath, input.argv, {
    cwd: deps.repoRoot,
    env: { ...process.env, ...input.env },
  });

  const onChunk = (chunk: Buffer) => {
    logStream.write(chunk);
    emitter.emit('log', chunk.toString('utf8'));
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  child.on('error', (err) => {
    const message = `\n[lab-control-ui] failed to spawn scripts/lab: ${err.message}\n`;
    logStream.write(message);
    emitter.emit('log', message);
    finish(1);
  });

  child.on('close', (code) => {
    finish(code ?? 1);
  });

  function finish(exitCode: number): void {
    logStream.end();
    markActionRunFinished(deps.db, input.runId, exitCode);
    emitter.emit('status', exitCode === 0 ? 'succeeded' : 'failed');
    inFlight.delete(key);
    // Give any attached SSE clients a tick to receive the final status
    // event before the emitter is dropped; readLogSoFar covers late joiners.
    setTimeout(() => runEmitters.delete(input.runId), 5000);
  }
}

/** Test-only escape hatch. */
export function _resetRunnerStateForTests(): void {
  inFlight.clear();
  runEmitters.clear();
}
