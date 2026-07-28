import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ConversionsTab from './ConversionsTab';
import { ConversionMetricsResponse } from './conversionTypes';

const renderTab = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConversionsTab />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const buildSampleMetrics = (
  overrides: Partial<ConversionMetricsResponse> = {}
): ConversionMetricsResponse => ({
  free_conversions_7d: 824,
  paid_conversions_7d: 137,
  free_conversion_success_rate_7d: 91.4,
  paid_conversion_success_rate_7d: 96.2,
  free_blocked_by_plan_7d: 63,
  paid_blocked_by_plan_7d: 0,
  conversion_errors_7d_top_reasons: [
    { reason: 'Notion timeout', count: 12 },
    { reason: 'Parser crash', count: 5 },
  ],
  failed_conversions_weekly: Array.from({ length: 12 }).map((_, i) => ({
    week: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    count: i % 4,
  })),
  time_to_first_deck_median_minutes_30d: 42,
  upload_to_download_rate_7d: 25.4,
  deck_quality_cohorts_30d: null,
  ...overrides,
});

describe('ConversionsTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('renders volume and success-rate cards from the response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('824')).toBeInTheDocument());
    expect(screen.getByText('Free conversions')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();
    expect(screen.getByText('Paid conversions')).toBeInTheDocument();
    expect(screen.getByText('91.4%')).toBeInTheDocument();
    expect(screen.getByText('Free success rate')).toBeInTheDocument();
    expect(screen.getByText('96.2%')).toBeInTheDocument();
    expect(screen.getByText('Paid success rate')).toBeInTheDocument();
    expect(screen.getByText('63')).toBeInTheDocument();
    expect(screen.getByText('Free blocked by plan')).toBeInTheDocument();
    expect(screen.getByText('Paid blocked by plan')).toBeInTheDocument();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/conversion/metrics',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('renders the funnel cards from the response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('42 min')).toBeInTheDocument());
    expect(screen.getByText('Time to first deck')).toBeInTheDocument();
    expect(
      screen.getByText('Median, accounts created in the last 30 days')
    ).toBeInTheDocument();
    expect(screen.getByText('Upload → download rate')).toBeInTheDocument();
    expect(screen.getByText('25.4%')).toBeInTheDocument();
    expect(
      screen.getByText('Distinct visitors, last 7 days')
    ).toBeInTheDocument();
  });

  test('formats a multi-hour median in hours', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () =>
        buildSampleMetrics({ time_to_first_deck_median_minutes_30d: 150 }),
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('2.5 h')).toBeInTheDocument());
  });

  test('renders em-dash for null funnel metrics', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () =>
        buildSampleMetrics({
          time_to_first_deck_median_minutes_30d: null,
          upload_to_download_rate_7d: null,
        }),
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('824')).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  test('renders failure panel titles', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('Top failure reasons, last 7 days')
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText('Failed conversions, last 12 weeks')
    ).toBeInTheDocument();
  });

  test('shows ChartPanel empty state when failure arrays are empty', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () =>
        buildSampleMetrics({
          conversion_errors_7d_top_reasons: [],
          failed_conversions_weekly: [],
        }),
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getAllByText('No failed conversions in this window.').length
      ).toBeGreaterThan(0)
    );
  });

  test('renders em-dash for null metric values', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () =>
        buildSampleMetrics({
          free_conversion_success_rate_7d: null,
          paid_conversion_success_rate_7d: null,
        }),
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('824')).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  test('shows the alert banner when the request fails', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText(/\/api\/ops\/conversion\/metrics failed/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/Last good data shown below/i)).toBeInTheDocument();
  });
});
