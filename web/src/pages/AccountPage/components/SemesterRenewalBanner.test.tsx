import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { track } from '../../../lib/analytics/track';
import { SemesterRenewalBanner } from './SemesterRenewalBanner';

const startPassCheckout = vi.fn();
const livePrices =
  vi.fn<() => Partial<Record<'24h' | '7d' | '120d', string>>>();

vi.mock('../../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout }),
}));
vi.mock('../../../lib/hooks/usePassPrices', () => ({
  useLivePassPrices: () => livePrices(),
}));

const NOW = new Date('2027-01-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const endsIn = (days: number) =>
  new Date(NOW.getTime() + days * DAY_MS).toISOString();

describe('SemesterRenewalBanner', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.mocked(track).mockClear();
    startPassCheckout.mockReset();
    livePrices.mockReset();
    livePrices.mockReturnValue({ '120d': '$29' });
  });

  it('tells a holder in the final week when the pass ends and offers the renewal at the live price', () => {
    render(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(5)}
        now={NOW}
      />
    );

    expect(
      screen.getByRole('region', { name: 'Semester Pass renewal' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your Semester Pass ends on January 15, 2027')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Renew Semester Pass · $29' })
    ).toBeInTheDocument();
  });

  it('records the banner once with the days left', () => {
    const { rerender } = render(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(5)}
        now={NOW}
      />
    );
    rerender(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(5)}
        now={NOW}
      />
    );

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('semester_renewal_banner_shown', {
      days_left: 5,
    });
  });

  it('leaves the price out of the button while the live price is unknown', () => {
    livePrices.mockReturnValue({});

    render(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(5)}
        now={NOW}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Renew Semester Pass' })
    ).toBeInTheDocument();
  });

  it.each([
    ['a Semester Pass with 8 days left', '120d', endsIn(8)],
    ['a Week Pass in its final days', '7d', endsIn(3)],
    ['an ended Semester Pass', '120d', endsIn(-1)],
  ] as const)('renders nothing for %s', (_label, passKind, passExpiresAt) => {
    const { container } = render(
      <SemesterRenewalBanner
        passKind={passKind}
        passExpiresAt={passExpiresAt}
        now={NOW}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });

  it('starts the Semester Pass checkout with the renewal surface and records the click', async () => {
    startPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/renewal',
    });
    const location = { href: 'http://localhost/account' };
    vi.stubGlobal('location', location);

    render(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(2)}
        now={NOW}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Renew Semester Pass · $29' })
    );

    await waitFor(() =>
      expect(location.href).toBe('https://checkout.stripe.com/renewal')
    );
    expect(startPassCheckout).toHaveBeenCalledWith(
      '120d',
      undefined,
      'semester-renewal'
    );
    expect(track).toHaveBeenCalledWith('semester_renewal_clicked', {
      days_left: 2,
    });
    vi.unstubAllGlobals();
  });

  it('explains a conflict the server answers with', async () => {
    startPassCheckout.mockResolvedValue({
      status: 'conflict',
      code: 'already_subscribed',
      expiresAt: null,
    });

    render(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(2)}
        now={NOW}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Renew Semester Pass/ })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('common:checkout.conflict.already_subscribed')
    );
    expect(
      screen.getByRole('button', { name: /Renew Semester Pass/ })
    ).toBeEnabled();
  });

  it('says checkout did not open when the request fails', async () => {
    startPassCheckout.mockResolvedValue({ status: 'error' });

    render(
      <SemesterRenewalBanner
        passKind="120d"
        passExpiresAt={endsIn(2)}
        now={NOW}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Renew Semester Pass/ })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start checkout. Try again or email support@2anki.net."
    );
  });
});
