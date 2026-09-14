// needsRecovery's decision table (exposureRecovery.ts): recover iff a
// firewall rule is still open (proof an operator previously approved
// expose-*) but the tracked tunnel isn't currently alive.

import { describe, expect, it } from 'vitest';
import { needsRecovery } from '../../src/actions/exposureRecovery.js';
import type { ExposureRecord } from '../../src/routes/exposures.js';

function exposure(overrides: Partial<ExposureRecord> = {}): ExposureRecord {
  return { id: 'fhir', label: 'HAPI FHIR', exposed: false, ...overrides };
}

describe('needsRecovery', () => {
  it('recovers a dead tunnel behind a still-open firewall rule', () => {
    expect(needsRecovery(exposure({ exposed: false, firewallRule: 'allow-hapi-fhir-8080-lab' }))).toBe(
      true,
    );
  });

  it('does not recover an already-live exposure', () => {
    expect(needsRecovery(exposure({ exposed: true, firewallRule: 'allow-hapi-fhir-8080-lab' }))).toBe(
      false,
    );
  });

  it('does not recover a service that was never exposed (no firewall rule)', () => {
    expect(needsRecovery(exposure({ exposed: false, firewallRule: undefined }))).toBe(false);
  });
});
