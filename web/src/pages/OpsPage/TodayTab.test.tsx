import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import TodayTab from './TodayTab';
import { ScoreRow, TodaySnapshotResponse } from './todayTypes';

const mockListContactMessages = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    listContactMessages: mockListContactMessages,
  }),
}));

const row = (overrides: Partial<ScoreRow>): ScoreRow => ({
  id: 'row',
  lever: 'revenue',
  label: 'Row',
  format: 'count',
  window_label: '7d',
  value: 1,
  delta: null,
  delta_good: null,
  target: null,
  target_direction: null,
  status: 'none',
  link: '/ops/business',
  ...overrides,
});

const snapshot = (
  rows: ScoreRow[],
  overrides: Partial<TodaySnapshotResponse> = {}
): TodaySnapshotResponse => ({
  rows,
  as_of: '2026-09-09T10:00:00.000Z',
  cache_age_seconds: 0,
  stale: false,
  errors: [],
  ...overrides,
});

const business = {
  mrr_usd: 1823,
  net_new_mrr_mtd_usd: 40,
  active_paying_subs: 759,
  churn_30d_pct: 9.1,
  failed_payments_7d: 3,
  new_paid_conversions_7d: 16,
  pass_sales_7d: { day_passes: 4, week_passes: 1 },
  mrr_timeseries: null,
  active_subs_timeseries: null,
  conversions_vs_churn_weekly: null,
  failed_payments_weekly: null,
  cancellation_reasons_top: null,
  cancellation_comments_recent: [
    {
      created_at: '2026-09-08T00:00:00Z',
      reason: 'too_expensive',
      comment: 'loved it but rent',
    },
  ],
  emoji_feedback_ratings: null,
  emoji_feedback_comments: null,
  reengagement_reasons_top: null,
  reengagement_comments_recent: null,
  signup_countries_90d: null,
  as_of: '2026-09-09T00:00:00Z',
  cache_age_seconds: 5,
};

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
});

const installFetch = (today: TodaySnapshotResponse | Error) => {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/ops/today')) {
      if (today instanceof Error) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ message: today.message }),
        });
      }
      return Promise.resolve(jsonResponse(today));
    }
    if (url.includes('/api/ops/business/metrics')) {
      return Promise.resolve(jsonResponse(business));
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
};

const renderTab = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TodayTab />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('TodayTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockListContactMessages.mockResolvedValue([
      {
        id: 1,
        name: 'A user',
        email: 'user@example.com',
        message: 'Cards stopped syncing after I renamed the page',
        created_at: '2026-09-08T00:00:00Z',
        is_acknowledged: false,
        attachments: [],
      },
    ]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('renders the scoreboard sorted with attention rows first and a divider', async () => {
    installFetch(
      snapshot([
        row({
          id: 'new_paid_7d',
          label: 'New paid',
          value: 15,
          target: 70,
          target_direction: 'at_least',
          status: 'red',
        }),
        row({
          id: 'conversion_success_7d_pct',
          label: 'Conversion success',
          format: 'percent',
          value: 88,
          target: 90,
          target_direction: 'at_least',
          status: 'amber',
          link: '/ops/growth',
        }),
        row({
          id: 'pass_sales_7d',
          label: 'Pass sales',
          value: 23,
          target: 23,
          target_direction: 'at_least',
          status: 'green',
        }),
      ])
    );

    renderTab();

    expect(await screen.findByText('2 need attention')).toBeInTheDocument();
    expect(screen.getByText('≥70')).toBeInTheDocument();
    expect(screen.getByText('88.0%')).toBeInTheDocument();
    expect(screen.getByText('≥90.0%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New paid/ })).toHaveAttribute(
      'href',
      '/ops/business'
    );
    expect(
      screen.getByRole('link', { name: /Conversion success/ })
    ).toHaveAttribute('href', '/ops/growth');

    const rows = screen
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-status'));
    expect(rows.map((li) => li.getAttribute('data-status'))).toEqual([
      'red',
      'amber',
      'green',
    ]);
    expect(
      screen.getAllByRole('button', { name: /Copy for Claude/ })
    ).toHaveLength(2);
  });

  test('says nothing needs you when every row is green', async () => {
    installFetch(
      snapshot([
        row({ id: 'pass_sales_7d', label: 'Pass sales', status: 'green' }),
      ])
    );

    renderTab();

    expect(
      await screen.findByText('Nothing needs you today.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Copy for Claude/ })
    ).toBeNull();
  });

  test('marks a stale snapshot and lists a failed source', async () => {
    installFetch(
      snapshot([row({ id: 'pass_sales_7d', label: 'Pass sales' })], {
        stale: true,
        errors: [{ source: 'pass_unlock', message: 'stripe timeout' }],
      })
    );

    renderTab();

    expect(await screen.findByText(/stale/)).toBeInTheDocument();
    expect(
      screen.getByText('pass_unlock unavailable: stripe timeout')
    ).toBeInTheDocument();
  });

  test('shows the snapshot error banner when the endpoint fails', async () => {
    installFetch(new Error('Failed to load the today snapshot'));

    renderTab();

    expect(
      await screen.findByText(
        '/api/ops/today failed: Failed to load the today snapshot'
      )
    ).toBeInTheDocument();
  });

  test('previews unread messages and cancellation comments in voice of user', async () => {
    installFetch(snapshot([]));

    renderTab();

    expect(
      await screen.findByText('Cards stopped syncing after I renamed the page')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Cancelled — too_expensive: loved it but rent')
    ).toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toHaveAttribute(
      'href',
      '/ops/messages'
    );
  });
});
