import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { BuyCreditsButton } from './BuyCreditsButton';

const startCreditPackCheckout = vi.fn();
vi.mock('../../lib/backend/startCreditPackCheckout', () => ({
  startCreditPackCheckout: (...args: unknown[]) =>
    startCreditPackCheckout(...args),
}));

const track = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => track(...args),
}));

describe('BuyCreditsButton', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    startCreditPackCheckout.mockReset();
    track.mockReset();
  });

  it('shows the full price label for the secondary variant', () => {
    render(<BuyCreditsButton source="credits_account" variant="secondary" />);
    expect(
      screen.getByRole('button', { name: 'Buy 250 credits for $5' })
    ).toBeInTheDocument();
  });

  it('shows the compact label for the badge', () => {
    render(<BuyCreditsButton source="credits_badge" variant="link" compact />);
    expect(
      screen.getByRole('button', { name: 'Buy credits' })
    ).toBeInTheDocument();
  });

  it('tracks an impression with the source when it renders', () => {
    render(<BuyCreditsButton source="credits_badge" variant="link" compact />);

    expect(track).toHaveBeenCalledWith('credits_buy_shown', {
      source: 'credits_badge',
    });
  });

  it('tracks the click and starts checkout with the source', async () => {
    startCreditPackCheckout.mockResolvedValue('redirecting');
    render(<BuyCreditsButton source="credits_conversion" variant="link" />);

    fireEvent.click(screen.getByRole('button'));

    expect(track).toHaveBeenCalledWith('credits_buy_clicked', {
      source: 'credits_conversion',
    });
    expect(startCreditPackCheckout).toHaveBeenCalledWith('credits_conversion');
  });

  it('shows a retry message when checkout cannot start', async () => {
    startCreditPackCheckout.mockResolvedValue('error');
    render(<BuyCreditsButton source="credits_account" variant="secondary" />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't start checkout. Try again.")
      ).toBeInTheDocument()
    );
  });

  it('does not show a retry message while the redirect is in flight', async () => {
    startCreditPackCheckout.mockResolvedValue('redirecting');
    render(<BuyCreditsButton source="credits_account" variant="secondary" />);

    fireEvent.click(screen.getByRole('button'));

    expect(
      screen.queryByText("Couldn't start checkout. Try again.")
    ).toBeNull();
  });
});
