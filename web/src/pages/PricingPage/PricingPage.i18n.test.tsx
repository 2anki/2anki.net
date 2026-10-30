import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import PricingPage from './PricingPage';

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    startPassCheckout: vi.fn(),
    startUnlimitedCheckout: vi.fn(),
    getCheckoutPrices: vi.fn().mockResolvedValue(null),
    getAutoSyncPrice: vi
      .fn()
      .mockResolvedValue({ display: '$30', interval: 'month' }),
  }),
}));

vi.mock('../../components/TopMessage/TopMessage', () => ({
  default: () => null,
}));

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../lib/hooks/useCardUsage', () => ({
  useCardUsage: () => null,
}));

vi.mock('../../lib/hooks/usePricingOrderVariant', () => ({
  usePricingOrderVariant: () => 'unlimited-first',
}));

function renderPricing() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pricing']}>
        <PricingPage isLoggedIn={false} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PricingPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the pricing title in German', () => {
    renderPricing();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Preise' })
    ).toBeInTheDocument();
  });

  it('translates the pay-once section label', () => {
    renderPricing();
    expect(screen.getByText('Einmal zahlen — kein Abo')).toBeInTheDocument();
  });

  it('translates the Day Pass action while keeping the plan name', () => {
    renderPricing();
    expect(
      screen.getByRole('button', { name: /^Day Pass holen · / })
    ).toBeInTheDocument();
  });

  it('translates the feature overview heading', () => {
    renderPricing();
    expect(
      screen.getByRole('heading', { name: 'Alles, was 2anki kann' })
    ).toBeInTheDocument();
  });

  it('translates the Auto Sync card', async () => {
    renderPricing();
    expect(await screen.findByText('Sync aus Notion')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Auto Sync holen' })
    ).toBeInTheDocument();
  });
});
