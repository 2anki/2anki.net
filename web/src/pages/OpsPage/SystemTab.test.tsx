import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import SystemTab from './SystemTab';

const renderTab = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SystemTab />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('SystemTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('lists every system section collapsed', () => {
    renderTab();

    for (const title of [
      'Engineering',
      'Performance',
      'AI usage',
      'Email delivery',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('details')).toHaveLength(4);
    expect(document.querySelectorAll('details[open]')).toHaveLength(0);
  });
});
