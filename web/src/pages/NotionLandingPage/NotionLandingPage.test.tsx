import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotionLandingPage } from './NotionLandingPage';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

import { track } from '../../lib/analytics/track';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HelmetProvider>
          <NotionLandingPage />
        </HelmetProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotionLandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the hero headline', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Your Notion notes become Anki cards'
    );
  });

  it('features the Unlimited plan card without a hardcoded monthly price', () => {
    renderPage();
    expect(screen.getByText('Unlimited')).toBeInTheDocument();
    expect(screen.getByText('See pricing')).toBeInTheDocument();
    const unlimitedCard = screen
      .getByRole('heading', { name: 'Unlimited' })
      .closest('div')?.parentElement;
    if (unlimitedCard == null) throw new Error('Unlimited card not found');
    expect(within(unlimitedCard).queryByText(/\$\d/)).toBeNull();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('renders the Day Pass plan card as the secondary option', () => {
    renderPage();
    expect(screen.getByText('Day Pass')).toBeInTheDocument();
    expect(screen.getByText('$6')).toBeInTheDocument();
  });

  it('does not advertise the Auto Sync plan', () => {
    renderPage();
    expect(screen.queryByText('Auto Sync')).not.toBeInTheDocument();
    expect(screen.queryByText('$30')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /get auto sync/i })
    ).not.toBeInTheDocument();
  });

  it('includes ?ref=notion-marketplace in the Connect Notion CTA href', () => {
    renderPage();
    const connectLink = screen.getByRole('link', { name: /connect notion/i });
    expect(connectLink.getAttribute('href')).toContain(
      'ref=notion-marketplace'
    );
  });

  it('includes ?ref=notion-marketplace in the Unlimited CTA href', () => {
    renderPage();
    const unlimitedLink = screen.getByRole('link', { name: /get unlimited/i });
    expect(unlimitedLink.getAttribute('href')).toContain(
      'ref=notion-marketplace'
    );
  });

  it('includes ?ref=notion-marketplace in the Day Pass CTA href', () => {
    renderPage();
    const dayPassLink = screen.getByRole('link', { name: /get day pass/i });
    expect(dayPassLink.getAttribute('href')).toContain(
      'ref=notion-marketplace'
    );
  });

  it('fires paywall_shown with surface notion-marketplace on mount', () => {
    renderPage();
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      surface: 'notion-marketplace',
    });
  });
});
