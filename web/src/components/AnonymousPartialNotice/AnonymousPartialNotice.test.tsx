import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnonymousPartialNotice } from './AnonymousPartialNotice';
import { track } from '../../lib/analytics/track';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

function renderNotice(props: { cardCount: number; cardsHeldBack: number }) {
  return render(
    <MemoryRouter>
      <AnonymousPartialNotice {...props} />
    </MemoryRouter>
  );
}

describe('AnonymousPartialNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('announces the delivered cards and the free monthly allowance', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 13 });
    expect(
      screen.getByText('Your first 21 cards are ready')
    ).toBeInTheDocument();
    expect(screen.getByText(/34 cards/)).toBeInTheDocument();
    expect(screen.getByText(/100 cards a month/)).toBeInTheDocument();
  });

  it('uses the plural held-back copy for more than one card', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 13 });
    expect(
      screen.getByText('13 more cards are not in this download')
    ).toBeInTheDocument();
  });

  it('uses the singular held-back copy for exactly one card', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 1 });
    expect(
      screen.getByText('1 more card is not in this download')
    ).toBeInTheDocument();
  });

  it('announces the notice politely for assistive tech', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 13 });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('sends the visitor to register with the upload page as the return target', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 13 });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/register?redirect=/upload');
  });

  it('fires the shown event once on mount', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 13 });
    expect(track).toHaveBeenCalledWith('anonymous_partial_notice_shown', {
      cards_held_back: 13,
    });
  });

  it('fires the signup event when the cta is clicked', () => {
    renderNotice({ cardCount: 21, cardsHeldBack: 13 });
    fireEvent.click(screen.getByRole('link'));
    expect(track).toHaveBeenCalledWith('anonymous_partial_signup_clicked', {
      cards_held_back: 13,
    });
  });
});
