import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ReturnRateTab from './ReturnRateTab';
import { ReturnRateMetricsResponse } from './returnRateTypes';

const renderTab = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReturnRateTab />
    </QueryClientProvider>
  );
};

const mockFetch = (payload: ReturnRateMetricsResponse) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
};

const payload: ReturnRateMetricsResponse = {
  overall: { '7d': 12.5, '14d': 18, '30d': null },
  eligible: { '7d': 240, '14d': 150, '30d': 0 },
  by_source_type: [
    {
      source_type: 'notion',
      cohort_size: 300,
      eligible_7d: 200,
      eligible_14d: 120,
      eligible_30d: 0,
      returned_7d: 30,
      returned_14d: 24,
      returned_30d: 0,
      return_rate_7d_pct: 15,
      return_rate_14d_pct: 20,
      return_rate_30d_pct: null,
    },
  ],
  as_of: '2026-09-20T00:00:00.000Z',
};

describe('ReturnRateTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('states the definition: a return is a day or more later, and only old enough identities count', async () => {
    mockFetch(payload);

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText(/at least 24 hours after the first/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText(/only identities old enough for the whole window/i)
    ).toBeInTheDocument();
  });

  test('shows how many identities each overall rate is measured over', async () => {
    mockFetch(payload);

    renderTab();

    await waitFor(() => expect(screen.getByText('12.5%')).toBeInTheDocument());
    expect(screen.getByText(/of 240 new identities/i)).toBeInTheDocument();
    expect(screen.getByText(/of 150 new identities/i)).toBeInTheDocument();
  });

  test('shows a dash and no denominator for a window nobody has finished yet', async () => {
    mockFetch(payload);

    renderTab();

    const card = await screen.findByText('Returned within 30 days');
    const cardBody = card.closest('section') as HTMLElement;
    expect(
      await within(cardBody).findByText(/none old enough yet/i)
    ).toBeInTheDocument();
    expect(within(cardBody).getByText('—')).toBeInTheDocument();
  });

  test('does not claim nobody is old enough when the query failed', async () => {
    mockFetch({
      overall: { '7d': null, '14d': null, '30d': null },
      eligible: { '7d': 0, '14d': 0, '30d': 0 },
      by_source_type: null,
      as_of: '2026-09-20T00:00:00.000Z',
      error: 'canceling statement due to statement timeout',
    });

    renderTab();

    expect(
      await screen.findByText(/Return-rate query failed on the server/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/none old enough yet/i)).toBeNull();
  });

  test('puts the eligible count beside each source rate', async () => {
    mockFetch(payload);

    renderTab();

    const row = (await screen.findByText('notion')).closest(
      'tr'
    ) as HTMLElement;
    expect(within(row).getByText('15.0% (200)')).toBeInTheDocument();
    expect(within(row).getByText('20.0% (120)')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
  });
});
