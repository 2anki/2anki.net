import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnonymousDayPassOffer } from './AnonymousDayPassOffer';
import { track } from '../../lib/analytics/track';

const startPassCheckout = vi.fn();

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout }),
}));
vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

describe('AnonymousDayPassOffer', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    startPassCheckout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers a Day Pass with no account and says to drop the file again', () => {
    render(<AnonymousDayPassOffer surface="anonymous-gate" totalCards={340} />);

    expect(
      screen.getByText(/lifts the card limit for 24 hours, no account needed/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/drop the file again to get all 340 cards/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get a Day Pass for $6' })
    ).toBeInTheDocument();
  });

  it('says every card when the total is unknown', () => {
    render(<AnonymousDayPassOffer surface="limit-wall" />);

    expect(
      screen.getByText(/drop the file again to get every card/)
    ).toBeInTheDocument();
  });

  it('starts an anonymous Day Pass checkout for its surface and redirects', async () => {
    const location = { href: '' };
    vi.stubGlobal('location', location);
    startPassCheckout.mockResolvedValue({ url: 'https://stripe/day' });
    render(<AnonymousDayPassOffer surface="anonymous-gate" totalCards={40} />);

    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    await waitFor(() => expect(location.href).toBe('https://stripe/day'));
    expect(startPassCheckout).toHaveBeenCalledWith(
      '24h',
      undefined,
      'anonymous-gate'
    );
    expect(track).toHaveBeenCalledWith('paywall_pass_clicked', {
      surface: 'anonymous-gate',
      plan: 'day',
      variant: 'anonymous',
    });
  });

  it('says checkout is starting while the session is created', async () => {
    startPassCheckout.mockReturnValue(new Promise(() => {}));
    render(<AnonymousDayPassOffer surface="limit-wall" />);

    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    expect(
      await screen.findByRole('button', { name: 'Starting checkout' })
    ).toBeDisabled();
  });

  it('shows an error and stays on the page when checkout fails', async () => {
    startPassCheckout.mockResolvedValue({ status: 'error' });
    render(<AnonymousDayPassOffer surface="limit-wall" />);

    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start checkout."
    );
    expect(screen.getByRole('button', { name: /Day Pass/ })).toBeEnabled();
  });

  describe('card rendering', () => {
    it('shows the title, generic line, and price when a free month covers the deck', () => {
      render(
        <AnonymousDayPassOffer
          surface="anonymous-limit-wall"
          totalCards={40}
          dayPassCard
        />
      );

      expect(screen.getByText('Day Pass')).toBeInTheDocument();
      expect(
        screen.getByText('All your cards now, no account.')
      ).toBeInTheDocument();
      expect(screen.getByText('$6 for 24 hours.')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Get all 40 cards now' })
      ).toBeInTheDocument();
    });

    it('leads with the plain-words reason when the deck is over a free month', () => {
      render(
        <AnonymousDayPassOffer
          surface="anonymous-limit-wall"
          totalCards={340}
          dayPassCard
        />
      );

      expect(
        screen.getByText(
          'This deck has 340 cards. A free account covers 100 a month. A Day Pass gives you all of them now, no account.'
        )
      ).toBeInTheDocument();
      expect(
        screen.queryByText('All your cards now, no account.')
      ).not.toBeInTheDocument();
    });

    it('says every card when the total is unknown', () => {
      render(
        <AnonymousDayPassOffer surface="anonymous-limit-wall" dayPassCard />
      );

      expect(
        screen.getByRole('button', { name: 'Get every card now' })
      ).toBeInTheDocument();
    });

    it('renders a solid button for the primary emphasis', () => {
      render(
        <AnonymousDayPassOffer
          surface="anonymous-limit-wall"
          totalCards={340}
          dayPassCard
          emphasis="primary"
        />
      );

      expect(
        screen.getByRole('button', { name: 'Get all 340 cards now' }).className
      ).toContain('buttonPrimary');
    });

    it('renders an outline button for the secondary emphasis', () => {
      render(
        <AnonymousDayPassOffer
          surface="anonymous-limit-wall"
          totalCards={40}
          dayPassCard
          emphasis="secondary"
        />
      );

      expect(
        screen.getByRole('button', { name: 'Get all 40 cards now' }).className
      ).toContain('buttonSecondary');
    });

    it('starts the same anonymous checkout from the card button', async () => {
      const location = { href: '' };
      vi.stubGlobal('location', location);
      startPassCheckout.mockResolvedValue({ url: 'https://stripe/day' });
      render(
        <AnonymousDayPassOffer
          surface="anonymous-limit-wall"
          totalCards={340}
          dayPassCard
          emphasis="primary"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Get all 340/ }));

      await waitFor(() => expect(location.href).toBe('https://stripe/day'));
      expect(startPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'anonymous-limit-wall'
      );
    });
  });
});
