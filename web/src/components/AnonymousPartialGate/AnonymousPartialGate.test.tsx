import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnonymousPartialGate,
  HELD_DECK_CHECKOUT_SURFACE,
} from './AnonymousPartialGate';
import { track } from '../../lib/analytics/track';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
const startPassCheckout = vi.fn();
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout }),
}));
vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

interface GateHeld {
  cardCount: number;
  cardsHeldBack: number;
  totalCards: number;
  deckName?: string;
  savedForHours?: number;
  dayPassCard?: boolean;
}

function renderGate(
  held: GateHeld = {
    cardCount: 21,
    cardsHeldBack: 13,
    totalCards: 34,
    deckName: 'Pharmacology',
    savedForHours: 24,
  }
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

  it('names the deck and promises the whole file when it fits a free month', () => {
    renderGate();
    expect(screen.getByText('Pharmacology')).toBeInTheDocument();
    expect(screen.getByText('All 34 cards are ready')).toBeInTheDocument();
    expect(screen.getByText(/100 cards a month/)).toBeInTheDocument();
  });

  it('says how long the deck stays saved, from the hold', () => {
    renderGate({
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
      deckName: 'Pharmacology',
      savedForHours: 24,
    });
    expect(screen.getByText('Saved for 24 hours.')).toBeInTheDocument();
  });

  it('says nothing about a saved window the hold did not report', () => {
    renderGate({ cardCount: 21, cardsHeldBack: 13, totalCards: 34 });
    expect(screen.queryByText(/Saved for/)).not.toBeInTheDocument();
  });

  it('calls a deck with no name an untitled deck', () => {
    renderGate({ cardCount: 21, cardsHeldBack: 13, totalCards: 34 });
    expect(screen.getByText('Untitled deck')).toBeInTheDocument();
  });

  it('leads with the sign-up form when the deck fits a free month', () => {
    renderGate({
      cardCount: 21,
      cardsHeldBack: 79,
      totalCards: 100,
      deckName: 'Pharmacology',
      savedForHours: 24,
    });
    expect(screen.getByText('All 100 cards are ready')).toBeInTheDocument();
    const email = screen.getByLabelText(/email/i);
    const dayPass = screen.getByRole('button', { name: 'Get Day Pass · $6' });
    expect(
      email.compareDocumentPosition(dayPass) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  describe('over a free month', () => {
    const overMonth = {
      cardCount: 21,
      cardsHeldBack: 163,
      totalCards: 184,
      deckName: 'Pharmacology',
      savedForHours: 24,
    };

    it('says every card is ready, not just the free month', () => {
      renderGate(overMonth);
      expect(screen.getByText('All 184 cards are ready')).toBeInTheDocument();
      expect(screen.queryByText(/Your first 100/)).not.toBeInTheDocument();
    });

    it('leads with the Day Pass and folds the free account into one link below it', () => {
      renderGate(overMonth);
      const dayPass = screen.getByRole('button', { name: 'Get Day Pass · $6' });
      const signUp = screen.getByRole('link', {
        name: 'Or create a free account for the first 100 cards',
      });
      expect(
        dayPass.compareDocumentPosition(signUp) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(signUp).toHaveAttribute('href', '/register?redirect=/upload');
      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    });

    it('records the free sign-up click from the folded link', () => {
      renderGate(overMonth);
      fireEvent.click(
        screen.getByRole('link', {
          name: 'Or create a free account for the first 100 cards',
        })
      );
      expect(track).toHaveBeenCalledWith('paywall_upgrade_clicked', {
        surface: HELD_DECK_CHECKOUT_SURFACE,
        plan: 'free_signup',
      });
    });
  });

  it('offers a Day Pass below the sign-up form for the whole file, with no re-upload', () => {
    renderGate();
    expect(
      screen.getByText(
        /After paying, all 34 cards are ready to download, no re-upload\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/drop the file again/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass · $6' })
    ).toBeInTheDocument();
  });

  it('labels the region for assistive tech', () => {
    renderGate();
    expect(
      screen.getByRole('region', {
        name: 'Your deck is ready',
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

    it('shows the whole-deck headline, not a capped count', () => {
      renderGate(overMonthHeld);
      expect(screen.getByText('All 121 cards are ready')).toBeInTheDocument();
      expect(
        screen.queryByText('Your first 100 cards are ready')
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

    it('promises the held deck right after paying, with no re-upload', () => {
      renderGate(overMonthHeld);
      expect(
        screen.getByText(
          'After paying, all 121 cards are ready to download, no re-upload.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/drop the file again/)).not.toBeInTheDocument();
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

describe('AnonymousPartialGate held deck summary', () => {
  it.each([
    ['the default gate', undefined],
    ['the Day Pass card lead', true],
  ])(
    'names the deck, says every card is ready and how long it stays saved in %s',
    (_label, dayPassCard) => {
      renderGate({
        cardCount: 21,
        cardsHeldBack: 163,
        totalCards: 184,
        deckName: 'Pharmacology',
        savedForHours: 24,
        dayPassCard,
      });
      expect(screen.getByText('Pharmacology')).toBeInTheDocument();
      expect(screen.getByText('All 184 cards are ready')).toBeInTheDocument();
      expect(screen.getByText('Saved for 24 hours.')).toBeInTheDocument();
      const region = screen.getByRole('region');
      expect(region.querySelector('[class*="_readyIcon_"]')).not.toBeNull();
      expect(region.querySelector('[class*="_icon_"]')).toBeNull();
    }
  );

  it('calls a nameless deck an untitled deck in the Day Pass card lead', () => {
    renderGate({
      cardCount: 21,
      cardsHeldBack: 163,
      totalCards: 184,
      dayPassCard: true,
    });
    expect(screen.getByText('Untitled deck')).toBeInTheDocument();
    expect(screen.queryByText(/Saved for/)).not.toBeInTheDocument();
  });
});

describe('AnonymousPartialGate — pass-first', () => {
  function renderPassFirst(
    held: {
      cardCount: number;
      cardsHeldBack: number;
      totalCards: number;
      dayPassCard?: boolean;
    } = { cardCount: 21, cardsHeldBack: 163, totalCards: 184 }
  ) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AnonymousPartialGate held={held} passFirst />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('takes precedence over the Day Pass card arm', () => {
    renderPassFirst({
      cardCount: 21,
      cardsHeldBack: 163,
      totalCards: 184,
      dayPassCard: true,
    });
    expect(screen.getByText('184 cards ready')).toBeInTheDocument();
    expect(
      screen.queryByText('All 184 cards are ready')
    ).not.toBeInTheDocument();
  });

  it('states the real count and what a free account gets', () => {
    renderPassFirst();
    expect(screen.getByText('184 cards ready')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Get a pass and all of them are ready to download, no re-upload. A free account gets the first 21.'
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

describe('AnonymousPartialGate checkout surface', () => {
  beforeEach(() => {
    startPassCheckout.mockReset();
    startPassCheckout.mockResolvedValue({ error: 'stay on the page' });
  });

  function renderArm(passFirst: boolean, dayPassCard: boolean) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AnonymousPartialGate
            held={{
              cardCount: 21,
              cardsHeldBack: 163,
              totalCards: 184,
              dayPassCard,
            }}
            passFirst={passFirst}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('is the surface the server releases held decks for', () => {
    expect(HELD_DECK_CHECKOUT_SURFACE).toBe('anonymous-gate');
  });

  it.each([
    ['the default gate', false, false, /Get Day Pass · \$6/, '24h'],
    ['the Day Pass card lead', false, true, /Get all 184 cards now/, '24h'],
    [
      'the pass-first Semester Pass',
      true,
      false,
      /Get Semester Pass · \$29/,
      '120d',
    ],
    ['the pass-first Day Pass', true, false, /Get Day Pass · \$6/, '24h'],
  ])(
    'checks out from %s under the held-deck surface',
    async (_label, passFirst, dayPassCard, button, kind) => {
      renderArm(passFirst, dayPassCard);

      fireEvent.click(screen.getByRole('button', { name: button }));

      await waitFor(() =>
        expect(startPassCheckout).toHaveBeenCalledWith(
          kind,
          undefined,
          HELD_DECK_CHECKOUT_SURFACE
        )
      );
    }
  );
});
