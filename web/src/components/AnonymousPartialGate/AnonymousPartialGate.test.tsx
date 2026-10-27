import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnonymousPartialGate } from './AnonymousPartialGate';
import { track } from '../../lib/analytics/track';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

function renderGate(
  held = { cardCount: 21, cardsHeldBack: 13, totalCards: 34 }
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AnonymousPartialGate held={held} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AnonymousPartialGate', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('promises the whole file when it fits a free month', () => {
    renderGate({ cardCount: 21, cardsHeldBack: 13, totalCards: 34 });
    expect(screen.getByText('All 34 cards are ready')).toBeInTheDocument();
    expect(screen.getByText(/100 cards a month/)).toBeInTheDocument();
    expect(screen.queryByText(/This file made/)).not.toBeInTheDocument();
  });

  it('promises the whole file at exactly the free monthly limit', () => {
    renderGate({ cardCount: 21, cardsHeldBack: 79, totalCards: 100 });
    expect(screen.getByText('All 100 cards are ready')).toBeInTheDocument();
    expect(screen.queryByText(/This file made/)).not.toBeInTheDocument();
  });

  it('promises the first 100 and names the total when the file is over a month', () => {
    renderGate({ cardCount: 21, cardsHeldBack: 100, totalCards: 121 });
    expect(
      screen.getByText('Your first 100 cards are ready')
    ).toBeInTheDocument();
    expect(screen.getByText('This file made 121 cards.')).toBeInTheDocument();
  });

  it('offers a Day Pass below the sign-up form for the whole file', () => {
    renderGate();
    expect(
      screen.getByText(/drop the file again to get all 34 cards/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get a Day Pass for $6' })
    ).toBeInTheDocument();
  });

  it('labels the region for assistive tech', () => {
    renderGate();
    expect(
      screen.getByRole('region', {
        name: 'Create a free account to download your deck',
      })
    ).toBeInTheDocument();
  });

  it('renders the inline register form with its email field', () => {
    renderGate();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('renders no form element so it can sit inside the upload form', () => {
    const { container } = renderGate();
    expect(container.querySelector('form')).toBeNull();
  });

  it('does not fire signup_started on mount from the inline form', () => {
    renderGate();
    expect(track).not.toHaveBeenCalledWith('signup_started', {
      method: 'email',
    });
  });

  it('fires the gate-shown event once with the held-back count', () => {
    renderGate();
    expect(track).toHaveBeenCalledWith('anonymous_partial_gate_shown', {
      cards_held_back: 13,
    });
    expect(
      vi
        .mocked(track)
        .mock.calls.filter(([name]) => name === 'anonymous_partial_gate_shown')
    ).toHaveLength(1);
  });

  describe('lead with the Day Pass over a free month', () => {
    const overMonthHeld = {
      cardCount: 21,
      cardsHeldBack: 100,
      totalCards: 121,
      dayPassCard: true,
    };

    it('shows the whole-deck headline instead of the capped one', () => {
      renderGate(overMonthHeld);
      expect(
        screen.getByText('Your deck is ready — 121 cards')
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Your first 100 cards are ready')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('This file made 121 cards.')
      ).not.toBeInTheDocument();
    });

    it('leads with the Day Pass reason and a solid button', () => {
      renderGate(overMonthHeld);
      expect(
        screen.getByText(
          'This deck has 121 cards. A free account covers 100 a month. A Day Pass gives you all of them now, no account.'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Get all 121 cards now' }).className
      ).toContain('buttonPrimary');
    });

    it('keeps the free sign-up as a full option below the Day Pass', () => {
      renderGate(overMonthHeld);
      expect(
        screen.getByText('Or create a free account for your first 100 cards.')
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    it('still renders no form element so it can sit inside the upload form', () => {
      const { container } = renderGate(overMonthHeld);
      expect(container.querySelector('form')).toBeNull();
    });
  });
});

describe('AnonymousPartialGate — pass-first', () => {
  function renderPassFirst(
    held = { cardCount: 21, cardsHeldBack: 163, totalCards: 184 }
  ) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AnonymousPartialGate held={held} passFirst />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('states the real count and what a free account gets', () => {
    renderPassFirst();
    expect(screen.getByText('184 cards ready')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A pass gets you all of them now. A free account gets the first 21.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/first 100 cards/)).not.toBeInTheDocument();
  });

  it('leads with the Semester Pass and drops sign-up to a text link after the passes', () => {
    renderPassFirst();
    const semester = screen.getByRole('button', {
      name: /Semester Pass · \$29/,
    });
    const day = screen.getByRole('button', { name: /Day Pass · \$6/ });
    const signUp = screen.getByRole('link', {
      name: 'Create a free account for the first 21 cards',
    });
    expect(
      semester.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      day.compareDocumentPosition(signUp) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(signUp).toHaveAttribute('href', '/register?redirect=/upload');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=/upload'
    );
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });
});
