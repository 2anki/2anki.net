import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import BusinessTab from './BusinessTab';
import { BusinessMetricsResponse } from './businessTypes';

const openAllSections = () => {
  for (const details of document.querySelectorAll('details')) {
    details.open = true;
    fireEvent(details, new Event('toggle'));
  }
};

const renderTab = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BusinessTab />
      </MemoryRouter>
    </QueryClientProvider>
  );
  openAllSections();
  return result;
};

const buildSampleMetrics = (
  overrides: Partial<BusinessMetricsResponse> = {}
): BusinessMetricsResponse => ({
  mrr_usd: 4820,
  net_new_mrr_mtd_usd: 312,
  active_paying_subs: 184,
  churn_30d_pct: 2.1,
  failed_payments_7d: 4,
  new_paid_conversions_7d: 11,
  pass_sales_7d: null,
  mrr_timeseries: Array.from({ length: 90 }).map((_, i) => ({
    t: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    mrr_usd: 1000 + i * 10,
  })),
  active_subs_timeseries: Array.from({ length: 90 }).map((_, i) => ({
    t: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    active_paying_subs: 50 + i,
  })),
  conversions_vs_churn_weekly: Array.from({ length: 12 }).map((_, i) => ({
    week: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    new_paying: 5 + i,
    churned: 1 + (i % 3),
  })),
  failed_payments_weekly: Array.from({ length: 12 }).map((_, i) => ({
    week: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    count: i % 4,
  })),
  cancellation_reasons_top: [
    { reason: 'Too expensive', count: 7 },
    { reason: "I don't use it enough", count: 4 },
    { reason: 'Other', count: 1 },
  ],
  cancellation_comments_recent: [
    {
      reason: 'Other',
      comment: 'I missed Anki shared decks',
      created_at: '2026-05-08T11:00:00.000Z',
    },
  ],
  emoji_feedback_ratings: [
    { rating: 4, count: 5 },
    { rating: 5, count: 3 },
  ],
  emoji_feedback_comments: [
    {
      rating: 5,
      comment: 'Love it!',
      page: '/upload',
      created_at: '2026-05-08T12:00:00.000Z',
    },
  ],
  reengagement_reasons_top: [
    { stopped_reason: 'Switched to another tool', count: 6 },
    { stopped_reason: 'No longer studying', count: 3 },
  ],
  reengagement_comments_recent: [
    {
      stopped_reason: 'Switched to another tool',
      content_type: 'pdf',
      comment: 'I moved to RemNote',
      created_at: '2026-05-07T09:00:00.000Z',
    },
  ],
  signup_countries_90d: [
    { country: 'NO', count: 240 },
    { country: 'DE', count: 180 },
    { country: 'US', count: 95 },
  ],
  as_of: '2026-05-09T14:32:07.000Z',
  cache_age_seconds: 412,
  ...overrides,
});

describe('BusinessTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('lists every business section collapsed until opened, including the paid access checks', () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BusinessTab />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(document.querySelectorAll('details')).toHaveLength(7);
    expect(document.querySelectorAll('details[open]')).toHaveLength(0);
    expect(screen.getByText('Pass unlocks')).toBeInTheDocument();
    expect(screen.getByText('Paid value')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check passes' })).toBeNull();
  });

  test('renders all six big-number cards from the response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('$4,820')).toBeInTheDocument());
    expect(screen.getByText('MRR')).toBeInTheDocument();
    expect(screen.getByText('$312')).toBeInTheDocument();
    expect(screen.getByText('Net new MRR (MTD)')).toBeInTheDocument();
    expect(screen.getByText('184')).toBeInTheDocument();
    expect(screen.getByText('Active paying subs')).toBeInTheDocument();
    expect(screen.getByText('2.1%')).toBeInTheDocument();
    expect(screen.getByText('Churn (30d)')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Failed payments (7d)')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('New paid conversions (7d)')).toBeInTheDocument();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/business/metrics',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('renders all chart panel titles', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('MRR, last 90 days')).toBeInTheDocument()
    );
    expect(
      screen.getByText('Active paying subs, last 90 days')
    ).toBeInTheDocument();
    expect(
      screen.getByText('New vs churned, last 12 weeks')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Failed payments, last 12 weeks')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Why users cancel, last 90 days')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Recent cancellation comments')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Why people stop, last 90 days')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Recent re-engagement comments')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Signups by country, last 90 days')
    ).toBeInTheDocument();
  });

  test('shows ChartPanel empty state when time-series arrays are empty', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () =>
        buildSampleMetrics({
          mrr_timeseries: [],
          active_subs_timeseries: [],
          conversions_vs_churn_weekly: [],
          failed_payments_weekly: [],
          cancellation_reasons_top: [],
          cancellation_comments_recent: [],
          reengagement_reasons_top: [],
          reengagement_comments_recent: [],
          signup_countries_90d: [],
        }),
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('No MRR history yet.')).toBeInTheDocument()
    );
    expect(screen.getByText('No active-subs history yet.')).toBeInTheDocument();
    expect(
      screen.getByText('No subscription movements yet.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No failed payments in this window.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No cancellations recorded yet.')
    ).toBeInTheDocument();
    expect(screen.getByText('No free-text comments yet.')).toBeInTheDocument();
    expect(
      screen.getByText('No re-engagement feedback recorded yet.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No re-engagement comments yet.')
    ).toBeInTheDocument();
    expect(screen.getByText('No countries captured yet.')).toBeInTheDocument();
  });

  test('renders cancellation comment text from the response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('I missed Anki shared decks')).toBeInTheDocument()
    );
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
        screen.getByText(/\/api\/ops\/business\/metrics failed/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/Last good data shown below/i)).toBeInTheDocument();
  });

  test('shows a subtle refreshing hint during background refetch (not the red banner)', async () => {
    let resolveSecondFetch!: () => void;
    const secondFetchPromise = new Promise<void>((r) => {
      resolveSecondFetch = r;
    });
    let businessCallCount = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (typeof url === 'string' && url.includes('/api/ops/today')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              rows: [],
              as_of: '',
              cache_age_seconds: 0,
              stale: false,
              errors: [],
            }),
          };
        }
        if (typeof url === 'string' && url.includes('cancel-funnel')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              stages: null,
              save_rate_pct: 0,
              offer_reach_pct: 0,
              since: '',
              as_of: '',
            }),
          };
        }
        const idx = businessCallCount++;
        if (idx === 1) {
          await secondFetchPromise;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => buildSampleMetrics({ cache_age_seconds: 600 }),
        };
      }
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BusinessTab />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('$4,820')).toBeInTheDocument());
    expect(screen.queryByText(/refreshing/i)).toBeNull();

    queryClient.invalidateQueries({ queryKey: ['ops-business-metrics'] });

    await waitFor(() =>
      expect(screen.getByText(/refreshing/i)).toBeInTheDocument()
    );
    expect(
      screen.queryByText(/\/api\/ops\/business\/metrics failed/i)
    ).toBeNull();

    resolveSecondFetch();
    await waitFor(() => expect(screen.queryByText(/refreshing/i)).toBeNull());
  });

  test('Copy for Claude Code button is disabled while loading, enabled with data', async () => {
    let resolveFetch!: (value: unknown) => void;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    renderTab();

    const button = screen.getByRole('button', {
      name: 'Copy for Claude Code',
    });
    expect(button).toBeDisabled();

    resolveFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    await waitFor(() => expect(button).toBeEnabled());
  });

  test('renders no <pre> JSON dump anywhere', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => buildSampleMetrics(),
    });

    const { container } = renderTab();

    await waitFor(() => expect(screen.getByText('$4,820')).toBeInTheDocument());
    expect(container.querySelector('pre')).toBeNull();
  });
});
