import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../lib/i18n';
import { PlanDetails } from './PlanDetails';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const renderPlan = (subscriptionType: 'subscriber' | 'lifetime' | 'free') =>
  render(
    <QueryClientProvider client={queryClient}>
      <PlanDetails subscriptionType={subscriptionType} />
    </QueryClientProvider>
  );

describe('PlanDetails in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the free tier meta and link in German', () => {
    renderPlan('free');
    expect(screen.getByText('Kostenlos')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Tarife ansehen' })
    ).toBeInTheDocument();
  });

  it('keeps the Lifetime plan name and translates its meta', () => {
    renderPlan('lifetime');
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
    expect(
      screen.getByText('Alle aktuellen und künftigen Funktionen.')
    ).toBeInTheDocument();
  });
});
