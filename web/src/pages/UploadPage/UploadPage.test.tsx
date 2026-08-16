import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
  created_at?: string | null;
  onboarded_at?: string | null;
} | null;

let fakeUser: FakeUser = null;
let fakeLocals: { patreon?: boolean; subscriber?: boolean } | undefined;
vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: fakeUser == null ? undefined : { user: fakeUser, locals: fakeLocals },
    isLoading: false,
    error: null,
    isError: false,
    refetch: () => {},
  }),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/upload']}>
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

describe('UploadPage reattach banner', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear();
  });

  it('shows the reattach banner when upload_pending_filename is set in sessionStorage', async () => {
    renderPageWithSession('upload_pending_filename', 'biochemistry.zip');
    const reattachText = await screen.findByText(/Re-attach/);
    const banner = reattachText.closest('[role="status"]') as HTMLElement;
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('biochemistry.zip');
    expect(banner.textContent).toContain('to convert');
    globalThis.sessionStorage.removeItem('upload_pending_filename');
  });

  it('does not show the reattach banner when upload_pending_filename is absent', async () => {
    renderPageWithSession('upload_pending_filename', null);
    await waitFor(() => {
      expect(screen.queryByText(/Re-attach/)).not.toBeInTheDocument();
    });
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

describe('UploadPage AI toggle', () => {
  beforeEach(() => {
    trackMock.mockClear();
    scheduleSyncMock.mockClear();
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

const SIGNUP_FLAG_KEY = 'signup_completed_tracked';

const callsFor = (name: string) =>
  trackMock.mock.calls.filter(([eventName]) => eventName === name);

describe('UploadPage analytics', () => {
  beforeEach(() => {
    trackMock.mockClear();
    fakeUser = null;
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    fakeUser = null;
    globalThis.sessionStorage.clear();
  });

  it('tracks upload_page_viewed once on mount', () => {
    renderPage();
    expect(callsFor('upload_page_viewed')).toHaveLength(1);
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
