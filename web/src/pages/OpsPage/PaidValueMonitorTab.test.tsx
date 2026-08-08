import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PaidValueMonitorTab from './PaidValueMonitorTab';
import { PaidValueMonitorResponse } from './paidValueMonitor';

const mockFetch = (payload: PaidValueMonitorResponse) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
};

const emptyGroup = {
  checked: 0,
  withValue: 0,
  zeroValueTried: 0,
  zeroValueNeverTried: 0,
  rows: [],
};

const baseResponse: PaidValueMonitorResponse = {
  window_since: '2026-07-07T12:00:00.000Z',
  as_of: '2026-07-14T12:00:00.000Z',
  passes: { ...emptyGroup, rows: [] },
  claimedAnonymousPasses: { ...emptyGroup, rows: [] },
  unclaimedAnonymousPasses: 0,
  newSubscriptions: { ...emptyGroup, rows: [] },
};

describe('PaidValueMonitorTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('lists zero-value pass and subscription rows after a check', async () => {
    mockFetch({
      ...baseResponse,
      passes: {
        checked: 2,
        withValue: 1,
        zeroValueTried: 1,
        zeroValueNeverTried: 0,
        rows: [
          {
            userId: 4242,
            kind: '24h',
            expiresAt: '2026-07-13T12:00:00.000Z',
            successes: 0,
            downloads: 0,
            failures: 3,
            classification: 'tried',
          },
        ],
      },
      newSubscriptions: {
        checked: 1,
        withValue: 0,
        zeroValueTried: 0,
        zeroValueNeverTried: 1,
        rows: [
          {
            userId: 5150,
            subscribedAt: '2026-07-13T00:00:00.000Z',
            successes: 0,
            downloads: 0,
            failures: 0,
            classification: 'never',
          },
        ],
      },
    });

    render(<PaidValueMonitorTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Check value' }));

    const passCell = await screen.findByText('4242');
    const passRow = passCell.closest('tr');
    expect(passRow).toHaveTextContent('24h');
    expect(passRow).toHaveTextContent('Tried, failed');

    const subRow = screen.getByText('5150').closest('tr');
    expect(subRow).toHaveTextContent('Never tried');
  });

  test('reports a clean check with no zero-value tables', async () => {
    mockFetch({
      ...baseResponse,
      passes: {
        checked: 5,
        withValue: 5,
        zeroValueTried: 0,
        zeroValueNeverTried: 0,
        rows: [],
      },
    });

    render(<PaidValueMonitorTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Check value' }));

    expect(await screen.findByText(/5 paid units checked/)).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Result' })
    ).not.toBeInTheDocument();
  });

  test('surfaces a failed request', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ message: 'Failed to load paid value monitor' }),
    });

    render(<PaidValueMonitorTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Check value' }));

    expect(
      await screen.findByText('Failed to load paid value monitor')
    ).toBeInTheDocument();
  });
});
