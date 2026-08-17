// T023: wires ConfigForm to POST/PATCH /api/labs. A lab is created lazily
// (once, on first edit) so the operator always has a real labId to preview
// commands and trigger actions against; every subsequent edit debounces
// into a PATCH that only ever touches the field being edited, never resets
// the rest of the form (Story 1, Scenario 2).
//
// Callers MUST render this with `key={lab?.id ?? 'new'}` (see App.tsx) so
// switching to a different saved lab remounts fresh `values` state instead
// of this component resetting it imperatively inside an effect.

import { useCallback, useRef, useState } from 'react';
import { ConfigForm } from '../components/ConfigForm.js';
import { createLab, updateLab } from '../api/client.js';
import type { LabConfiguration, ProviderPublicShape } from '../api/types.js';

export interface ConfigureLabProps {
  provider: ProviderPublicShape;
  lab: LabConfiguration | null;
  onLabChange: (lab: LabConfiguration) => void;
}

const DEBOUNCE_MS = 400;

export function ConfigureLab({ provider, lab, onLabChange }: ConfigureLabProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => lab?.fields ?? {});
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});

  const flushPatch = useCallback(async () => {
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    if (lab) {
      const updated = await updateLab(lab.id, patch);
      onLabChange(updated);
    } else {
      const created = await createLab(provider.id, patch);
      onLabChange(created);
    }
  }, [lab, provider.id, onLabChange]);

  function handleChange(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
    pendingPatch.current = { ...pendingPatch.current, [key]: value };
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void flushPatch();
    }, DEBOUNCE_MS);
  }

  return (
    <section aria-label="Configure lab">
      <h2>Configure lab</h2>
      <ConfigForm provider={provider} values={values} onChange={handleChange} />
      {lab && !lab.launchable && (
        <p className="launchable-warning">
          Fill in every required field (marked *) before triggering actions.
        </p>
      )}
    </section>
  );
}
