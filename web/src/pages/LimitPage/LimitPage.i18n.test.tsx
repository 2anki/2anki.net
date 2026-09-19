import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';

import i18n from '../../lib/i18n';
import deAccountx from '../../lib/i18n/locales/de/accountx.json';
import { LimitPage } from './LimitPage';
import { useUserLocals } from '../../lib/hooks/useUserLocals';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({ startPassCheckout: vi.fn() })),
}));
vi.mock('../../lib/hooks/useUserLocals', () => ({ useUserLocals: vi.fn() }));
vi.mock('../../lib/backend/startUnlimitedUpgrade', () => ({
  startUnlimitedUpgrade: vi.fn(),
}));

function renderLimitPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LimitPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('LimitPage in German', () => {
  beforeEach(async () => {
    vi.mocked(useUserLocals).mockReturnValue({
      data: { user: { id: 1, email: 'reader@example.com' } },
      isLoading: false,
    } as ReturnType<typeof useUserLocals>);
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the limit headline in German with the monthly card limit', () => {
    renderLimitPage();

    const headline = deAccountx.limit.headline.replace('{{limit}}', '100');
    expect(headline).not.toBe('You reached 100 cards this month');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      headline
    );
  });
});
