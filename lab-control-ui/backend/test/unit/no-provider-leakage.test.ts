// T047 (US5): mechanically guards that no provider-specific conditional
// leaks outside the provider module itself, so adding a second provider
// (AWS, Azure) never requires touching generic route/runner/db code.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '..', '..', 'src');
const ALLOWED_FILES = new Set([
  join(SRC_ROOT, 'providers', 'gcp.ts'),
  join(SRC_ROOT, 'providers', 'registry.ts'),
]);
const LEAK_PATTERN = /['"]gcp['"]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('provider isolation', () => {
  it('no source file outside providers/gcp.ts or providers/registry.ts references the literal "gcp"', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      if (ALLOWED_FILES.has(file)) continue;
      const content = readFileSync(file, 'utf8');
      if (LEAK_PATTERN.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
