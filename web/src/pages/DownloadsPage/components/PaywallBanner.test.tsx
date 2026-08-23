import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PaywallBanner } from './PaywallBanner';
import JobResponse from '../../../schemas/public/JobResponse';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const startUnlimitedCheckout = vi.fn();
vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startUnlimitedCheckout }),
}));

type AnalyticsGlobals = {
  hj?: ReturnType<typeof vi.fn>;
  gtag?: ReturnType<typeof vi.fn>;
};

function buildJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 1 as JobResponse['id'],
    owner: 'owner-1',
    object_id: 'page-id',
    status: 'started',
    created_at: new Date('2026-05-10T11:30:00Z'),
    last_edited_time: new Date('2026-05-10T11:30:00Z'),
    title: 'Biology Chapter 1',
    type: 'page',
    job_reason_failure: null,
    card_count: null,
    restartable: false,
    download_key: null,
    upload_id: null,
    ...overrides,
  };
}

function getUpgradeButton() {
  return screen.getByRole('button', {
    name: /Upgrade to Unlimited/,
  });
}

describe('PaywallBanner', () => {
  let hrefSetter: Mock<(value: string) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    startUnlimitedCheckout.mockReset();
    hrefSetter = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        set href(value: string) {
          hrefSetter(value);
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('renders headline, body, the upgrade button, and a See all plans link to /pricing', () => {
    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    expect(
      screen.getByText('One conversion at a time on the free plan')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This conversion was paused so the one you already started can finish. Upgrade to Unlimited to run several at once.'
      )
    ).toBeInTheDocument();
    expect(getUpgradeButton()).toBeInTheDocument();
    const seeAllPlans = screen.getByRole('link', { name: 'See all plans' });
    expect(seeAllPlans).toHaveAttribute(
      'href',
      '/pricing?source=paywall-cancel'
    );
  });

  it('shows in-progress job title and relative start time when inProgressJob is provided', () => {
    render(
      <MemoryRouter>
        <PaywallBanner
          inProgressJob={buildJob({ title: 'Biology Chapter 1' })}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Biology Chapter 1')).toBeInTheDocument();
    expect(screen.getByText(/started 30 minutes ago/)).toBeInTheDocument();
  });

  it('falls back to generic copy when in-progress job title is missing', () => {
    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={buildJob({ title: null })} />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/Or wait for your current conversion to finish/)
    ).toBeInTheDocument();
  });

  it('fires paywall_shown on mount and paywall_clicked_upgrade when the button is clicked', async () => {
    startUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.test/s',
    });
    const hj = (globalThis as AnalyticsGlobals).hj!;
    const gtag = (globalThis as AnalyticsGlobals).gtag!;

    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    expect(hj).toHaveBeenCalledWith('event', 'paywall_shown');
    expect(gtag).toHaveBeenCalledWith('event', 'paywall_shown');

    hj.mockClear();
    gtag.mockClear();

    await act(async () => {
      fireEvent.click(getUpgradeButton());
    });

    expect(hj).toHaveBeenCalledWith('event', 'paywall_clicked_upgrade');
    expect(gtag).toHaveBeenCalledWith('event', 'paywall_clicked_upgrade');
  });

  it('tracks paywall_shown with surface=downloads_banner on mount', async () => {
    const { track } = await import('../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
      surface: 'downloads_banner',
    });
  });

  it('tracks paywall_upgrade_clicked with surface=downloads_banner when the button is clicked', async () => {
    startUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.test/s',
    });
    const { track } = await import('../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(getUpgradeButton());
    });

    expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'downloads_banner',
    });
  });

  it('fires paywall_dismissed on unmount when the user never clicked upgrade', async () => {
    const { track } = await import('../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const { unmount } = render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    expect(trackMock).not.toHaveBeenCalledWith(
      'paywall_dismissed',
      expect.anything()
    );

    unmount();

    expect(trackMock).toHaveBeenCalledWith('paywall_dismissed', {
      surface: 'downloads_banner',
    });
  });

  it('does not fire paywall_dismissed when the user clicked upgrade before unmount', async () => {
    startUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.test/s',
    });
    const { track } = await import('../../../lib/analytics/track');
    const trackMock = vi.mocked(track);

    const { unmount } = render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(getUpgradeButton());
    });

    trackMock.mockClear();
    unmount();

    expect(trackMock).not.toHaveBeenCalledWith(
      'paywall_dismissed',
      expect.anything()
    );
  });

  it('starts an Unlimited checkout and redirects to the returned Stripe url', async () => {
    startUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/session-123',
    });

    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(getUpgradeButton());
    });

    expect(startUnlimitedCheckout).toHaveBeenCalledWith(
      'year',
      undefined,
      'downloads_banner'
    );
    expect(hrefSetter).toHaveBeenCalledWith(
      'https://checkout.stripe.test/session-123'
    );
  });

  it('falls back to the pricing page when checkout cannot start', async () => {
    startUnlimitedCheckout.mockResolvedValue({ status: 'error' });

    render(
      <MemoryRouter>
        <PaywallBanner inProgressJob={null} />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(getUpgradeButton());
    });

    expect(hrefSetter).toHaveBeenCalledWith('/pricing?source=paywall-cancel');
  });
});
