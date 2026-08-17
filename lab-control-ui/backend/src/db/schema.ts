// node:sqlite schema init (T010, data-model.md). Node's built-in SQLite
// module -- no native-compiled dependency, single file on the same host
// that already owns all other lab state (research.md §3).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_configurations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS action_runs (
      id TEXT PRIMARY KEY,
      lab_configuration_id TEXT NOT NULL REFERENCES lab_configurations(id),
      action_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      command_preview TEXT NOT NULL,
      log_file_path TEXT NOT NULL,
      cli_run_label TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      ended_at TEXT,
      exit_code INTEGER
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_action_runs_lab
      ON action_runs (lab_configuration_id, started_at DESC);
  `);

  migrateAddColumnIfMissing(db, 'action_runs', 'cli_run_label', "TEXT NOT NULL DEFAULT ''");
}

/** CREATE TABLE IF NOT EXISTS is a no-op against an already-existing table
 * (SQLite doesn't diff column lists), so a DB file created by an earlier
 * version of this schema would otherwise silently lack a newly-added
 * column. Adds it if missing; a fresh DB already has it from the CREATE
 * TABLE above, so this is a no-op there. */
function migrateAddColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}
