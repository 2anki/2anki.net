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
});
