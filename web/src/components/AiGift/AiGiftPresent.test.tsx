import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '../../lib/i18n';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { forgetNoticesShownThisLoad } from '../../lib/analytics/trackNoticeOncePerLoad';
import { AiGiftPresent, formatGiftDate } from './AiGiftPresent';
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

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  json: async () => body,
});

function routeFetch(gift: unknown, claim?: ReturnType<typeof reply>) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method });
    if (String(url).endsWith('/api/ai/gift/claim')) {
      return claim ?? reply(200, {});
    }
    if (String(url).endsWith('/api/ai/gift')) {
      return reply(200, gift);
    }
    return reply(200, {});
  }) as unknown as typeof fetch;
  return calls;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

const CLAIMED = {
  state: 'claimed',
  credits: 100,
  expiresAt: '2026-11-27T12:00:00.000Z',
  feedbackDue: false,
  inUse: false,
  minMonthlyCards: 20,
};

const CLAIM_OK = () =>
  reply(200, { credits: 100, expiresAt: '2026-11-27T12:00:00.000Z' });

const claudeCardsOn = () => localStorage.getItem('claude-ai-flashcards');

const eventsNamed = (name: string) =>
  vi.mocked(track).mock.calls.filter(([event]) => event === name);

function renderPresent(
  isLoggedIn: boolean,
  planCreditsFirst?: boolean,
  giftPaysForClaude?: boolean,
  cardsLeftThisMonth: number | null = 80
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (cardsLeft: number | null) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/downloads']}>
        <AiGiftPresent
          isLoggedIn={isLoggedIn}
          planCreditsFirst={planCreditsFirst}
          giftPaysForClaude={giftPaysForClaude}
          cardsLeftThisMonth={cardsLeft}
        />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(cardsLeftThisMonth));
  return {
    ...view,
    cardsCounted: (cardsLeft: number | null) => view.rerender(tree(cardsLeft)),
  };
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

  test('claims by itself on return from sign-up and lands with Claude writing the next file', async () => {
    const calls = routeFetch(OPEN, CLAIM_OK());
    rememberClaimIntent(Date.now());

    renderPresent(true, false, true);

    const ready = await screen.findByText(
      'Claude will write the cards for your next file.'
    );
    expect(ready).toHaveFocus();
    expect(
      calls.filter((c) => c.url.endsWith('/claim') && c.method === 'POST')
    ).toHaveLength(1);
    expect(claudeCardsOn()).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Choose a file' })
    ).toBeInTheDocument();
    expect(eventsNamed('ai_gift_claim_clicked')).toEqual([
      [
        'ai_gift_claim_clicked',
        { signed_in: true, trigger: 'return', automatic: true },
      ],
    ]);
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([
      ['ai_gift_claude_cards_enabled', { via: 'return' }],
    ]);
  });

  test('claims on return for an account with a plan without switching Claude on', async () => {
    const calls = routeFetch(OPEN, CLAIM_OK());
    rememberClaimIntent(Date.now());

    renderPresent(true, true, false);

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.endsWith('/claim') && c.method === 'POST')
    ).toHaveLength(1);
    expect(claudeCardsOn()).toBeNull();
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([]);
  });

  test('claims for an account with no plan and switches Claude on for the next file', async () => {
    const calls = routeFetch(OPEN, CLAIM_OK());
    localStorage.setItem('claude-ai-flashcards', 'false');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    const ready = await screen.findByText(
      'Claude will write the cards for your next file.'
    );
    expect(ready).toHaveFocus();
    expect(ready.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      `100 free AI credits left until ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}.You can turn AI off on the upload page.`
    );
    expect(claudeCardsOn()).toBe('true');
    expect(localStorage.getItem('ai-choice-at')).toMatch(/^\d+$/);
    expect(
      calls.filter((c) => c.url.endsWith('/claim') && c.method === 'POST')
    ).toHaveLength(1);
    expect(eventsNamed('ai_gift_claim_clicked')).toEqual([
      ['ai_gift_claim_clicked', { signed_in: true, trigger: 'click' }],
    ]);
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([
      ['ai_gift_claude_cards_enabled', { via: 'claim' }],
    ]);
  });

  test('leaves the switch alone for an account whose plan credits pay first, and says where to turn it on', async () => {
    routeFetch(OPEN, CLAIM_OK());
    localStorage.setItem('claude-ai-flashcards', 'false');
    renderPresent(true, true, false);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      `They expire on ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}.Your plan credits are used first.AI is off. Turn it on from the upload page to use them.`
    );
    expect(claudeCardsOn()).toBe('false');
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([]);
  });

  test('shows a plan account that AI is already on', async () => {
    routeFetch(CLAIMED);
    localStorage.setItem('claude-ai-flashcards', 'true');
    renderPresent(true, true, false);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('AI is on for your uploads.')
    ).toBeInTheDocument();
  });

  test('does not switch Claude on when the account is not known to have no plan', async () => {
    routeFetch(OPEN, CLAIM_OK());
    renderPresent(true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toBeInTheDocument();
    expect(claudeCardsOn()).toBeNull();
  });

  test('offers a gift-only account with AI off to turn it on, once', async () => {
    routeFetch(CLAIMED);
    localStorage.setItem('claude-ai-flashcards', 'false');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'AI is off, so your next file gets cards from its structure.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn AI on' }));

    expect(
      await screen.findByText('Claude will write the cards for your next file.')
    ).toHaveFocus();
    expect(claudeCardsOn()).toBe('true');
    expect(screen.queryByRole('button', { name: 'Turn AI on' })).toBeNull();
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([
      ['ai_gift_claude_cards_enabled', { via: 'panel' }],
    ]);
  });

  test.each([
    ['idle', 'picker', 'openPicker'],
    ['busy', 'zone', 'showZone'],
  ] as const)(
    'Choose a file on a page whose upload zone is %s reaches the zone in place',
    async (activity, outcome, called) => {
      routeFetch(CLAIMED);
      localStorage.setItem('claude-ai-flashcards', 'true');
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
    localStorage.setItem('claude-ai-flashcards', 'true');
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

  test('says honestly that the month has too few cards for Claude, and leaves the switch off', async () => {
    routeFetch(OPEN, CLAIM_OK());
    localStorage.setItem('claude-ai-flashcards', 'false');
    renderPresent(true, false, true, 12);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(
      await screen.findByText(
        'You have 12 cards left this month, too few for a Claude deck. Your next file gets cards from its structure.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Claude will write the cards for your next file.')
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn AI on' })).toBeNull();
    expect(claudeCardsOn()).toBe('false');
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([]);
  });

  test('waits for the month’s card count before choosing a line or switching', async () => {
    routeFetch(OPEN, CLAIM_OK());
    const { cardsCounted } = renderPresent(true, false, true, null);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));

    expect(
      await screen.findByText(
        `100 free AI credits left until ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}.`
      )
    ).toHaveFocus();
    expect(screen.queryByText(/next file/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose a file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn AI on' })).toBeNull();
    expect(claudeCardsOn()).toBeNull();

    cardsCounted(80);

    expect(
      await screen.findByText('Claude will write the cards for your next file.')
    ).toHaveFocus();
    expect(claudeCardsOn()).toBe('true');
    expect(eventsNamed('ai_gift_claude_cards_enabled')).toEqual([
      ['ai_gift_claude_cards_enabled', { via: 'claim' }],
    ]);
  });

  test('keeps the switch it turns on out of the account’s saved settings', async () => {
    routeFetch(OPEN, CLAIM_OK());
    renderPresent(true, false, true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim free credits' }));
    await screen.findByText('Claude will write the cards for your next file.');

    expect(localStorage.getItem('2anki-claude-cards-switched-by-gift')).toBe(
      '1'
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
    localStorage.setItem('claude-ai-flashcards', 'true');
    renderPresent(true, false, true);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog', {
      name: 'Claude writes your flashcards, free',
    });
    expect(panel).toHaveTextContent(
      'Claude will write the cards for your next file.'
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

    expect(
      await screen.findByText(
        `100 free AI credits left until ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}.`
      )
    ).toBeInTheDocument();
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
