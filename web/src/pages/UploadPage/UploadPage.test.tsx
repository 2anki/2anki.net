import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import i18n from '../../lib/i18n';
import { UploadPage } from './UploadPage';

vi.mock('./components/UploadForm/UploadForm', () => ({
  default: () => <div data-testid="upload-form-stub" />,
}));

vi.mock('./components/ExploreCard/ExploreCard', () => ({
  ExploreCard: () => <div data-testid="explore-card-stub" />,
}));

const trackMock = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const scheduleSyncMock = vi.fn();
vi.mock('../../lib/data_layer/userPreferencesSync', () => ({
  scheduleSync: (...args: unknown[]) => scheduleSyncMock(...args),
}));

type FakeUser = {
  id?: number;
  email?: string;
  created_at?: string | null;
  onboarded_at?: string | null;
} | null;

let fakeUser: FakeUser = null;
let fakeLocals:
  | {
      patreon?: boolean;
      subscriber?: boolean;
      passKind?: string | null;
      planSource?: string | null;
    }
  | undefined;
let fakeFeatures:
  | {
      anonymousDayPassCard?: boolean;
      anonymousAiPreview?: boolean;
      anonymousAiChoice?: boolean;
    }
  | undefined;
let fakeLocalsLoading = false;
const reportPurchaseConversion = vi.fn();
const replayPendingPurchaseConversions = vi.fn();
const storePassToken = vi.fn();
vi.mock('../../lib/anonymousPass', () => ({
  storePassToken: (...args: unknown[]) => storePassToken(...args),
}));
vi.mock('../../lib/analytics/reportPurchaseConversion', () => ({
  reportPurchaseConversion: (...args: unknown[]) =>
    reportPurchaseConversion(...args),
  replayPendingPurchaseConversions: (...args: unknown[]) =>
    replayPendingPurchaseConversions(...args),
}));
vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data:
      fakeUser == null && fakeFeatures == null
        ? undefined
        : {
            user: fakeUser ?? undefined,
            locals: fakeLocals,
            features: fakeFeatures,
          },
    isLoading: fakeLocalsLoading,
    error: null,
    isError: false,
    refetch: () => {},
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

const buildPage = (entry: string, queryClient: QueryClient) => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/upload"
            element={<UploadPage setErrorMessage={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </HelmetProvider>
);

const renderPage = (entry = '/upload') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(buildPage(entry, queryClient));
  return {
    ...result,
    rerenderPage: () => result.rerender(buildPage(entry, queryClient)),
  };
};

const renderPageWithSession = (
  sessionKey: string,
  sessionValue: string | null
) => {
  if (sessionValue == null) {
    globalThis.sessionStorage.removeItem(sessionKey);
  } else {
    globalThis.sessionStorage.setItem(sessionKey, sessionValue);
  }
  return renderPage();
};

describe('UploadPage header', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear();
  });

  it('renders an h1 page title that does not duplicate the navbar label', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: /Convert your notes/i })
    ).toBeInTheDocument();
  });

  it('renders the page subtitle naming the deck quality and formats', () => {
    renderPage();
    expect(
      screen.getByText(/Drop a file and get a deck you don't have to fix/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Notion, PDF, Markdown, HTML, Word, and CSV too\./i)
    ).toBeInTheDocument();
  });
});

describe('UploadPage explore card', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear();
  });

  it('renders the ExploreCard below the upload form', () => {
    renderPage();
    expect(screen.getByTestId('explore-card-stub')).toBeInTheDocument();
  });
});

describe('UploadPage doc/docx hint', () => {
  it('renders the Word heading rule hint inside step 1', () => {
    renderPage();
    expect(
      screen.getByText(
        /In Word docs, headings become card fronts; each bullet under a heading becomes its own card/i
      )
    ).toBeInTheDocument();
  });

  it('states the docx image limit and strikethrough-tag rule in the same place', () => {
    renderPage();
    expect(
      screen.getByText(
        /Images land on the back, and strikethrough text on a card becomes an Anki tag\./i
      )
    ).toBeInTheDocument();
  });
});

describe('UploadPage AI badge anon link', () => {
  it('links to /login?redirect=/card-options so user lands on card options after sign-in', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /sign in to turn on AI/i });
    expect(link).toHaveAttribute('href', '/login?redirect=/card-options');
  });
});

describe('UploadPage AI badge placement', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear();
  });

  it('renders the AI badge above the upload form so the mode is read before dropping a file', () => {
    renderPage();
    const uploadForm = screen.getByTestId('upload-form-stub');
    const badge = screen
      .getByRole('link', { name: /sign in to turn on AI/i })
      .closest('[role="status"]') as HTMLElement;
    expect(badge).toBeInTheDocument();
    expect(
      uploadForm.compareDocumentPosition(badge) &
        Node.DOCUMENT_POSITION_PRECEDING
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });
});

describe('UploadPage AI badge while user locals load', () => {
  beforeEach(() => {
    fakeUser = null;
    fakeLocals = undefined;
    fakeFeatures = undefined;
    fakeLocalsLoading = true;
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    fakeLocalsLoading = false;
    delete document.documentElement.dataset.auth;
  });

  it('shows the AI choice from the first render for a visitor with no session', () => {
    renderPage();
    expect(
      screen.getByLabelText("Cards from your file's structure: free, no AI")
    ).toBeChecked();
    expect(
      screen.queryByRole('link', { name: /sign in to turn on AI/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the visitor saved choice while locals load', () => {
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    expect(
      screen.getByLabelText('Claude writes the cards: free sample first')
    ).toBeChecked();
  });

  it('holds the signed-in badge space hidden when the page is marked signed in', () => {
    document.documentElement.dataset.auth = '1';
    const { container } = renderPage();
    const badge = container.querySelector('[role="status"]');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.queryByLabelText('Claude writes the cards: free sample first')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /sign in to turn on AI/i })
    ).not.toBeInTheDocument();
  });
});

describe('UploadPage AI toggle', () => {
  beforeEach(() => {
    trackMock.mockClear();
    scheduleSyncMock.mockClear();
    fakeUser = null;
    fakeLocals = undefined;
    fakeFeatures = undefined;
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    fakeUser = null;
    fakeLocals = undefined;
    fakeFeatures = undefined;
    globalThis.localStorage.clear();
  });

  it('shows the anonymous AI preview toggle with the agreed Claude AI label', () => {
    fakeUser = null;
    fakeFeatures = { anonymousAiPreview: true };
    renderPage();
    expect(
      screen.getByText('Generate flashcards with Claude AI')
    ).toBeInTheDocument();
  });

  it('shows the two-option AI choice with consent text instead of the checkbox when the choice flag is on', () => {
    fakeUser = null;
    fakeFeatures = { anonymousAiPreview: true, anonymousAiChoice: true };
    renderPage();
    expect(
      screen.getByLabelText('Claude writes the cards: free sample first')
    ).not.toBeChecked();
    expect(
      screen.getByLabelText("Cards from your file's structure: free, no AI")
    ).toBeChecked();
    expect(
      screen.getByText(/Text from your file is sent to Claude \(Anthropic\)/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Generate flashcards with Claude AI')
    ).not.toBeInTheDocument();
  });

  it('records the upload page as the surface when the visitor picks Claude', () => {
    fakeUser = null;
    fakeFeatures = { anonymousAiPreview: true, anonymousAiChoice: true };
    trackMock.mockClear();
    renderPage();
    fireEvent.click(
      screen.getByLabelText('Claude writes the cards: free sample first')
    );
    expect(trackMock).toHaveBeenCalledWith('upload_ai_turned_on', {
      surface: 'upload',
    });
  });

  it('hides the anonymous AI preview toggle when the flag is off', () => {
    fakeUser = null;
    fakeFeatures = { anonymousAiPreview: false };
    renderPage();
    expect(
      screen.queryByText('Generate flashcards with Claude AI')
    ).not.toBeInTheDocument();
  });

  it('syncs the AI preference to the server so it follows the user across devices', async () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    renderPage();
    const toggle = screen.getByRole('button', { name: /turn ai on/i });
    toggle.click();
    await waitFor(() => {
      expect(globalThis.localStorage.getItem('claude-ai-flashcards')).toBe(
        'true'
      );
    });
    expect(scheduleSyncMock).toHaveBeenCalled();
  });

  it('shows an upgrade link and no toggle for a signed-in non-paying user', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: false, subscriber: false };
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    const upgrade = screen.getByRole('link', {
      name: /upgrade to write cards with claude/i,
    });
    expect(upgrade).toHaveAttribute('href', '/pricing');
    expect(
      screen.queryByRole('button', { name: /turn ai (on|off)/i })
    ).not.toBeInTheDocument();
  });

  it('turns AI on when a paying user clicks the off toggle', async () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    renderPage();
    const toggle = screen.getByRole('button', { name: /turn ai on/i });
    toggle.click();
    await waitFor(() => {
      expect(globalThis.localStorage.getItem('claude-ai-flashcards')).toBe(
        'true'
      );
    });
    expect(
      screen.getByRole('button', { name: /turn ai off/i })
    ).toBeInTheDocument();
    expect(callsFor('upload_ai_turned_on')).toHaveLength(1);
  });

  it('turns AI off when a paying user clicks the on toggle', async () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: false, subscriber: true };
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    const toggle = screen.getByRole('button', { name: /turn ai off/i });
    toggle.click();
    await waitFor(() => {
      expect(globalThis.localStorage.getItem('claude-ai-flashcards')).toBe(
        'false'
      );
    });
    expect(
      screen.getByRole('button', { name: /turn ai on/i })
    ).toBeInTheDocument();
    expect(callsFor('upload_ai_turned_off')).toHaveLength(1);
  });

  it('turns AI on from the inline "Turn on Claude cards" button in the off state', async () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    renderPage();
    const turnOn = screen.getByRole('button', {
      name: /turn on claude cards/i,
    });
    turnOn.click();
    await waitFor(() => {
      expect(globalThis.localStorage.getItem('claude-ai-flashcards')).toBe(
        'true'
      );
    });
    expect(
      screen.getByRole('button', { name: /turn ai off/i })
    ).toBeInTheDocument();
    expect(callsFor('upload_ai_turned_on')).toHaveLength(1);
  });
});

describe('UploadPage AI badge settings link', () => {
  beforeEach(() => {
    trackMock.mockClear();
    fakeUser = null;
    fakeLocals = undefined;
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    fakeUser = null;
    fakeLocals = undefined;
    globalThis.localStorage.clear();
  });

  it('shows a Manage in Settings link in the off state pointing at card-options without the pdf-ai anchor', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    renderPage();
    const settings = screen.getByRole('link', { name: /manage in settings/i });
    expect(settings).toHaveAttribute('href', '/card-options?returnTo=/upload');
  });

  it('shows both the upgrade link and a Manage in Settings link in the free state', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: false, subscriber: false };
    renderPage();
    expect(
      screen.getByRole('link', { name: /upgrade to write cards with claude/i })
    ).toHaveAttribute('href', '/pricing');
    expect(
      screen.getByRole('link', { name: /manage in settings/i })
    ).toHaveAttribute('href', '/card-options?returnTo=/upload');
  });

  it('keeps the on state Manage in Settings link anchored at pdf-ai', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    expect(
      screen.getByRole('link', { name: /manage in settings/i })
    ).toHaveAttribute('href', '/card-options?returnTo=/upload#pdf-ai');
  });

  it('tells the user the AI cards are steerable in the on state body', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    expect(screen.getByText(/tell it what to focus on/i)).toBeInTheDocument();
  });

  it('tracks a click on the on state Manage in Settings link', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    screen.getByRole('link', { name: /manage in settings/i }).click();
    expect(trackMock).toHaveBeenCalledWith('upload_ai_settings_link_clicked');
  });

  it('does not add a settings link in the anon state', () => {
    fakeUser = null;
    renderPage();
    expect(
      screen.queryByRole('link', { name: /manage in settings/i })
    ).not.toBeInTheDocument();
  });
});

describe('UploadPage AI off badge for a paying account', () => {
  const creditsRequests = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/ai/credits');

  function stubCredits(
    credits: number,
    resets: 'pass' | 'period' = 'pass'
  ): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/ai/credits'
          ? new Response(
              JSON.stringify({
                credits,
                used: 1500 - credits,
                allowance: 1500,
                usable: true,
                windowEnd: null,
                resets,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          : new Response(null, { status: 204 })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    fakeUser = { id: 42 };
    fakeLocals = undefined;
    fakeFeatures = undefined;
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    fakeUser = null;
    fakeLocals = undefined;
    fakeFeatures = undefined;
    globalThis.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it.each([
    ['a Stripe subscriber', { subscriber: true, planSource: 'stripe' }],
    [
      'a 120-day pass holder',
      { subscriber: true, passKind: '120d', planSource: null },
    ],
    ['a lifetime account', { patreon: true, subscriber: false }],
    [
      'an Apple Pro account',
      { subscriber: true, passKind: 'unlimited', planSource: 'apple' },
    ],
  ])(
    'tells %s that Claude cards are included and shows the credits left',
    async (_population, locals) => {
      fakeLocals = locals;
      globalThis.localStorage.setItem('claude-ai-flashcards', 'false');
      stubCredits(1347);
      renderPage();

      expect(
        screen.getByText('Claude cards are included in your plan.')
      ).toBeInTheDocument();
      expect(
        await screen.findByText('1347 AI credits left.')
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Turn on Claude cards' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Manage in Settings' })
      ).toHaveAttribute('href', '/card-options?returnTo=/upload');
    }
  );

  it.each([
    {
      resets: 'pass' as const,
      line: '0 AI credits left. Your next deck builds without AI.',
    },
    {
      resets: 'period' as const,
      line: '0 AI credits left. Your next deck builds without AI until your credits reset.',
    },
  ])(
    'keeps the plan line and says what the next deck does with no credits left that reset by $resets',
    async ({ resets, line }) => {
      fakeLocals = { subscriber: true };
      stubCredits(0, resets);
      renderPage();

      expect(
        screen.getByText('Claude cards are included in your plan.')
      ).toBeInTheDocument();
      expect(await screen.findByText(line)).toBeInTheDocument();
    }
  );

  it('runs the plan line into the next words in Japanese, with no space after 。', async () => {
    await i18n.changeLanguage('ja');
    try {
      fakeLocals = { subscriber: true };
      globalThis.localStorage.setItem('claude-ai-flashcards', 'false');
      stubCredits(1347);
      renderPage();

      const sentence = screen.getByText(
        'Claude カードはご利用のプランに含まれています。'
      );
      expect(sentence.textContent).toBe(
        'Claude カードはご利用のプランに含まれています。'
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('reads the credits once for the paying off state', async () => {
    fakeLocals = { subscriber: true };
    const fetchMock = stubCredits(1347);
    renderPage();

    await screen.findByText('1347 AI credits left.');
    expect(creditsRequests(fetchMock)).toHaveLength(1);
  });

  it.each([
    {
      population: 'a signed-in free account',
      user: { id: 42 },
      locals: { patreon: false, subscriber: false },
      features: undefined,
      badge: () =>
        screen.getByRole('link', {
          name: /upgrade to write cards with claude/i,
        }),
    },
    {
      population: 'a signed-out visitor',
      user: null,
      locals: undefined,
      features: undefined,
      badge: () => screen.getByRole('link', { name: /sign in to turn on AI/i }),
    },
    {
      population: 'a signed-out visitor with the AI preview toggle',
      user: null,
      locals: undefined,
      features: { anonymousAiPreview: true },
      badge: () =>
        screen.getByRole('checkbox', {
          name: 'Generate flashcards with Claude AI',
        }),
    },
    {
      population: 'a signed-out visitor with the AI choice',
      user: null,
      locals: undefined,
      features: { anonymousAiPreview: true, anonymousAiChoice: true },
      badge: () =>
        screen.getByLabelText('Claude writes the cards: free sample first'),
    },
  ])(
    'does not claim a plan or read credits for $population',
    async ({ user, locals, features, badge }) => {
      fakeUser = user;
      fakeLocals = locals;
      fakeFeatures = features;
      const fetchMock = stubCredits(1347);
      renderPage();

      expect(badge()).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        screen.queryByText('Claude cards are included in your plan.')
      ).toBeNull();
      expect(creditsRequests(fetchMock)).toHaveLength(0);
    }
  );
});

const SIGNUP_FLAG_KEY = 'signup_completed_tracked';

const callsFor = (name: string) =>
  trackMock.mock.calls.filter(([eventName]) => eventName === name);

const onboardedCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/users/me/onboarded');

describe('UploadPage analytics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    trackMock.mockClear();
    fakeUser = null;
    globalThis.sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fakeUser = null;
    globalThis.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('tracks upload_page_viewed once on mount', () => {
    renderPage();
    expect(callsFor('upload_page_viewed')).toHaveLength(1);
  });

  it('does not also fire a separate AI badge impression on every page view', () => {
    renderPage();
    expect(callsFor('upload_ai_badge_viewed')).toHaveLength(0);
  });

  it('tracks signup_completed for a brand-new account that just signed up', () => {
    fakeUser = {
      id: 42,
      created_at: new Date().toISOString(),
      onboarded_at: null,
    };
    renderPage();
    expect(callsFor('signup_completed')).toHaveLength(1);
  });

  it('does not track signup_completed for an already-onboarded user', () => {
    fakeUser = {
      id: 42,
      created_at: new Date().toISOString(),
      onboarded_at: new Date().toISOString(),
    };
    renderPage();
    expect(callsFor('signup_completed')).toHaveLength(0);
  });

  it('does not track signup_completed for an account created long ago', () => {
    fakeUser = {
      id: 42,
      created_at: '2024-01-01T00:00:00.000Z',
      onboarded_at: null,
    };
    renderPage();
    expect(callsFor('signup_completed')).toHaveLength(0);
  });

  it('does not double-fire signup_completed when the email path already tracked it', () => {
    globalThis.sessionStorage.setItem(SIGNUP_FLAG_KEY, '1');
    fakeUser = {
      id: 42,
      created_at: new Date().toISOString(),
      onboarded_at: null,
    };
    renderPage();
    expect(callsFor('signup_completed')).toHaveLength(0);
  });

  it('does not track signup_completed when there is no signed-in user', () => {
    fakeUser = null;
    renderPage();
    expect(callsFor('signup_completed')).toHaveLength(0);
  });

  it('marks a brand-new account onboarded so a later session cannot re-count the signup', () => {
    fakeUser = {
      id: 42,
      created_at: new Date().toISOString(),
      onboarded_at: null,
    };
    renderPage();
    expect(onboardedCalls(fetchMock)).toEqual([
      ['/api/users/me/onboarded', { method: 'PATCH', credentials: 'include' }],
    ]);
  });

  it('marks the account onboarded even when the email path already tracked the signup', () => {
    globalThis.sessionStorage.setItem(SIGNUP_FLAG_KEY, '1');
    fakeUser = {
      id: 42,
      created_at: new Date().toISOString(),
      onboarded_at: null,
    };
    renderPage();
    expect(onboardedCalls(fetchMock)).toHaveLength(1);
  });

  it('does not mark an already-onboarded account again', () => {
    fakeUser = {
      id: 42,
      created_at: new Date().toISOString(),
      onboarded_at: new Date().toISOString(),
    };
    renderPage();
    expect(onboardedCalls(fetchMock)).toHaveLength(0);
  });
});

const collectUnwrappedTextNodes = (root: HTMLElement): string[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const offenders: string[] = [];
  let node = walker.nextNode();
  while (node != null) {
    const hasVisibleText = (node.textContent ?? '').trim().length > 0;
    const parentMixesElements =
      (node.parentElement?.childElementCount ?? 0) > 0;
    const parentIsBadgeContainer =
      node.parentElement?.className.includes('aiOffBadgeBody') ?? false;
    if (hasVisibleText && (parentMixesElements || parentIsBadgeContainer)) {
      offenders.push(node.textContent ?? '');
    }
    node = walker.nextNode();
  }
  return offenders;
};

describe('UploadPage AI badge survives browser translation', () => {
  beforeEach(() => {
    fakeUser = null;
    fakeLocals = undefined;
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    fakeUser = null;
    fakeLocals = undefined;
    globalThis.localStorage.clear();
  });

  const badgeFor = (label: RegExp): HTMLElement => {
    const badgeLabel = screen.getByText(label);
    return badgeLabel.closest('[role="status"]') as HTMLElement;
  };

  it('renders no bare text nodes in the anon branch', () => {
    renderPage();
    expect(
      collectUnwrappedTextNodes(badgeFor(/Claude can write your cards/))
    ).toEqual([]);
  });

  it('renders no bare text nodes in the free branch', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: false, subscriber: false };
    renderPage();
    expect(collectUnwrappedTextNodes(badgeFor(/AI is off/))).toEqual([]);
  });

  it('renders no bare text nodes in the on branch', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    renderPage();
    expect(collectUnwrappedTextNodes(badgeFor(/AI is on/))).toEqual([]);
  });

  it('renders no bare text nodes in the off branch', () => {
    fakeUser = { id: 42 };
    fakeLocals = { patreon: true, subscriber: false };
    renderPage();
    expect(collectUnwrappedTextNodes(badgeFor(/AI is off/))).toEqual([]);
  });
});

describe('UploadPage checkout return', () => {
  beforeEach(() => {
    reportPurchaseConversion.mockReset();
    replayPendingPurchaseConversions.mockReset();
    storePassToken.mockReset();
    fakeLocalsLoading = false;
    fakeUser = null;
    fakeLocals = undefined;
    fakeFeatures = undefined;
  });

  it('replays any purchase held across a reload once locals resolve', () => {
    fakeUser = { id: 42, email: 'buyer@example.com' };

    renderPage('/upload');

    expect(replayPendingPurchaseConversions).toHaveBeenCalledTimes(1);
    expect(replayPendingPurchaseConversions).toHaveBeenCalledWith({
      id: 42,
      email: 'buyer@example.com',
    });
  });

  it('does not replay held purchases while user locals load', () => {
    fakeLocalsLoading = true;

    renderPage('/upload');

    expect(replayPendingPurchaseConversions).not.toHaveBeenCalled();
  });

  afterEach(() => {
    fakeLocalsLoading = false;
    fakeUser = null;
    fakeFeatures = undefined;
  });

  it('keeps the checkout params in the URL and reports nothing while user locals load', () => {
    fakeLocalsLoading = true;

    renderPage('/upload?from=pass&session_id=cs_test_abc123');

    expect(screen.getByTestId('location-search')).toHaveTextContent(
      'session_id=cs_test_abc123'
    );
    expect(reportPurchaseConversion).not.toHaveBeenCalled();
  });

  it('reports the purchase with the signed-in email once locals resolve, then strips the params', async () => {
    fakeUser = { id: 42, email: 'buyer@example.com' };

    renderPage('/upload?from=pass&session_id=cs_test_abc123');

    await waitFor(() =>
      expect(reportPurchaseConversion).toHaveBeenCalledWith('cs_test_abc123', {
        id: 42,
        email: 'buyer@example.com',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent(
        'session_id'
      )
    );
  });

  it('reports an anonymous pass return without an email and stores the pass', async () => {
    renderPage('/upload?pass_session=cs_test_anon456');

    await waitFor(() =>
      expect(reportPurchaseConversion).toHaveBeenCalledWith(
        'cs_test_anon456',
        null
      )
    );
    expect(storePassToken).toHaveBeenCalledWith('cs_test_anon456');
  });

  it('confirms the active Day Pass and the next step when the flag is on', async () => {
    fakeFeatures = { anonymousDayPassCard: true };

    renderPage('/upload?pass_session=cs_test_flag_on');

    await waitFor(() =>
      expect(
        screen.getByText(
          'Once the payment goes through, drop your file again to start your Day Pass and get every card.'
        )
      ).toBeInTheDocument()
    );
    expect(storePassToken).toHaveBeenCalledWith('cs_test_flag_on');
  });

  it('shows no Day Pass confirmation when the flag is off', async () => {
    renderPage('/upload?pass_session=cs_test_flag_off');

    await waitFor(() =>
      expect(storePassToken).toHaveBeenCalledWith('cs_test_flag_off')
    );
    expect(
      screen.queryByText(
        'Once the payment goes through, drop your file again to start your Day Pass and get every card.'
      )
    ).toBeNull();
  });

  it('stores an anonymous pass before user locals resolve, and strips it after', async () => {
    fakeLocalsLoading = true;

    const { rerenderPage } = renderPage('/upload?pass_session=cs_test_slow');

    expect(storePassToken).toHaveBeenCalledWith('cs_test_slow');
    expect(screen.getByTestId('location-search')).toHaveTextContent(
      'pass_session=cs_test_slow'
    );

    fakeLocalsLoading = false;
    rerenderPage();

    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent(
        'pass_session'
      )
    );
    expect(reportPurchaseConversion).toHaveBeenCalledWith('cs_test_slow', null);
  });

  it('reports a signed-in return once locals resolve after a loading first render', async () => {
    fakeLocalsLoading = true;

    const { rerenderPage } = renderPage(
      '/upload?checkout=success&session_id=cs_test_pro'
    );
    expect(reportPurchaseConversion).not.toHaveBeenCalled();

    fakeLocalsLoading = false;
    fakeUser = { id: 7, email: 'pro@example.com' };
    rerenderPage();

    await waitFor(() =>
      expect(reportPurchaseConversion).toHaveBeenCalledWith('cs_test_pro', {
        id: 7,
        email: 'pro@example.com',
      })
    );
  });

  it('ignores a bare session_id that did not come back from checkout', () => {
    renderPage('/upload?session_id=cs_test_planted');

    expect(reportPurchaseConversion).not.toHaveBeenCalled();
  });
});
