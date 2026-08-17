// Once a service is exposed, a link (and credentials, if applicable) must
// be shown; nothing exposed (or still loading) must render nothing.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExposurePanel } from '../src/components/ExposurePanel.js';
import type { ExposureRecord } from '../src/api/types.js';

describe('ExposurePanel', () => {
  it('renders nothing while exposures are still loading (null)', () => {
    const { container } = render(<ExposurePanel exposures={null} error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nothing is currently exposed', () => {
    const exposures: ExposureRecord[] = [
      { id: 'fhir', label: 'HAPI FHIR', exposed: false },
      { id: 'prometheus', label: 'Prometheus', exposed: false },
    ];
    const { container } = render(<ExposurePanel exposures={exposures} error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a link for an exposed service with no auth (FHIR)', () => {
    const exposures: ExposureRecord[] = [
      {
        id: 'fhir',
        label: 'HAPI FHIR',
        exposed: true,
        url: 'http://203.0.113.5:8080/fhir',
        port: '8080',
        firewallRule: 'allow-hapi-fhir-8080-hapi-fhir-lab',
      },
    ];
    render(<ExposurePanel exposures={exposures} error={null} />);
    const link = screen.getByRole('link', { name: 'http://203.0.113.5:8080/fhir' });
    expect(link).toHaveAttribute('href', 'http://203.0.113.5:8080/fhir');
    expect(screen.queryByText(/Login:/)).not.toBeInTheDocument();
  });

  it('shows a link AND credentials for an exposed service that requires login (Grafana)', () => {
    const exposures: ExposureRecord[] = [
      {
        id: 'grafana',
        label: 'Grafana',
        exposed: true,
        url: 'http://203.0.113.5:3000',
        port: '3000',
        firewallRule: 'allow-grafana-3000-hapi-fhir-lab',
        credentialsAvailable: true,
        username: 'admin',
        password: 'sekrit',
      },
    ];
    render(<ExposurePanel exposures={exposures} error={null} />);
    expect(screen.getByRole('link', { name: 'http://203.0.113.5:3000' })).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('sekrit')).toBeInTheDocument();
  });

  it('shows the reason when Grafana credentials could not be fetched', () => {
    const exposures: ExposureRecord[] = [
      {
        id: 'grafana',
        label: 'Grafana',
        exposed: true,
        url: 'http://203.0.113.5:3000',
        port: '3000',
        firewallRule: 'allow-grafana-3000-hapi-fhir-lab',
        credentialsAvailable: false,
        credentialsReason: "could not read the 'prometheus-grafana' Secret",
      },
    ];
    render(<ExposurePanel exposures={exposures} error={null} />);
    expect(screen.getByText(/could not read the 'prometheus-grafana' Secret/)).toBeInTheDocument();
  });

  it('shows the error message when the exposures check itself failed', () => {
    render(<ExposurePanel exposures={null} error="ECONNREFUSED" />);
    expect(screen.getByText(/Could not check public exposures: ECONNREFUSED/)).toBeInTheDocument();
  });
});
