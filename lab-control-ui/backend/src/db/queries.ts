// DB access layer for lab_configurations / action_runs (T011).

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface LabConfigurationRow {
  id: string;
  provider: string;
  name: string;
  fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ActionRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ActionRunRow {
  id: string;
  lab_configuration_id: string;
  action_name: string;
  status: ActionRunStatus;
  command_preview: string;
  log_file_path: string;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToLabConfiguration(row: Record<string, unknown>): LabConfigurationRow {
  return {
    id: row.id as string,
    provider: row.provider as string,
    name: row.name as string,
    fields: JSON.parse(row.fields_json as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToActionRun(row: Record<string, unknown>): ActionRunRow {
  return {
    id: row.id as string,
    lab_configuration_id: row.lab_configuration_id as string,
    action_name: row.action_name as string,
    status: row.status as ActionRunStatus,
    command_preview: row.command_preview as string,
    log_file_path: row.log_file_path as string,
    started_at: (row.started_at as string) ?? null,
    ended_at: (row.ended_at as string) ?? null,
    exit_code: (row.exit_code as number) ?? null,
  };
}

// --- lab_configurations ---

export function createLabConfiguration(
  db: DatabaseSync,
  input: { provider: string; name: string; fields: Record<string, unknown> },
): LabConfigurationRow {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO lab_configurations (id, provider, name, fields_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.provider, input.name, JSON.stringify(input.fields), ts, ts);
  return {
    id,
    provider: input.provider,
    name: input.name,
    fields: input.fields,
    created_at: ts,
    updated_at: ts,
  };
}

export function getLabConfiguration(db: DatabaseSync, id: string): LabConfigurationRow | undefined {
  const row = db.prepare('SELECT * FROM lab_configurations WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToLabConfiguration(row) : undefined;
}

export function listLabConfigurations(db: DatabaseSync): LabConfigurationRow[] {
  const rows = db
    .prepare('SELECT * FROM lab_configurations ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToLabConfiguration);
}

export function updateLabConfiguration(
  db: DatabaseSync,
  id: string,
  patch: { name?: string; fields?: Record<string, unknown> },
): LabConfigurationRow | undefined {
  const existing = getLabConfiguration(db, id);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const fields = patch.fields ? { ...existing.fields, ...patch.fields } : existing.fields;
  const ts = nowIso();
  db.prepare(
    'UPDATE lab_configurations SET name = ?, fields_json = ?, updated_at = ? WHERE id = ?',
  ).run(name, JSON.stringify(fields), ts, id);
  return { ...existing, name, fields, updated_at: ts };
}

// --- action_runs ---

export function createActionRun(
  db: DatabaseSync,
  input: {
    id?: string;
    labConfigurationId: string;
    actionName: string;
    commandPreview: string;
    logFilePath: string;
  },
): ActionRunRow {
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO action_runs (id, lab_configuration_id, action_name, status, command_preview, log_file_path)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).run(id, input.labConfigurationId, input.actionName, input.commandPreview, input.logFilePath);
  return {
    id,
    lab_configuration_id: input.labConfigurationId,
    action_name: input.actionName,
    status: 'pending',
    command_preview: input.commandPreview,
    log_file_path: input.logFilePath,
    started_at: null,
    ended_at: null,
    exit_code: null,
  };
}

export function markActionRunStarted(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE action_runs SET status = 'running', started_at = ? WHERE id = ?").run(
    nowIso(),
    id,
  );
}

export function markActionRunFinished(db: DatabaseSync, id: string, exitCode: number): void {
  const status: ActionRunStatus = exitCode === 0 ? 'succeeded' : 'failed';
  db.prepare('UPDATE action_runs SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?').run(
    status,
    nowIso(),
    exitCode,
    id,
  );
}

export function getActionRun(db: DatabaseSync, id: string): ActionRunRow | undefined {
  const row = db.prepare('SELECT * FROM action_runs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToActionRun(row) : undefined;
}

export function listActionRunsForLab(db: DatabaseSync, labConfigurationId: string): ActionRunRow[] {
  const rows = db
    .prepare('SELECT * FROM action_runs WHERE lab_configuration_id = ? ORDER BY rowid DESC')
    .all(labConfigurationId) as Record<string, unknown>[];
  return rows.map(rowToActionRun);
}

export function findRunningActionRun(
  db: DatabaseSync,
  labConfigurationId: string,
  actionName: string,
): ActionRunRow | undefined {
  const row = db
    .prepare(
      "SELECT * FROM action_runs WHERE lab_configuration_id = ? AND action_name = ? AND status IN ('pending','running') ORDER BY rowid DESC LIMIT 1",
    )
    .get(labConfigurationId, actionName) as Record<string, unknown> | undefined;
  return row ? rowToActionRun(row) : undefined;
}

/** Most recent run of `actionName` for a lab, regardless of status -- used
 * for Edge Case 3 sequencing hints (e.g. disable `seed` until `deploy`'s
 * most recent run succeeded). */
export function latestActionRun(
  db: DatabaseSync,
  labConfigurationId: string,
  actionName: string,
): ActionRunRow | undefined {
  const row = db
    .prepare(
      'SELECT * FROM action_runs WHERE lab_configuration_id = ? AND action_name = ? ORDER BY rowid DESC LIMIT 1',
    )
    .get(labConfigurationId, actionName) as Record<string, unknown> | undefined;
  return row ? rowToActionRun(row) : undefined;
}
