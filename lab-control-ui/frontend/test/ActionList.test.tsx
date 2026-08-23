// Covers the benchmark-only "run in-cluster" trigger-time controls added
// alongside routes/actions.ts's inCluster/parallelShards body fields
// (gcp.ts's 'benchmark' case doc comment): the checkbox/shard-count inputs
// only appear next to the benchmark action, and clicking its button passes
// the current { inCluster, parallelShards } through onTrigger -- every
// other action gets no benchmarkOptions argument at all.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionList } from '../src/components/ActionList.js';
import type { ActionDef, ActionRunSummary } from '../src/api/types.js';

function action(overrides: Partial<ActionDef> = {}): ActionDef {
  return {
    name: 'benchmark',
    label: 'Run k6 benchmark',
    cliSubcommand: 'benchmark',
    scope: 'common',
    requiresConfirmation: false,
    confirmationMessage: null,
    requiredPrerequisiteIds: [],
    ...overrides,
  };
}

function run(overrides: Partial<ActionRunSummary> = {}): ActionRunSummary {
  return {
    id: 'run-1',
    action_name: 'seed',
    status: 'succeeded',
    started_at: null,
    ended_at: null,
    exit_code: 0,
    ...overrides,
  };
}

describe('ActionList', () => {
  it('shows no in-cluster controls for a non-benchmark action, and triggers it with no benchmarkOptions', () => {
    const onTrigger = vi.fn();
    render(
      <ActionList
        actions={[action({ name: 'deploy', label: 'Deploy' })]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={onTrigger}
      />,
    );

    expect(screen.queryByLabelText(/run in-cluster/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'deploy' }), undefined);
  });

  it('defaults benchmark to not-in-cluster, and the shard count input is hidden until checked', () => {
    const onTrigger = vi.fn();
    render(
      <ActionList
        actions={[action()]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={onTrigger}
      />,
    );

    expect(screen.queryByLabelText(/parallel shards/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run k6 benchmark' }));
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'benchmark' }), {
      inCluster: false,
      parallelShards: 1,
    });
  });

  it('checking "Run in-cluster" reveals the shard count input and threads both through onTrigger', () => {
    const onTrigger = vi.fn();
    render(
      <ActionList
        actions={[action()]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={onTrigger}
      />,
    );

    fireEvent.click(screen.getByLabelText(/run in-cluster/i));
    const shardInput = screen.getByLabelText(/parallel shards/i);
    fireEvent.change(shardInput, { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: 'Run k6 benchmark' }));
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'benchmark' }), {
      inCluster: true,
      parallelShards: 5,
    });
  });

  it('defaults seed to generating fresh data (no restore options threaded through)', () => {
    const onTrigger = vi.fn();
    render(
      <ActionList
        actions={[action({ name: 'seed', label: 'Seed synthetic data', cliSubcommand: 'seed' })]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        labName="hapi-fhir-lab"
        providerId="gcp"
        onTrigger={onTrigger}
      />,
    );

    expect(screen.queryByLabelText(/backup directory/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seed synthetic data' }));
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'seed' }), undefined);
  });

  it('checking "Restore from backup" reveals a prefilled backup directory and threads both through onTrigger', () => {
    const onTrigger = vi.fn();
    render(
      <ActionList
        actions={[action({ name: 'seed', label: 'Seed synthetic data', cliSubcommand: 'seed' })]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        labName="hapi-fhir-lab"
        providerId="gcp"
        onTrigger={onTrigger}
      />,
    );

    fireEvent.click(screen.getByLabelText(/restore from backup/i));
    const dirInput = screen.getByLabelText(/backup directory/i);
    expect(dirInput).toHaveValue('ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup');
    fireEvent.change(dirInput, { target: { value: '/tmp/my-backup' } });

    fireEvent.click(screen.getByRole('button', { name: 'Seed synthetic data' }));
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'seed' }), {
      restoreFromBackup: true,
      backupDir: '/tmp/my-backup',
    });
  });

  it('backup-db always threads a prefilled backup directory through onTrigger', () => {
    const onTrigger = vi.fn();
    render(
      <ActionList
        actions={[
          action({ name: 'backup-db', label: 'Backup database', cliSubcommand: 'backup-db' }),
        ]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        labName="hapi-fhir-lab"
        providerId="gcp"
        onTrigger={onTrigger}
      />,
    );

    const dirInput = screen.getByLabelText(/backup directory/i);
    expect(dirInput).toHaveValue('ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup');

    fireEvent.click(screen.getByRole('button', { name: 'Backup database' }));
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'backup-db' }), {
      backupDir: 'ansible/artifacts/lab/gcp/hapi-fhir-lab/db-backup',
    });
  });

  it("shows the action's plain-language description as the button's hover tooltip", () => {
    render(
      <ActionList
        actions={[
          action({
            name: 'down',
            label: 'Destroy infrastructure',
            description: 'Permanently deletes everything for this lab. This cannot be undone.',
          }),
        ]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Destroy infrastructure' })).toHaveAttribute(
      'title',
      'Permanently deletes everything for this lab. This cannot be undone.',
    );
  });

  it('appends the disabled reason after the description in the tooltip, rather than replacing it', () => {
    render(
      <ActionList
        actions={[
          action({
            name: 'benchmark',
            label: 'Run k6 benchmark',
            description: 'Runs a load test.',
            sequenceAfter: 'seed',
          }),
        ]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Run k6 benchmark' })).toHaveAttribute(
      'title',
      'Runs a load test.\n\nrun seed successfully first',
    );
  });

  it('disables a sequenceAfter action whose named action never succeeded, even once', () => {
    render(
      <ActionList
        actions={[
          action({ name: 'benchmark', label: 'Run k6 benchmark', sequenceAfter: 'seed' }),
        ]}
        runs={[run({ status: 'failed' })]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Run k6 benchmark' })).toBeDisabled();
  });

  it('keeps a sequenceAfterAnySuccess action enabled once its named action ever succeeded, even if the most recent run of it later failed', () => {
    render(
      <ActionList
        actions={[
          action({
            name: 'backup-db',
            label: 'Backup database',
            cliSubcommand: 'backup-db',
            sequenceAfter: 'seed',
            sequenceAfterAnySuccess: true,
          }),
        ]}
        runs={[run({ id: 'run-1', status: 'failed' }), run({ id: 'run-2', status: 'succeeded' })]}
        prereqChecks={[]}
        runningActionName={null}
        labName="hapi-fhir-lab"
        providerId="gcp"
        onTrigger={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Backup database' })).not.toBeDisabled();
  });

  it('disables a sequenceAfterAnySuccess action when its named action has never once succeeded', () => {
    render(
      <ActionList
        actions={[
          action({
            name: 'backup-db',
            label: 'Backup database',
            cliSubcommand: 'backup-db',
            sequenceAfter: 'seed',
            sequenceAfterAnySuccess: true,
          }),
        ]}
        runs={[run({ status: 'failed' })]}
        prereqChecks={[]}
        runningActionName={null}
        labName="hapi-fhir-lab"
        providerId="gcp"
        onTrigger={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Backup database' })).toBeDisabled();
  });

  it('renders each group heading once, in a fixed order, regardless of the order actions were passed in', () => {
    render(
      <ActionList
        actions={[
          action({ name: 'benchmark', label: 'Run k6 benchmark', group: 'benchmark' }),
          action({ name: 'up', label: 'Provision infrastructure', group: 'lifecycle' }),
          action({ name: 'seed', label: 'Seed synthetic data', group: 'data' }),
          action({ name: 'report', label: 'Publish report', group: 'benchmark' }),
        ]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={vi.fn()}
      />,
    );

    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Infrastructure lifecycle', 'Data', 'Benchmarking']);
  });

  it('groups an action with no group under a catch-all "Other" heading instead of dropping it', () => {
    render(
      <ActionList
        actions={[action({ name: 'up', label: 'Provision infrastructure', group: undefined })]}
        runs={[]}
        prereqChecks={[]}
        runningActionName={null}
        onTrigger={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Provision infrastructure' })).toBeInTheDocument();
  });
});
