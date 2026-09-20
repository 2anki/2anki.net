import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

import { HomePage } from './HomePage';

const trackMock = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

function renderHome(isLoggedIn = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage setErrorMessage={vi.fn()} isLoggedIn={isLoggedIn} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HomePage (anonymous)', () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it('fires landing_page_viewed once on mount', () => {
    renderHome();
    expect(
      trackMock.mock.calls.filter(([name]) => name === 'landing_page_viewed')
    ).toHaveLength(1);
  });

  it('does not also fire the separate AI badge impression on the landing page', () => {
    renderHome();
    expect(
      trackMock.mock.calls.filter(
        ([name]) => name === 'home_ai_anon_badge_viewed'
      )
    ).toHaveLength(0);
  });

  it('does not fire landing_page_viewed for a logged-in visitor', () => {
    renderHome(true);
    expect(trackMock).not.toHaveBeenCalledWith('landing_page_viewed');
  });

  it('renders the mascot as a brand mark', () => {
    renderHome();
    const mascot = document.querySelector('img[src*="mascot"]');
    expect(mascot).toBeInTheDocument();
  });

  it('renders the primary h1', () => {
    renderHome();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /flashcards that work in anki/i,
      })
    ).toBeInTheDocument();
  });

  it('renders the upload form drop zone', () => {
    renderHome();
    expect(screen.getByText(/drop your files here/i)).toBeInTheDocument();
  });

  it('keeps the hero focused on conversion — no free-tier limit or open-source brag in the hero', () => {
    renderHome();
    expect(screen.queryByText(/100 cards per month/i)).toBeNull();
    expect(screen.queryByText(/open source/i)).toBeNull();
  });

  it('leads the hero badge with clean-card output and keeps AI as a quiet opt-in', () => {
    renderHome();
    expect(
      screen.getByText(/Clean cards, ready to study/i)
    ).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: /create an account/i,
    });
    expect(link).toHaveAttribute('href', '/register?redirect=/card-options');
  });

  it('links to card options above the upload form so anon visitors can configure first', () => {
    renderHome();
    const link = screen.getByRole('link', { name: 'Card options' });
    expect(link).toHaveAttribute('href', '/card-options');
  });

  it('renders the three how-it-works steps with icons', () => {
    renderHome();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Convert')).toBeInTheDocument();
    expect(screen.getByText('Study')).toBeInTheDocument();
    const svgs = document.querySelectorAll('svg[viewBox="0 0 24 24"]');
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it('renders 3 walkthrough play buttons by default', () => {
    renderHome();
    const playButtons = screen.getAllByRole('button', { name: /play:/i });
    expect(playButtons.length).toBe(3);
  });

  it('renders all 10 walkthrough play buttons after clicking expand', () => {
    renderHome();
    const expandButton = screen.getByRole('button', {
      name: /show all 10 videos/i,
    });
    fireEvent.click(expandButton);
    const playButtons = screen.getAllByRole('button', { name: /play:/i });
    expect(playButtons.length).toBe(10);
  });
});
