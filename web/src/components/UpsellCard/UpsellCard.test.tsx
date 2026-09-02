import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { UpsellCard } from './UpsellCard';

function renderCard(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const mockStartPassCheckout = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    startPassCheckout: mockStartPassCheckout,
  }),
}));

const mockUseUserLocals = vi.fn();

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => mockUseUserLocals(),
}));

const mockUseCardUsage = vi.fn();

vi.mock('../../lib/hooks/useCardUsage', () => ({
  useCardUsage: () => mockUseCardUsage(),
}));

const mockTrack = vi.fn();

vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

const freeUser = {
  data: {
    locals: { patreon: false, subscriber: false },
    user: { email: 'free@example.com' },
  },
};

const payingUser = {
  data: {
    locals: { patreon: false, subscriber: true },
    user: { email: 'paying@example.com' },
  },
};

const anonymousUser = { data: undefined };

describe('UpsellCard', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockStartPassCheckout.mockReset();
    mockUseCardUsage.mockReturnValue(null);
  });

  it('renders one pass CTA and a plans link for free users', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(
      screen.getByRole('button', { name: 'Get Day Pass — $6' })
    ).toBeInTheDocument();
    const plans = screen.getByRole('link', { name: 'See plans' });
    expect(plans).toHaveAttribute('href', '/pricing');
    expect(screen.queryByRole('button', { name: /Week Pass/ })).toBeNull();
  });

  it('renders nothing for paying users', () => {
    mockUseUserLocals.mockReturnValue(payingUser);
    const { container } = renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders for anonymous users by default', () => {
    mockUseUserLocals.mockReturnValue(anonymousUser);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(
      screen.getByRole('button', { name: /Day Pass/ })
    ).toBeInTheDocument();
  });

  it('hides for anonymous users when hideForAnonymous is true', () => {
    mockUseUserLocals.mockReturnValue(anonymousUser);
    const { container } = renderCard(
      <UpsellCard surface="upload_success_upsell" hideForAnonymous />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still shows for free logged-in users when hideForAnonymous is true', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    renderCard(<UpsellCard surface="upload_success_upsell" hideForAnonymous />);
    expect(
      screen.getByRole('button', { name: /Day Pass/ })
    ).toBeInTheDocument();
  });

  it('uses the downloads surface headline on /downloads', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(screen.getByText('Converting more this month?')).toBeInTheDocument();
  });

  it('uses the upload-success surface headline on upload success', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    renderCard(<UpsellCard surface="upload_success_upsell" />);
    expect(screen.getByText('More pages to convert?')).toBeInTheDocument();
  });

  it('fires paywall_shown with the surface on mount for free users', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'downloads_upsell',
    });
  });

  it('does not fire paywall_shown for paying users', () => {
    mockUseUserLocals.mockReturnValue(payingUser);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('fires paywall_upgrade_clicked with plan=day_pass when Day Pass is clicked', async () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/day',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderCard(<UpsellCard surface="downloads_upsell" />);
    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
        surface: 'downloads_upsell',
        plan: 'day_pass',
      });
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'downloads_upsell'
      );
    });
  });

  it('fires paywall_upgrade_clicked with plan=see_plans when See plans is clicked', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    fireEvent.click(screen.getByRole('link', { name: 'See plans' }));
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'downloads_upsell',
      plan: 'see_plans',
    });
  });

  it('shows the starting-checkout label and disables the button while pass checkout is pending', async () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    let resolveCheckout: (value: { status: 'error' }) => void = () => {};
    mockStartPassCheckout.mockReturnValue(
      new Promise((resolve) => {
        resolveCheckout = resolve;
      })
    );

    renderCard(<UpsellCard surface="downloads_upsell" />);
    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Starting checkout' })
      ).toBeDisabled();
    });

    resolveCheckout({ status: 'error' });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Day Pass/ })
      ).toBeInTheDocument();
    });
  });

  it('clears the starting-checkout label when the page is restored from the back-forward cache', async () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    mockStartPassCheckout.mockReturnValue(new Promise(() => {}));

    renderCard(<UpsellCard surface="downloads_upsell" />);
    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Starting checkout' })
      ).toBeDisabled();
    });

    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    fireEvent(globalThis.window, pageshow);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Day Pass/ })).toBeEnabled();
    });
  });

  it('fires paywall_dismissed when unmounted without an upgrade click', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    const { unmount } = renderCard(<UpsellCard surface="downloads_upsell" />);
    mockTrack.mockClear();
    unmount();
    expect(mockTrack).toHaveBeenCalledWith('paywall_dismissed', {
      surface: 'downloads_upsell',
    });
  });

  it('does not fire paywall_dismissed when unmounted after an upgrade click', async () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    mockStartPassCheckout.mockReturnValue(new Promise(() => {}));

    const { unmount } = renderCard(<UpsellCard surface="downloads_upsell" />);
    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Starting checkout' })
      ).toBeDisabled();
    });

    mockTrack.mockClear();
    unmount();
    expect(mockTrack).not.toHaveBeenCalledWith(
      'paywall_dismissed',
      expect.anything()
    );
  });

  it('does not fire paywall_dismissed for paying users (card never shown)', () => {
    mockUseUserLocals.mockReturnValue(payingUser);
    const { unmount } = renderCard(<UpsellCard surface="downloads_upsell" />);
    mockTrack.mockClear();
    unmount();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('includes quota_remaining in paywall_shown when card usage is available', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    mockUseCardUsage.mockReturnValue({
      cards_used: 75,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'downloads_upsell',
      quota_remaining: 25,
    });
  });

  it('omits quota_remaining from paywall_shown when card usage is not yet loaded', () => {
    mockUseUserLocals.mockReturnValue(freeUser);
    mockUseCardUsage.mockReturnValue(null);
    renderCard(<UpsellCard surface="downloads_upsell" />);
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'downloads_upsell',
    });
  });
});
