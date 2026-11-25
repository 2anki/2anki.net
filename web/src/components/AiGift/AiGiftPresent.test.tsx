import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '../../lib/i18n';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { forgetNoticesShownThisLoad } from '../../lib/analytics/trackNoticeOncePerLoad';
import {
  AiGiftPresent,
  formatGiftDate,
  type PanelAccount,
} from './AiGiftPresent';
import { rememberClaimIntent } from './giftUiState';
import {
  registerUploadEntry,
  resetUploadEntryForTests,
} from '../../lib/upload/uploadEntry';
import { reportUploadZoneActivity } from '../../lib/upload/uploadZoneActivity';

const OPEN = {
  state: 'open',
  credits: 100,
  expiresIfClaimedNow: '2026-11-27T12:00:00.000Z',
  claimClosesAt: '2026-12-04T20:00:00.000Z',
  feedbackDue: false,
  lastsHours: 48,
  minMonthlyCards: 20,
};

const CLAIMED = {
  state: 'claimed',
  credits: 100,
  expiresAt: '2026-11-27T12:00:00.000Z',
  feedbackDue: false,
  inUse: false,
  minMonthlyCards: 20,
  claudeDefaultForPdf: true,
  aiBudgetAvailable: true,
  monthlyCardsLeft: 80,
};

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  json: async () => body,
});

function routeFetch(
  gift: unknown,
  claim?: ReturnType<typeof reply>,
  afterClaim: unknown = CLAIMED
) {
  const calls: Array<{ url: string; method: string }> = [];
  let claimed = false;
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method });
    if (String(url).endsWith('/api/ai/gift/claim')) {
      claimed = true;
      return claim ?? reply(200, {});
    }
    if (String(url).endsWith('/api/ai/gift')) {
      return reply(200, claimed ? afterClaim : gift);
    }
    return reply(200, {});
  }) as unknown as typeof fetch;
  return calls;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

const CLAIM_OK = () =>
  reply(200, { credits: 100, expiresAt: '2026-11-27T12:00:00.000Z' });

const BALANCE = `100 free AI credits left until ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}.`;

const eventsNamed = (name: string) =>
  vi.mocked(track).mock.calls.filter(([event]) => event === name);

function accountFor(
  giftPaysForClaude: boolean | undefined
): PanelAccount | undefined {
  if (giftPaysForClaude == null) return undefined;
  return { paying: !giftPaysForClaude };
}

function renderPresent(
  isLoggedIn: boolean,
  planCreditsFirst?: boolean,
  giftPaysForClaude?: boolean
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={['/downloads']}>
        <AiGiftPresent
          isLoggedIn={isLoggedIn}
          planCreditsFirst={planCreditsFirst}
          account={accountFor(giftPaysForClaude)}
        />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const trigger = () =>
  screen.findByRole('button', { name: 'Free AI credits gift' });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  forgetNoticesShownThisLoad();
  resetUploadEntryForTests();
  reportUploadZoneActivity('absent');
  vi.mocked(track).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiGiftPresent', () => {
  test('renders nothing while the gift is closed', async () => {
    const calls = routeFetch({ state: 'closed', feedbackDue: false });

    renderPresent(false);

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/ai/gift'))).toBe(true)
    );
    expect(
      screen.queryByRole('button', { name: 'Free AI credits gift' })
    ).not.toBeInTheDocument();
  });

  test('shows a signed-out visitor what the gift is and that it expires', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog', {
      name: 'Claude writes your flashcards, free',
    });
    expect(panel).toHaveTextContent(
      'Drop in your notes, a PDF, or a photo and Claude writes the cards. The credits last 48 hours from when you claim them, enough for about 3 decks.'
    );
    expect(panel).toHaveTextContent(
      `Claim by ${formatGiftDate('2026-12-04T20:00:00.000Z', 'en')}.`
    );
    expect(panel).not.toHaveTextContent('Claude cards');
    expect(track).toHaveBeenCalledWith('ai_gift_opened', {
      state: 'open',
      signed_in: false,
      trigger: 'click',
    });
  });

  test('sends a signed-out visitor to sign up from a claim button, returning to the upload page, without claiming', async () => {
    const calls = routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Claiming takes a free account. Have an account? Sign in'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(screen.getByTestId('where')).toHaveTextContent(
      '/register?redirect=%2Fupload'
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(track).toHaveBeenCalledWith('ai_gift_claim_clicked', {
      signed_in: false,
      page: '/register',
      trigger: 'click',
    });
  });

  test('offers sign-in to a visitor who has an account', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByTestId('where')).toHaveTextContent(
      '/login?redirect=%2Fupload'
    );
  });

  test('claims by itself on return from sign-up and shows what the gift does next', async () => {
    const calls = routeFetch(OPEN, CLAIM_OK());
    rememberClaimIntent(Date.now());

    renderPresent(true, false, true);

    expect(
      await screen.findByText(
        'Claude will write the cards for your next PDF or PowerPoint file.'
      )
    ).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.endsWith('/claim') && c.method === 'POST')
    ).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Choose a file' })
    ).toBeInTheDocument();
    expect(eventsNamed('ai_gift_claim_clicked')).toEqual([
      [
        'ai_gift_claim_clicked',
        { signed_in: true, trigger: 'return', automatic: true },
      ],
    ]);
  });

  test('claims on return for an account with a plan', async () => {
    const calls = routeFetch(OPEN, CLAIM_OK());
    rememberClaimIntent(Date.now());

    renderPresent(true, true, false);

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.endsWith('/claim') && c.method === 'POST')
    ).toHaveLength(1);
  });

  test('claims for an account with no plan, stores nothing, and says Claude writes the next PDF', async () => {
    routeFetch(OPEN, CLAIM_OK());
    renderPresent(true, false, true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(await screen.findByText(BALANCE)).toHaveFocus();
    expect(
      await screen.findByText(
        'Claude will write the cards for your next PDF or PowerPoint file.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Other uploads get cards from their structure.'
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'You can turn AI off on the upload page.'
    );
    expect(localStorage.getItem('claude-ai-flashcards')).toBeNull();
    expect(localStorage.getItem('ai-choice-at')).toBeNull();
    expect(eventsNamed('ai_gift_claim_clicked')).toEqual([
      ['ai_gift_claim_clicked', { signed_in: true, trigger: 'click' }],
    ]);
  });

  test('promises nothing until the status says what the gift will do', async () => {
    routeFetch(OPEN, CLAIM_OK(), {
      ...CLAIMED,
      claudeDefaultForPdf: null,
      aiBudgetAvailable: null,
      monthlyCardsLeft: null,
    });
    renderPresent(true, false, true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(await screen.findByText(BALANCE)).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose a file' })).toBeNull();
  });

  test('says honestly that the month has too few cards for a Claude deck', async () => {
    routeFetch({
      ...CLAIMED,
      claudeDefaultForPdf: false,
      monthlyCardsLeft: 12,
    });
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText(
        'You have 12 cards left this month, too few for a Claude deck. Your next file gets cards from its structure.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
  });

  test('says AI is off for an account that turned it off for itself', async () => {
    routeFetch({ ...CLAIMED, claudeDefaultForPdf: false });
    localStorage.setItem('claude-ai-flashcards', 'false');
    localStorage.setItem('ai-choice-at', '1762300000');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText(
        'AI is off. Turn it on from the upload page to use them.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
  });

  test('makes no claim when the default is off and the person never chose', async () => {
    routeFetch({ ...CLAIMED, claudeDefaultForPdf: false });
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(await screen.findByText(BALANCE)).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
    expect(screen.queryByText(/AI is off/)).toBeNull();
  });

  test('says Claude writes the next file of any kind when the account turned AI on itself', async () => {
    routeFetch({ ...CLAIMED, claudeDefaultForPdf: false });
    localStorage.setItem('claude-ai-flashcards', 'true');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('Claude will write the cards for your next file.')
    ).toBeInTheDocument();
  });

  test.each([
    ['two PDF pages make one card, by default', 'pdf-page-pairs', 'true', null],
    [
      'two PDF pages make one card, with the switch on',
      'pdf-page-pairs',
      'true',
      'true',
    ],
    ['PDF processing is off, by default', 'process-pdfs', 'false', null],
  ])(
    'promises nothing for a PDF when %s in this browser',
    async (_case, key, value, claudeSwitch) => {
      routeFetch(CLAIMED);
      localStorage.setItem(key, value);
      if (claudeSwitch != null) {
        localStorage.setItem('claude-ai-flashcards', claudeSwitch);
      }
      renderPresent(true, false, true);

      fireEvent.click(await trigger());

      expect(await screen.findByText(BALANCE)).toBeInTheDocument();
      expect(screen.queryByText(/Claude will write/)).toBeNull();
      expect(screen.queryByText(/AI is off/)).toBeNull();
    }
  );

  test('promises nothing when the account saved page pairs on another device, though this browser has the switch on', async () => {
    routeFetch({ ...CLAIMED, storedPdfSkipsClaude: true });
    localStorage.setItem('claude-ai-flashcards', 'true');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(await screen.findByText(BALANCE)).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
  });

  test('still promises the next file when neither the account nor this browser keeps a PDF from Claude', async () => {
    routeFetch({ ...CLAIMED, storedPdfSkipsClaude: false });
    localStorage.setItem('claude-ai-flashcards', 'true');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('Claude will write the cards for your next file.')
    ).toBeInTheDocument();
  });

  test('says the gift is used up, and promises nothing, even with the switch on', async () => {
    routeFetch({
      ...CLAIMED,
      credits: 0,
      claudeDefaultForPdf: false,
      aiBudgetAvailable: false,
    });
    localStorage.setItem('claude-ai-flashcards', 'true');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('Your free AI credits are used up.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
  });

  test('promises nothing to a paying account whose plan credits are spent, though it holds a gift', async () => {
    routeFetch({
      ...CLAIMED,
      claudeDefaultForPdf: true,
      aiBudgetAvailable: false,
    });
    renderPresent(true, true, false);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
    expect(screen.queryByText(/AI is off/)).toBeNull();
  });

  test('says AI is off for a paying account that turned it off by hand', async () => {
    routeFetch(CLAIMED);
    localStorage.setItem('claude-ai-flashcards', 'false');
    localStorage.setItem('ai-choice-at', '1762300000');
    renderPresent(true, true, false);

    fireEvent.click(await trigger());

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'AI is off. Turn it on from the upload page to use them.'
    );
    expect(screen.queryByText(/Claude will write/)).toBeNull();
  });

  test('shows a signed-in visitor whose plan is unknown the balance, never an on or off claim', async () => {
    routeFetch(CLAIMED);
    renderPresent(true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude will write/)).toBeNull();
    expect(screen.queryByText(/AI is (on|off)/)).toBeNull();
  });

  test('tells a paying account with budget that its PDF default is on, and what other files get', async () => {
    routeFetch(CLAIMED);
    renderPresent(true, true, false);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveTextContent(
      'Claude will write the cards for your next PDF or PowerPoint file.'
    );
    expect(panel).toHaveTextContent(
      'Other uploads get cards from their structure.'
    );
    expect(panel).not.toHaveTextContent('AI is off');
  });

  test.each([
    ['an account with no plan', true],
    ['an account with a plan', false],
  ])(
    'tells %s that a conversion is using the gift, with no promise and no off',
    async (_case, giftOnly) => {
      routeFetch({ ...CLAIMED, inUse: true });
      renderPresent(true, false, giftOnly);

      fireEvent.click(await trigger());

      const panel = screen.getByRole('dialog');
      expect(panel).toHaveTextContent(
        'A conversion is using your free AI credits right now.'
      );
      expect(panel).not.toHaveTextContent('Claude will write');
      expect(panel).not.toHaveTextContent('AI is off');
      expect(
        screen.queryByRole('button', { name: 'Choose a file' })
      ).toBeNull();
    }
  );

  test.each([
    ['idle', 'picker', 'openPicker'],
    ['busy', 'zone', 'showZone'],
  ] as const)(
    'Choose a file on a page whose upload zone is %s reaches the zone in place',
    async (activity, outcome, called) => {
      routeFetch(CLAIMED);
      const zone = { openPicker: vi.fn(), showZone: vi.fn() };
      registerUploadEntry(zone);
      reportUploadZoneActivity(activity);
      renderPresent(true, false, true);

      fireEvent.click(await trigger());
      fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));

      expect(zone[called]).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('where')).toHaveTextContent('/downloads');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(eventsNamed('ai_gift_choose_file_clicked')).toEqual([
        ['ai_gift_choose_file_clicked', { outcome }],
      ]);
    }
  );

  test('Choose a file on a page without an upload zone goes to the upload page', async () => {
    routeFetch(CLAIMED);
    renderPresent(true, false, true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/upload');
    expect(eventsNamed('ai_gift_choose_file_clicked')).toEqual([
      ['ai_gift_choose_file_clicked', { outcome: 'page' }],
    ]);
  });

  test('names the date the credits end on when the gift ends before the full length', async () => {
    const { lastsHours: _full, ...late } = OPEN;
    routeFetch({ ...late, expiresIfClaimedNow: '2026-12-04T22:00:00.000Z' });
    renderPresent(false);

    fireEvent.click(await trigger());

    expect(screen.getByRole('dialog')).toHaveTextContent(
      `Claimed now, the credits last until ${formatGiftDate('2026-12-04T22:00:00.000Z', 'en')}, enough for about 3 decks.`
    );
  });

  test('shows the whole after-claim panel at phone width', async () => {
    const narrow = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', narrow);
    vi.stubGlobal('innerWidth', 375);
    routeFetch(CLAIMED);
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog', {
      name: 'Claude writes your flashcards, free',
    });
    expect(panel).toHaveTextContent(
      'Claude will write the cards for your next PDF or PowerPoint file.'
    );
    expect(
      screen.getByRole('button', { name: 'Choose a file' })
    ).toBeInTheDocument();
    expect(narrow).toHaveBeenCalledWith('(min-width: 640px)');
    vi.unstubAllGlobals();
  });

  test('tells an account with a plan allowance that its plan credits go first', async () => {
    routeFetch({
      state: 'claimed',
      credits: 100,
      expiresAt: '2026-11-27T12:00:00.000Z',
      feedbackDue: false,
    });
    renderPresent(true, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('Your plan credits are used first.')
    ).toBeInTheDocument();
  });

  test('says nothing about spending order to an account without a plan', async () => {
    routeFetch(CLAIMED);
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    expect(await screen.findByText(BALANCE)).toBeInTheDocument();
    expect(screen.queryByText('Your plan credits are used first.')).toBeNull();
  });

  test('keeps the spending order out of the unclaimed offer', async () => {
    routeFetch(OPEN);
    renderPresent(true, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByRole('button', { name: 'Claim free credits' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Your plan credits are used first.')).toBeNull();
  });

  test('says why a claim was refused', async () => {
    routeFetch(OPEN, reply(409, { code: 'gift_already_claimed' }));
    renderPresent(true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account has already claimed the gift.'
    );
  });

  test('moves focus to the all-claimed message when it replaces the button', async () => {
    routeFetch(OPEN, reply(409, { code: 'gift_budget_full' }));
    renderPresent(true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(
      await screen.findByText('The free AI credits are all claimed for now.')
    ).toHaveFocus();
  });

  test('closes on an outside click without trapping focus', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
    fireEvent.pointerDown(screen.getByTestId('where'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('shows the gifts as all claimed for now with nothing to press', async () => {
    routeFetch({ state: 'full', feedbackDue: false });
    renderPresent(true);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveTextContent(
      'The free AI credits are all claimed for now.'
    );
    expect(
      screen.queryByRole('button', { name: /Claim|Sign up/ })
    ).not.toBeInTheDocument();
  });

  test('keeps a hidden present reachable as a small icon', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const icon = await trigger();
    expect(icon).not.toHaveTextContent('Free AI credits');
    fireEvent.click(icon);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('closes on Escape and returns focus to the present', async () => {
    routeFetch(OPEN);
    renderPresent(false);
    const button = await trigger();
    button.focus();

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('records the present as shown once per page load', async () => {
    routeFetch(OPEN);
    const first = renderPresent(false);
    await trigger();
    first.unmount();
    renderPresent(false);
    await trigger();

    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name === 'ai_gift_shown')
    ).toEqual([['ai_gift_shown', { state: 'open', signed_in: false }]]);
  });

  test('writes dates day before month, without the year', () => {
    expect(formatGiftDate('2026-12-04T20:00:00.000Z', 'en')).not.toContain(
      '2026'
    );
    expect(
      formatGiftDate('2026-12-04T20:00:00.000Z', 'en').indexOf('December')
    ).toBeGreaterThan(0);
  });
});
