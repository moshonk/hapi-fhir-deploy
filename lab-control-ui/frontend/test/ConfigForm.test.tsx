// T025 (US1): only project_id renders as required/blocking; editing one
// field leaves the others unchanged.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfigForm } from '../src/components/ConfigForm.js';
import { gcpProviderFixture } from './fixtures/gcpProvider.js';

function Harness() {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const f of gcpProviderFixture.configFields)
      if (f.default !== null) defaults[f.key] = f.default;
    return defaults;
  });
  return (
    <ConfigForm
      provider={gcpProviderFixture}
      values={values}
      onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
    />
  );
}

describe('ConfigForm', () => {
  it('marks only project_id as required, pre-fills every other field', () => {
    render(<Harness />);

    const projectIdInput = screen.getByLabelText(/GCP project ID/i) as HTMLInputElement;
    expect(projectIdInput).toBeRequired();
    expect(projectIdInput.value).toBe('');

    const regionInput = screen.getByLabelText(/^Region$/i) as HTMLInputElement;
    expect(regionInput).not.toBeRequired();
    expect(regionInput.value).toBe('us-central1');

    const nodeSizeInput = screen.getByLabelText(/Node size/i) as HTMLInputElement;
    expect(nodeSizeInput.value).toBe('e2-standard-4');
  });

  it('editing one field leaves the others unchanged (Story 1, Scenario 2)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const nodeSizeInput = screen.getByLabelText(/Node size/i) as HTMLInputElement;
    await user.clear(nodeSizeInput);
    await user.type(nodeSizeInput, 'c3-standard-8');

    expect(nodeSizeInput.value).toBe('c3-standard-8');
    expect((screen.getByLabelText(/^Region$/i) as HTMLInputElement).value).toBe('us-central1');
    expect((screen.getByLabelText(/TTL/i) as HTMLInputElement).value).toBe('4');
  });

  it('renders a boolean field as an unchecked, non-required checkbox and toggles it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const pgbouncerCheckbox = screen.getByLabelText(/Enable PgBouncer/i) as HTMLInputElement;
    expect(pgbouncerCheckbox.type).toBe('checkbox');
    expect(pgbouncerCheckbox.checked).toBe(false);
    expect(pgbouncerCheckbox).not.toBeRequired();

    await user.click(pgbouncerCheckbox);
    expect(pgbouncerCheckbox.checked).toBe(true);
  });
});
