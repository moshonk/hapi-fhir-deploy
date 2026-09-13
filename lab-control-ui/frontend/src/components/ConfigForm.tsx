// T022: renders the ConfigField schema from GET /api/providers, grouped by
// scope (common vs provider-specific) per FR-017/US5, and within each scope
// by ConfigField.group -- this component has no GCP-specific knowledge of its
// own, it only renders whatever schema the selected provider declares.

import type { ChangeEvent } from 'react';
import type { ConfigField, ConfigFieldGroupId, ProviderPublicShape } from '../api/types.js';

// Display order and heading text for ConfigField.group, mirroring
// ActionList's ACTION_GROUP_ORDER/LABELS. 'other' is a catch-all for a field
// a provider hasn't assigned a group to yet, so grouping degrades gracefully
// instead of dropping it. Sections sit INSIDE each scope fieldset, and follow
// roughly the order an operator fills them in: the lab itself, where and on
// what it runs, the tiers deployed on top, then data, benchmarking and
// exposure.
const CONFIG_FIELD_GROUP_ORDER: Array<ConfigFieldGroupId | 'other'> = [
  'lab',
  'location',
  'cluster',
  'database',
  'pooling',
  'hapi',
  'scaling',
  'data',
  'benchmark',
  'exposure',
  'other',
];

const CONFIG_FIELD_GROUP_LABELS: Record<ConfigFieldGroupId | 'other', string> = {
  lab: 'Lab',
  location: 'Cloud location',
  cluster: 'Kubernetes cluster',
  database: 'Database',
  pooling: 'Connection pooling',
  hapi: 'HAPI FHIR server',
  scaling: 'Autoscaling',
  data: 'Synthetic data',
  benchmark: 'Benchmarking',
  exposure: 'Public exposure',
  other: 'Other',
};

function groupFields(
  fields: ConfigField[],
): Array<{ id: ConfigFieldGroupId | 'other'; fields: ConfigField[] }> {
  const byGroup = new Map<ConfigFieldGroupId | 'other', ConfigField[]>();
  for (const field of fields) {
    const id = field.group ?? 'other';
    const bucket = byGroup.get(id);
    if (bucket) bucket.push(field);
    else byGroup.set(id, [field]);
  }
  return CONFIG_FIELD_GROUP_ORDER.filter((id) => byGroup.has(id)).map((id) => ({
    id,
    fields: byGroup.get(id)!,
  }));
}

export interface ConfigFormProps {
  provider: ProviderPublicShape;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const isRequired = field.default === null;
  const isBlocking =
    isRequired && (value === undefined || value === null || String(value).trim() === '');

  if (field.type === 'enum' && field.enumValues) {
    return (
      <select
        id={field.key}
        value={String(value ?? '')}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {field.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'boolean') {
    return (
      <input
        id={field.key}
        type="checkbox"
        checked={value === true}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    );
  }

  return (
    <input
      id={field.key}
      type={field.type === 'number' ? 'number' : 'text'}
      value={value === undefined || value === null ? '' : String(value)}
      required={isRequired}
      aria-required={isRequired}
      data-blocking={isBlocking ? 'true' : undefined}
      placeholder={isRequired ? 'required' : undefined}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)
      }
    />
  );
}

function ScopeFieldset({
  title,
  fields,
  values,
  onChange,
}: {
  title: string;
  fields: ConfigField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <fieldset>
      <legend>{title}</legend>
      {groupFields(fields).map(({ id, fields: groupedFields }) => (
        <div className="config-group" key={id}>
          <h4 className="config-group-label">{CONFIG_FIELD_GROUP_LABELS[id]}</h4>
          {groupedFields.map((field) => (
            <div key={field.key} className="config-field">
              <label htmlFor={field.key}>
                {field.label}
                {field.default === null && <span aria-hidden="true"> *</span>}
              </label>
              <FieldInput
                field={field}
                value={values[field.key]}
                onChange={(v) => onChange(field.key, v)}
              />
              {field.helpText && <p className="help-text">{field.helpText}</p>}
            </div>
          ))}
        </div>
      ))}
    </fieldset>
  );
}

export function ConfigForm({ provider, values, onChange }: ConfigFormProps) {
  const common = provider.configFields.filter((f) => f.scope === 'common');
  const specific = provider.configFields.filter((f) => f.scope === 'provider');

  return (
    <form aria-label="Lab configuration" onSubmit={(e) => e.preventDefault()}>
      <ScopeFieldset title="Common settings" fields={common} values={values} onChange={onChange} />
      <ScopeFieldset
        title={`${provider.label} settings`}
        fields={specific}
        values={values}
        onChange={onChange}
      />
    </form>
  );
}
