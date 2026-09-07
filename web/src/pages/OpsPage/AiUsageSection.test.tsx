import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import AiUsageSection from './AiUsageSection';
import { AiUsageResponse } from './aiUsageTypes';

const renderSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiUsageSection />
    </QueryClientProvider>
  );
};

const sampleResponse: AiUsageResponse = {
  window: '30d',
  totals: {
    calls: 128,
    cost_usd: 42.1234,
    input_tokens: 5_000_000,
    output_tokens: 1_200_000,
    cache_creation_tokens: 300_000,
    cache_read_tokens: 900_000,
  },
  by_surface: [
    {
      key: 'chat',
      calls: 90,
      cost_usd: 30.5,
      input_tokens: 4_000_000,
      output_tokens: 900_000,
      cache_creation_tokens: 200_000,
      cache_read_tokens: 700_000,
    },
  ],
  by_model: [
    {
      key: 'claude-sonnet-5',
      calls: 128,
      cost_usd: 42.1234,
      input_tokens: 5_000_000,
      output_tokens: 1_200_000,
      cache_creation_tokens: 300_000,
      cache_read_tokens: 900_000,
    },
  ],
  by_day: [],
  by_user: [
    {
      key: '18996',
      calls: 174,
      cost_usd: 53.12,
      input_tokens: 3_000_000,
      output_tokens: 800_000,
      cache_creation_tokens: 100_000,
      cache_read_tokens: 500_000,
    },
    {
      key: '20676',
      calls: 7,
      cost_usd: 2.31,
      input_tokens: 100_000,
      output_tokens: 20_000,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
  ],
};

describe('AiUsageSection', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => sampleResponse,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders total spend with surface and model breakdowns', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getAllByText('$42.12').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('128 calls')).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/ops/ai-usage?window=30d',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('renders the per-user table and badges spenders over the alert threshold', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('18996')).toBeInTheDocument();
    });
    expect(screen.getByText('20676')).toBeInTheDocument();
    expect(screen.getByText('$53.12')).toBeInTheDocument();
    expect(screen.getAllByText('over $25')).toHaveLength(1);
  });

  test('shows an error banner when the endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
    );

    renderSection();

    await waitFor(() => {
      expect(
        screen.getByText(/\/api\/ops\/ai-usage failed/)
      ).toBeInTheDocument();
    });
  });
});
