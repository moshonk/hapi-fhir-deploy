// Typed client for the contracts/api.md HTTP surface. All requests include
// credentials so the session cookie rides along (T023, T033, T040, T043).

import type {
  ActionRunDetail,
  ActionRunSummary,
  LabConfiguration,
  PrereqCheck,
  ProviderPublicShape,
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
