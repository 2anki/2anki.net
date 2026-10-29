import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MonthlyLimitPartialOffer } from './MonthlyLimitPartialOffer';
import { track } from '../../lib/analytics/track';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';

const startPassCheckout = vi.fn();

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/backend/startUnlimitedUpgrade', () => ({
  startUnlimitedUpgrade: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout }),
}));
vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));
const mockUnlimitedPrice = vi.fn<(enabled: boolean) => string | undefined>();
vi.mock('../../pages/LimitPage/useUnlimitedMonthlyPrice', () => ({
  useUnlimitedMonthlyPrice: (enabled: boolean) => mockUnlimitedPrice(enabled),
}));

describe('MonthlyLimitPartialOffer', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    vi.mocked(startUnlimitedUpgrade).mockClear();
    startPassCheckout.mockReset();
    mockUnlimitedPrice.mockReset();
    mockUnlimitedPrice.mockReturnValue('$7.99');
  });

  it('says how many cards the deck has out of the whole file', () => {
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    expect(
      screen.getByText('This deck has 42 of 342 cards')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Cards held back by the monthly limit',
      })
    ).toBeInTheDocument();
  });

  it('promises the full deck without a re-upload when the file was saved', () => {
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    expect(
      screen.getByText(/The other 300 are saved for 7 days/)
    ).toBeInTheDocument();
    expect(screen.getByText(/no re-upload/)).toBeInTheDocument();
  });

  it('asks for the file again when it could not be saved', () => {
    render(
      <MonthlyLimitPartialOffer delivered={42} heldBack={300} saved={false} />
    );

    expect(
      screen.getByText(/drop the file again for all 342 cards/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/saved for 7 days/)).not.toBeInTheDocument();
  });

  it('shows the Day Pass, Semester Pass and Pro offers with live prices', () => {
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    expect(
      screen.getByRole('button', { name: 'Get Day Pass · $6 Most popular' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Semester Pass · $29 Best value' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Upgrade to Pro · $7.99/month' })
    ).toBeInTheDocument();
    expect(mockUnlimitedPrice).toHaveBeenCalledWith(true);
  });

  it('names Pro without a price when the price cannot be read', () => {
    mockUnlimitedPrice.mockReturnValue(undefined);
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    expect(
      screen.getByRole('button', { name: 'Upgrade to Pro' })
    ).toBeInTheDocument();
  });

  it('records the offer once with the held-back count', () => {
    const { rerender } = render(
      <MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />
    );
    rerender(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    const shown = vi
      .mocked(track)
      .mock.calls.filter(([name]) => name === 'monthly_partial_offer_shown');
    expect(shown).toEqual([
      ['monthly_partial_offer_shown', { cards_held_back: 300, saved: true }],
    ]);
  });

  it('starts a Semester Pass checkout attributed to this surface', async () => {
    startPassCheckout.mockResolvedValue({ status: 'error' });
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    fireEvent.click(
      screen.getByRole('button', { name: /^Get Semester Pass · \$29/ })
    );

    await waitFor(() =>
      expect(startPassCheckout).toHaveBeenCalledWith(
        '120d',
        undefined,
        'upload-partial'
      )
    );
    expect(track).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'upload-partial',
      plan: 'semester_pass',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start checkout. Try again or email support@2anki.net."
    );
  });

  it('starts the Pro checkout from this surface', async () => {
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    fireEvent.click(screen.getByRole('button', { name: /^Upgrade to Pro/ }));

    await waitFor(() =>
      expect(startUnlimitedUpgrade).toHaveBeenCalledWith('upload-partial')
    );
  });

  it('re-enables the offers and explains when the Pro checkout cannot start', async () => {
    vi.mocked(startUnlimitedUpgrade).mockRejectedValueOnce(
      new Error('offline')
    );
    render(<MonthlyLimitPartialOffer delivered={42} heldBack={300} saved />);

    fireEvent.click(screen.getByRole('button', { name: /^Upgrade to Pro/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start checkout."
    );
    expect(
      screen.getByRole('button', { name: /^Upgrade to Pro/ })
    ).toBeEnabled();
  });
});
