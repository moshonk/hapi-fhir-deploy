// Frontend-side fixture mirroring GET /api/providers's GCP shape
// (backend/src/providers/gcp.ts), kept intentionally minimal to what
// component tests need -- the backend's own commandBuilder.test.ts is the
// source of truth for the full field/action list.

import type { ProviderPublicShape } from '../../src/api/types.js';

export const gcpProviderFixture: ProviderPublicShape = {
  id: 'gcp',
  label: 'Google Cloud (GKE + Cloud SQL)',
  configFields: [
    {
      key: 'lab_name',
      label: 'Lab name',
      scope: 'common',
      type: 'string',
      default: 'hapi-fhir-lab',
      helpText: '',
      cliMapping: '',
    },
    {
      key: 'ttl_hours',
      label: 'TTL (hours)',
      scope: 'common',
      type: 'number',
      default: 4,
      helpText: '',
      cliMapping: '',
    },
    {
      key: 'project_id',
      label: 'GCP project ID',
      scope: 'provider',
      type: 'string',
      default: null,
      helpText: '',
      cliMapping: '',
    },
    {
      key: 'region',
      label: 'Region',
      scope: 'provider',
      type: 'string',
      default: 'us-central1',
      helpText: '',
      cliMapping: '',
    },
    {
      key: 'node_size',
      label: 'Node size',
      scope: 'provider',
      type: 'string',
      default: 'e2-standard-4',
      helpText: '',
      cliMapping: '',
    },
    {
      key: 'enable_pgbouncer',
      label: 'Enable PgBouncer pooled tier',
      scope: 'common',
      type: 'boolean',
      default: false,
      helpText: '',
      cliMapping: '',
    },
  ],
  actions: [
    {
      name: 'up',
      label: 'Provision infrastructure',
      cliSubcommand: 'up',
      scope: 'common',
      requiresConfirmation: true,
      confirmationMessage: 'This creates real, billable GCP resources.',
      requiredPrerequisiteIds: ['terraform'],
    },
    {
      name: 'deploy',
      label: 'Deploy HAPI FHIR',
      cliSubcommand: 'deploy',
      scope: 'common',
      requiresConfirmation: false,
      confirmationMessage: null,
      requiredPrerequisiteIds: ['helm'],
      sequenceAfter: 'up',
    },
  ],
};
