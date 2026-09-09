import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import GrowthTab from './GrowthTab';

const renderTab = (path = '/ops/growth') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <GrowthTab />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('GrowthTab', () => {
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

  test('lists every growth section collapsed, with only the summaries mounted', () => {
    renderTab();

    for (const title of [
      'Conversions',
      'Upload funnel',
      'Landing page yield',
      'Customer signals',
      'Return rate',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('details')).toHaveLength(5);
    expect(document.querySelectorAll('details[open]')).toHaveLength(0);
    expect(screen.queryByText('Upload to download')).toBeNull();
  });

  test('opens only the section named in the hash', () => {
    renderTab('/ops/growth#return-rate');
    expect(document.querySelectorAll('details[open]')).toHaveLength(1);
    expect(document.querySelector('details[open]')).toHaveAttribute(
      'id',
      'return-rate'
    );
  });
});
