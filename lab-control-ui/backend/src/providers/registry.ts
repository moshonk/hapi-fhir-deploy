// Registry of all ProviderAdapters. Adding a new provider (AWS, Azure --
// both already accepted by scripts/lab --cloud) means writing one new
// adapter module and adding one line here (spec.md FR-017/018, US5) -- no
// change to any generic route/runner/db code.

import type { ProviderAdapter } from './types.js';
import { gcpProvider } from './gcp.js';

export const providers: Record<string, ProviderAdapter> = {
  gcp: gcpProvider,
};

export function getProvider(id: string): ProviderAdapter | undefined {
  return providers[id];
}

export function listProviders(): ProviderAdapter[] {
  return Object.values(providers);
}
