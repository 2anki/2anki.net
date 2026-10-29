import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthlyLimitPartialNotice } from './MonthlyLimitPartialNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

function renderNotice(props: {
  cardsDelivered: number;
  cardsHeldBack: number;
  limit: number;
}) {
  return render(
    <MemoryRouter>
      <MonthlyLimitPartialNotice {...props} />
    </MemoryRouter>
  );
}

describe('MonthlyLimitPartialNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('names the delivered count, limit, and held-back count', () => {
    renderNotice({ cardsDelivered: 100, cardsHeldBack: 25, limit: 100 });
    expect(screen.getByText(/100/)).toBeInTheDocument();
    expect(screen.getByText(/25/)).toBeInTheDocument();
  });

  it('links to the pricing page', () => {
    renderNotice({ cardsDelivered: 100, cardsHeldBack: 25, limit: 100 });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/pricing?source=card-limit-partial');
  });

  it('names passes and Pro in the link, not an upgrade for unlimited cards', () => {
    renderNotice({ cardsDelivered: 100, cardsHeldBack: 25, limit: 100 });
    expect(
      screen.getByRole('link', { name: 'see passes and Pro' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/upgrade for unlimited/i)).toBeNull();
  });

  it('fires the paywall usage event on mount', () => {
    renderNotice({ cardsDelivered: 100, cardsHeldBack: 25, limit: 100 });
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      surface: 'card_limit_partial_notice',
    });
  });
});
