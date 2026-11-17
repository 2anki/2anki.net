import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import AccountPage from './AccountPage';

const NOW = new Date('2027-01-08T12:00:00.000Z');
const IN_FINAL_WEEK = '2027-01-10T23:30:00.000Z';
const JUST_AFTER_MIDNIGHT_UTC = '2027-01-11T00:30:00.000Z';
const BEFORE_FINAL_WEEK = '2027-02-20T23:30:00.000Z';

interface HolderLocals {
  passKind: '24h' | '7d' | '120d' | null;
  passExpiresAt: string | null;
  subscriber: boolean;
  semesterRenewalOpen?: boolean;
  semesterRenewalNeedsConfirmedEmail?: boolean;
  patreon?: boolean;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function stubServer(locals: HolderLocals, emailVerified = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('users/debug/locals')) {
      return jsonResponse({
        locals: {
          owner: 1,
          patreon: false,
          subscriptionInfo: null,
          planSource: locals.passKind == null ? null : 'stripe',
          ...locals,
        },
        linked_email: '',
        user: {
          id: 1,
          name: 'Learner',
          email: 'learner@example.com',
          patreon: false,
          email_verified: emailVerified,
        },
        features: { kiUI: false },
      });
    }
    if (url.includes('pricing') || url.includes('prices')) {
      return jsonResponse({ passes: { '120d': { display: '$29' } } });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAccountPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/account']}>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const semesterInFinalWeek = (
  overrides: Partial<HolderLocals> = {}
): HolderLocals => ({
  passKind: '120d',
  passExpiresAt: IN_FINAL_WEEK,
  subscriber: true,
  semesterRenewalOpen: true,
  semesterRenewalNeedsConfirmedEmail: false,
  ...overrides,
});

describe('AccountPage pass end and Semester Pass renewal', () => {
  let originalZone: string | undefined;

  beforeEach(async () => {
    originalZone = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = originalZone;
  });

  describe('Semester Pass holder in the final week, verified address', () => {
    it('heads the renewal with a level-2 heading inside a labelled region and offers the renewal', async () => {
      stubServer(semesterInFinalWeek());
      renderAccountPage();

      const region = await screen.findByRole('region', {
        name: 'Semester Pass renewal',
      });
      expect(
        within(region).getByRole('heading', {
          level: 2,
          name: 'Renew your Semester Pass',
        })
      ).toBeInTheDocument();
      expect(
        within(region).getByText(
          'Renew now and the next 120 days start the moment this one ends, so you lose no days. One payment, nothing renews by itself.'
        )
      ).toBeInTheDocument();
      expect(
        within(region).getByRole('button', { name: /Renew Semester Pass/ })
      ).toBeEnabled();
    });

    it('shows the end date and time once in the banner area, on the plan line above the banner', async () => {
      stubServer(semesterInFinalWeek());
      renderAccountPage();

      expect(
        await screen.findByText('Ends January 11, 2027 at 12:30 AM')
      ).toBeInTheDocument();
      const region = screen.getByRole('region', {
        name: 'Semester Pass renewal',
      });
      expect(region.textContent).not.toContain('2027');
    });
  });

  describe('Semester Pass holder in the final week whose address is not proven', () => {
    it('says up front that the renewal needs a confirmed email and offers no renew button', async () => {
      stubServer(
        semesterInFinalWeek({ semesterRenewalNeedsConfirmedEmail: true }),
        false
      );
      renderAccountPage();

      const region = await screen.findByRole('region', {
        name: 'Semester Pass renewal',
      });
      expect(
        within(region).getByRole('heading', {
          level: 2,
          name: 'Renew your Semester Pass',
        })
      ).toBeInTheDocument();
      expect(
        within(region).getByText(
          'A plan is already billed to this email, so renewing needs a confirmed email first. Log out, choose “Email me a sign-in link” on the sign-in page, and open the link we send you. Then renew here.'
        )
      ).toBeInTheDocument();
      expect(
        within(region).getByText(
          'Confirming signs you out on your other devices and in connected apps such as Claude, and your password stops working. Choose “Forgot your password?” on the sign-in page to set a new one.'
        )
      ).toBeInTheDocument();
      expect(within(region).queryByRole('button')).toBeNull();
    });
  });

  describe('Semester Pass holder in the final week with an unverified address and no plan billed to it', () => {
    it('offers the renewal, which the server lets through', async () => {
      stubServer(semesterInFinalWeek(), false);
      renderAccountPage();

      const region = await screen.findByRole('region', {
        name: 'Semester Pass renewal',
      });
      expect(
        within(region).getByRole('button', { name: /Renew Semester Pass/ })
      ).toBeEnabled();
    });
  });

  describe('Semester Pass holder before the final week', () => {
    it('shows the end with its time and no renewal', async () => {
      stubServer({
        passKind: '120d',
        passExpiresAt: BEFORE_FINAL_WEEK,
        subscriber: true,
        semesterRenewalOpen: false,
        semesterRenewalNeedsConfirmedEmail: false,
      });
      renderAccountPage();

      expect(
        await screen.findByText('Ends February 21, 2027 at 12:30 AM')
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Semester Pass renewal' })
      ).toBeNull();
    });
  });

  describe.each([
    ['Day Pass', '24h'],
    ['Week Pass', '7d'],
  ] as const)('%s holder', (planName, passKind) => {
    it('shows the plan with the end and its time, and no renewal', async () => {
      stubServer({
        passKind,
        passExpiresAt: IN_FINAL_WEEK,
        subscriber: true,
      });
      renderAccountPage();

      expect(await screen.findByText(planName)).toBeInTheDocument();
      expect(
        screen.getByText('Ends January 11, 2027 at 12:30 AM')
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Semester Pass renewal' })
      ).toBeNull();
    });
  });

  describe('lifetime user who also holds a Semester Pass in its final week', () => {
    it('shows Lifetime and no renewal', async () => {
      stubServer(semesterInFinalWeek({ patreon: true }));
      renderAccountPage();

      expect(await screen.findByText('Lifetime')).toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Semester Pass renewal' })
      ).toBeNull();
    });
  });

  describe('German reader', () => {
    it('labels the region with a noun phrase and heads it in German', async () => {
      await i18n.changeLanguage('de');
      stubServer(semesterInFinalWeek());
      renderAccountPage();

      const region = await screen.findByRole('region', {
        name: 'Verlängerung des Semester Pass',
      });
      expect(
        within(region).getByRole('heading', {
          level: 2,
          name: 'Semester Pass verlängern',
        })
      ).toBeInTheDocument();
      expect(
        screen.getByText('Endet am 11. Januar 2027 um 0:30')
      ).toBeInTheDocument();
    });
  });

  describe.each([
    ['Europe/Berlin', IN_FINAL_WEEK, 'Ends January 11, 2027 at 12:30 AM'],
    [
      'Europe/Berlin',
      JUST_AFTER_MIDNIGHT_UTC,
      'Ends January 11, 2027 at 1:30 AM',
    ],
    ['America/New_York', IN_FINAL_WEEK, 'Ends January 10, 2027 at 6:30 PM'],
    [
      'America/New_York',
      JUST_AFTER_MIDNIGHT_UTC,
      'Ends January 10, 2027 at 7:30 PM',
    ],
  ])('a reader in %s', (zone, passExpiresAt, expected) => {
    it(`shows a pass ending at ${passExpiresAt} as "${expected}", the same moment the email writes in UTC`, async () => {
      process.env.TZ = zone;
      stubServer(semesterInFinalWeek({ passExpiresAt }));
      renderAccountPage();

      expect(await screen.findByText(expected)).toBeInTheDocument();
    });
  });
});
