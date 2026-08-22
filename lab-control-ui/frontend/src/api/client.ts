// Typed client for the contracts/api.md HTTP surface. All requests include
// credentials so the session cookie rides along (T023, T033, T040, T043).

import type {
  ActionRunDetail,
  ActionRunSummary,
  ExposureRecord,
  LabConfiguration,
  PrereqCheck,
  ProviderPublicShape,
  RunArtifacts,
} from './types.js';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${status}`,
    );
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  let body: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export async function login(secret: string): Promise<void> {
  await request('/auth/login', { method: 'POST', body: JSON.stringify({ secret }) });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function fetchProviders(): Promise<ProviderPublicShape[]> {
  const res = await request<{ providers: ProviderPublicShape[] }>('/providers');
  return res.providers;
}

export async function fetchPrerequisites(provider: string): Promise<PrereqCheck[]> {
  const res = await request<{ checks: PrereqCheck[] }>(
    `/prerequisites?provider=${encodeURIComponent(provider)}`,
  );
  return res.checks;
}

export async function fetchLabs(): Promise<LabConfiguration[]> {
  const res = await request<{ labs: LabConfiguration[] }>('/labs');
  return res.labs;
}

export async function fetchLab(id: string): Promise<LabConfiguration> {
  return request<LabConfiguration>(`/labs/${id}`);
}

export async function createLab(
  provider: string,
  fields: Record<string, unknown>,
): Promise<LabConfiguration> {
  return request<LabConfiguration>('/labs', {
    method: 'POST',
    body: JSON.stringify({ provider, fields }),
  });
}

export async function updateLab(
  id: string,
  fields: Record<string, unknown>,
): Promise<LabConfiguration> {
  return request<LabConfiguration>(`/labs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function fetchCommandPreview(labId: string, action: string): Promise<string> {
  const res = await request<{ command: string }>(
    `/labs/${labId}/preview?action=${encodeURIComponent(action)}`,
  );
  return res.command;
}

export async function fetchRunsForLab(labId: string): Promise<ActionRunSummary[]> {
  const res = await request<{ runs: ActionRunSummary[] }>(`/labs/${labId}/runs`);
  return res.runs;
}

export async function fetchRun(runId: string): Promise<ActionRunDetail> {
  return request<ActionRunDetail>(`/runs/${runId}`);
}

/** Result artifacts (dataset/benchmark summaries, published report) for a
 * seed/benchmark/report run -- distinct from the process log fetched via
 * LogViewer. `files: []` is a normal response (nothing produced yet, or
 * this action never writes into a run directory), not an error. */
export async function fetchRunArtifacts(runId: string): Promise<RunArtifacts> {
  return request<RunArtifacts>(`/runs/${runId}/artifacts`);
}

export async function fetchExposures(labId: string): Promise<ExposureRecord[]> {
  const res = await request<{ exposures: ExposureRecord[] }>(`/labs/${labId}/exposures`);
  return res.exposures;
}

export interface TriggerResult {
  actionRunId: string;
  streamUrl: string;
}

export interface TriggerActionOptions {
  confirmed?: boolean;
  overridePrerequisites?: boolean;
  /** For `report`: which prior run's artifacts to report on. Omit to default
   * to the lab's most recent succeeded `benchmark` run. */
  targetRunId?: string;
  /** `benchmark` only: run as Kubernetes Job shard(s) inside the cluster
   * (real Service-DNS traffic, load-balanced across every backing pod) in
   * place of the default `kubectl port-forward`-based local run (which
   * pins all traffic to a single pod -- see docs/lab-cli.md). */
  inCluster?: boolean;
  /** `benchmark` + inCluster only: number of parallel k6 shard pods.
   * Defaults to 1 server-side. >1 requires a ReadWriteMany PVC backing
   * `echis-shard-output` (e.g. GCP Filestore) -- plain GCE PD storage
   * classes only support ReadWriteOnce, i.e. shards=1. */
  parallelShards?: number;
  /** `seed` only: restore a prior `backup-db` directory-format pg_dump
   * straight into the database instead of generating fresh synthetic data.
   * Requires `backupDir`. Much faster than regenerating + re-loading. */
  restoreFromBackup?: boolean;
  /** `seed` (with restoreFromBackup) + `backup-db`: the pg_dump/pg_restore
   * directory path -- restore source for `seed`, backup destination for
   * `backup-db`. Defaults server-side to this lab's own backup directory
   * when omitted for `backup-db`; required for `seed`'s restore path. */
  backupDir?: string;
}

export async function triggerAction(
  labId: string,
  actionName: string,
  options: TriggerActionOptions = {},
): Promise<TriggerResult> {
  return request<TriggerResult>(`/labs/${labId}/actions/${actionName}`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}
