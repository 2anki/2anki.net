import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnonymousPartialGate } from './AnonymousPartialGate';
import { track } from '../../lib/analytics/track';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

function renderGate(
  held = { cardCount: 21, cardsHeldBack: 13, totalCards: 34 }
) {
  return render(
    <MemoryRouter>
      <AnonymousPartialGate held={held} />
    </MemoryRouter>
  );
}

describe('AnonymousPartialGate', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('leads with the ready headline and the account ask', () => {
    renderGate();
    expect(
      screen.getByText('Your first 21 cards are ready')
    ).toBeInTheDocument();
    expect(screen.getByText(/100 cards a month/)).toBeInTheDocument();
    expect(screen.getByText('This file made 34 cards.')).toBeInTheDocument();
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
