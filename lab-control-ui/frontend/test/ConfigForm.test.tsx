// T025 (US1): only project_id renders as required/blocking; editing one
// field leaves the others unchanged.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfigForm } from '../src/components/ConfigForm.js';
import { gcpProviderFixture } from './fixtures/gcpProvider.js';
import type { ConfigField, ProviderPublicShape } from '../src/api/types.js';

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

  it('keeps the common/provider fieldsets and renders group headings inside each, in a fixed order regardless of field order', () => {
    const field = (key: string, scope: ConfigField['scope'], group?: ConfigField['group']): ConfigField => ({
      key,
      label: key,
      scope,
      group,
      type: 'string',
      default: '',
      helpText: '',
      cliMapping: '',
    });
    const provider: ProviderPublicShape = {
      ...gcpProviderFixture,
      configFields: [
        field('pool_size', 'common', 'pooling'),
        field('db_tier', 'provider', 'database'),
        field('lab_name', 'common', 'lab'),
        field('region', 'provider', 'location'),
        field('replicas', 'common', 'scaling'),
        field('node_size', 'provider', 'cluster'),
      ],
    };
    render(<ConfigForm provider={provider} values={{}} onChange={() => {}} />);

    const common = screen.getByRole('group', { name: 'Common settings' });
    expect(within(common).getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Lab',
      'Connection pooling',
      'Autoscaling',
    ]);
    const specific = screen.getByRole('group', { name: `${provider.label} settings` });
    expect(within(specific).getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Cloud location',
      'Kubernetes cluster',
      'Database',
    ]);
    expect(within(common).getByLabelText('pool_size')).toBeInTheDocument();
    expect(within(specific).getByLabelText('db_tier')).toBeInTheDocument();
  });

  it('renders a field with no group under a catch-all "Other" heading within its own scope instead of dropping it', () => {
    const provider: ProviderPublicShape = {
      ...gcpProviderFixture,
      configFields: [
        { key: 'mystery', label: 'Mystery knob', scope: 'provider', type: 'string', default: '', helpText: '', cliMapping: '' },
      ],
    };
    render(<ConfigForm provider={provider} values={{}} onChange={() => {}} />);

    const specific = screen.getByRole('group', { name: `${provider.label} settings` });
    expect(within(specific).getByRole('heading', { name: 'Other' })).toBeInTheDocument();
    expect(within(specific).getByLabelText('Mystery knob')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Common settings' })).not.toBeInTheDocument();
  });
});
