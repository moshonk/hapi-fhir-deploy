// T022: renders the ConfigField schema from GET /api/providers, grouped by
// scope (common vs provider-specific) per FR-017/US5 -- this component has
// no GCP-specific knowledge of its own, it only renders whatever schema the
// selected provider declares.

import type { ChangeEvent } from 'react';
import type { ConfigField, ProviderPublicShape } from '../api/types.js';

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

function FieldGroup({
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
      {fields.map((field) => (
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
    </fieldset>
  );
}

export function ConfigForm({ provider, values, onChange }: ConfigFormProps) {
  const common = provider.configFields.filter((f) => f.scope === 'common');
  const specific = provider.configFields.filter((f) => f.scope === 'provider');

  return (
    <form aria-label="Lab configuration" onSubmit={(e) => e.preventDefault()}>
      <FieldGroup title="Common settings" fields={common} values={values} onChange={onChange} />
      <FieldGroup
        title={`${provider.label} settings`}
        fields={specific}
        values={values}
        onChange={onChange}
      />
    </form>
  );
}
