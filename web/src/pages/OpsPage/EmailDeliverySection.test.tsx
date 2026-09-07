import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import EmailDeliverySection from './EmailDeliverySection';
import { EmailDeliveryResponse } from './emailDeliveryTypes';

const renderSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailDeliverySection />
    </QueryClientProvider>
  );
};

const sampleResponse: EmailDeliveryResponse = {
  window: '30d',
  by_category: [
    {
      category: 'magic-link-login',
      delivered: 80,
      bounce: 15,
      dropped: 5,
      blocked: 0,
      deferred: 2,
      spamreport: 0,
      unsubscribe: 0,
      failure_rate: 20,
    },
    {
      category: 'deck-ready',
      delivered: 200,
      bounce: 1,
      dropped: 0,
      blocked: 0,
      deferred: 0,
      spamreport: 0,
      unsubscribe: 0,
      failure_rate: 0.5,
    },
  ],
};

describe('EmailDeliverySection', () => {
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

  test('renders per-template rows and badges categories over the failure threshold', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('magic-link-login')).toBeInTheDocument();
    });
    expect(screen.getByText('deck-ready')).toBeInTheDocument();
    expect(screen.getByText('20% failing')).toBeInTheDocument();
    expect(screen.queryByText('0.5% failing')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/ops/email-delivery?window=30d',
      expect.objectContaining({ credentials: 'include' })
    );
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
        screen.getByText(/\/api\/ops\/email-delivery failed/)
      ).toBeInTheDocument();
    });
  });
});
