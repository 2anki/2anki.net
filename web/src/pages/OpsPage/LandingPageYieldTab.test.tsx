import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import LandingPageYieldTab from './LandingPageYieldTab';
import { LandingPageYieldResponse } from './landingPageYieldTypes';
import { OpsWindow, OpsWindowContext } from './opsWindow';

const renderTab = (window: OpsWindow = '30d') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpsWindowContext.Provider value={window}>
        <LandingPageYieldTab />
      </OpsWindowContext.Provider>
    </QueryClientProvider>
  );
};

const mockFetch = (payload: LandingPageYieldResponse) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
};

describe('LandingPageYieldTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('renders a row per page with signups, conversions, and the paid rate', async () => {
    mockFetch({
      pages: [
        {
          origin: '/pdf-to-anki',
          signups: 12450,
          subscription_conversions: 300,
          pass_conversions: 90,
          paid_conversion_rate_pct: 3,
        },
      ],
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-06-30T00:00:00.000Z',
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('/pdf-to-anki')).toBeInTheDocument()
    );
    expect(screen.getByText('12 450')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getByText('3%')).toBeInTheDocument();
  });

  test('labels a null origin as Direct / unknown', async () => {
    mockFetch({
      pages: [
        {
          origin: null,
          signups: 100,
          subscription_conversions: 0,
          pass_conversions: 0,
          paid_conversion_rate_pct: 0,
        },
      ],
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-06-30T00:00:00.000Z',
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('Direct / unknown')).toBeInTheDocument()
    );
  });

  test('shows the empty state when there are no signups', async () => {
    mockFetch({
      pages: [],
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-06-30T00:00:00.000Z',
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('No signups in this window yet.')
      ).toBeInTheDocument()
    );
  });

  test('reads the shared ops window for its fetch', async () => {
    mockFetch({
      pages: [],
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-06-30T00:00:00.000Z',
    });

    renderTab('90d');

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/ops/growth/landing-page-yield?window=90d',
        expect.objectContaining({ credentials: 'include' })
      )
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  test('renders the server error message in the danger banner', async () => {
    mockFetch({
      pages: null,
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-06-30T00:00:00.000Z',
      error: 'relation "user_passes" does not exist',
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('relation "user_passes" does not exist')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText('No signups in this window yet.')).toBeNull();
  });
});
