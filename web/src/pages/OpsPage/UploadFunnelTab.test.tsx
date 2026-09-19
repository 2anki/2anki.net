import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import UploadFunnelTab, { formatCount, formatRate } from './UploadFunnelTab';
import { UploadFunnelResponse } from './uploadFunnelTypes';
import { OpsWindow, OpsWindowContext } from './opsWindow';

const renderTab = (window: OpsWindow = '30d') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpsWindowContext.Provider value={window}>
        <UploadFunnelTab />
      </OpsWindowContext.Provider>
    </QueryClientProvider>
  );
};

const THIN_SPACE = '\u2009';

const spaceNormalizer = (text: string) =>
  text.replace(/[\u2009\u202f]/g, ' ').trim();

const mockFetch = (payload: UploadFunnelResponse) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
};

describe('formatCount', () => {
  test('renders counts under 10 000 without a separator', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(9999)).toBe('9999');
  });

  test('uses a thin space, not a comma, at and above 10 000', () => {
    expect(formatCount(10000)).toBe(`10${THIN_SPACE}000`);
    expect(formatCount(1200000)).toBe(`1${THIN_SPACE}200${THIN_SPACE}000`);
    expect(formatCount(1200000)).not.toContain(',');
  });
});

describe('formatRate', () => {
  test('renders one decimal with a percent sign', () => {
    expect(formatRate(42.7)).toBe('42.7%');
    expect(formatRate(0)).toBe('0.0%');
  });
});

describe('UploadFunnelTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('renders the four stage counts and the rate hero', async () => {
    mockFetch({
      stages: {
        upload_started: 12450,
        conversion_succeeded: 11200,
        conversion_failed: 320,
        deck_downloaded: 10300,
        paywall_shown: 4200,
        signup: 3100,
        paid: 620,
      },
      by_origin: [
        {
          origin: '/nclex',
          stages: {
            upload_started: 8000,
            conversion_succeeded: 7200,
            conversion_failed: 200,
            deck_downloaded: 6600,
            paywall_shown: 2800,
            signup: 2100,
            paid: 480,
          },
          upload_to_download_rate_pct: 82.5,
          download_to_signup_rate_pct: 31.8,
          download_to_paid_rate_pct: 7.3,
        },
      ],
      upload_to_download_rate_pct: 57.83,
      download_to_signup_rate_pct: 30.1,
      download_to_paid_rate_pct: 6.02,
      signup_reliable: true,
      since: '2026-05-01T00:00:00.000Z',
      as_of: '2026-05-30T00:00:00.000Z',
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('12 450', { normalizer: spaceNormalizer })
      ).toBeInTheDocument()
    );

    expect(screen.queryByText(/Signup tracking under-fired/i)).toBeNull();

    expect(screen.getByText('/nclex')).toBeInTheDocument();
    expect(screen.getByText('82.5%')).toBeInTheDocument();
    expect(
      screen.getByText('11 200', { normalizer: spaceNormalizer })
    ).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(
      screen.getByText('10 300', { normalizer: spaceNormalizer })
    ).toBeInTheDocument();
    expect(
      screen.getByText('4200', { normalizer: spaceNormalizer })
    ).toBeInTheDocument();
    expect(
      screen.getByText('3100', { normalizer: spaceNormalizer })
    ).toBeInTheDocument();
    expect(screen.getByText('620')).toBeInTheDocument();

    expect(screen.getByText('Paywall shown')).toBeInTheDocument();
    expect(screen.getByText('Signup')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Conversion failed')).toBeInTheDocument();

    expect(screen.getByText('Upload to download')).toBeInTheDocument();
    expect(screen.getByText('57.8%')).toBeInTheDocument();
    expect(screen.getByText('Download to signup')).toBeInTheDocument();
    expect(screen.getByText('30.1%')).toBeInTheDocument();
    expect(screen.getByText('Download to paid')).toBeInTheDocument();
    expect(screen.getByText('6.0%')).toBeInTheDocument();
  });

  test('shows the zero state and an honest 0% rate when there are no uploads', async () => {
    mockFetch({
      stages: {
        upload_started: 0,
        conversion_succeeded: 0,
        conversion_failed: 0,
        deck_downloaded: 0,
        paywall_shown: 0,
        signup: 0,
        paid: 0,
      },
      by_origin: [],
      upload_to_download_rate_pct: 0,
      download_to_signup_rate_pct: 0,
      download_to_paid_rate_pct: 0,
      signup_reliable: true,
      since: '2026-05-01T00:00:00.000Z',
      as_of: '2026-05-30T00:00:00.000Z',
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('No uploads in this window')).toBeInTheDocument()
    );
    expect(screen.getAllByText('No downloads in this window')).toHaveLength(2);
    expect(screen.getAllByText('0.0%')).toHaveLength(3);
  });

  test('reads the shared ops window for its fetch', async () => {
    mockFetch({
      stages: null,
      by_origin: [],
      upload_to_download_rate_pct: 0,
      download_to_signup_rate_pct: 0,
      download_to_paid_rate_pct: 0,
      signup_reliable: true,
      since: '2026-05-01T00:00:00.000Z',
      as_of: '2026-05-30T00:00:00.000Z',
    });

    renderTab('7d');

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/ops/upload-funnel?window=7d',
        expect.objectContaining({ credentials: 'include' })
      )
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  test('renders the server error message in the danger banner', async () => {
    mockFetch({
      stages: null,
      by_origin: [],
      upload_to_download_rate_pct: 0,
      download_to_signup_rate_pct: 0,
      download_to_paid_rate_pct: 0,
      signup_reliable: true,
      since: '2026-05-01T00:00:00.000Z',
      as_of: '2026-05-30T00:00:00.000Z',
      error: 'relation "events" does not exist',
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('relation "events" does not exist')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText('No uploads in this window')).toBeNull();
  });

  test('flags signup as unreliable for windows before the 2026-09-09 cutoff', async () => {
    mockFetch({
      stages: {
        upload_started: 100,
        conversion_succeeded: 80,
        conversion_failed: 5,
        deck_downloaded: 60,
        paywall_shown: 20,
        signup: 4,
        paid: 6,
      },
      by_origin: [
        {
          origin: '/nclex',
          stages: {
            upload_started: 60,
            conversion_succeeded: 50,
            conversion_failed: 3,
            deck_downloaded: 40,
            paywall_shown: 12,
            signup: 3,
            paid: 4,
          },
          upload_to_download_rate_pct: 66.7,
          download_to_signup_rate_pct: 7.5,
          download_to_paid_rate_pct: 10,
        },
      ],
      upload_to_download_rate_pct: 60,
      download_to_signup_rate_pct: 6.7,
      download_to_paid_rate_pct: 10,
      signup_reliable: false,
      since: '2026-08-20T00:00:00.000Z',
      as_of: '2026-09-19T00:00:00.000Z',
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText(/Signup tracking under-fired before 2026-09-09/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/earlier windows undercount/i)).toBeInTheDocument();

    const signupTile = screen.getByText('Signup').closest('div');
    expect(signupTile).not.toBeNull();
    expect(
      within(signupTile as HTMLElement).getByText('—')
    ).toBeInTheDocument();

    const originRow = screen.getByText('/nclex').closest('tr');
    expect(originRow).not.toBeNull();
    expect(within(originRow as HTMLElement).getByText('—')).toBeInTheDocument();

    expect(screen.queryByText('6.7%')).toBeNull();
  });
});
