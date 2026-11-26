import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function beforeEachReset() {
  beforeEach(() => {
    localStorage.clear();
  });
}

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { track } from '../../lib/analytics/track';
import { Sidebar } from './Sidebar';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../lib/backend/getCardUsage', () => ({
  getCardUsage: vi.fn().mockResolvedValue({
    cards_used: 23,
    cards_limit: 100,
    unlimited: false,
  }),
}));

const listContactMessages = vi.hoisted(() => vi.fn());

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ listContactMessages }),
}));

vi.mock('../../lib/backend/getAiCredits', () => ({
  getAiCredits: vi.fn().mockResolvedValue(null),
}));

interface SidebarRenderOpts {
  pathname?: string;
  patreon?: boolean;
  subscriber?: boolean;
  autoSyncActive?: boolean;
  kiUI?: boolean;
  ops?: boolean;
  email?: string | null;
  locals?: {
    patreon?: boolean;
    subscriber?: boolean;
    autoSyncActive?: boolean;
  } | null;
}

function renderSidebar({
  pathname = '/upload',
  patreon = false,
  subscriber = false,
  autoSyncActive = false,
  kiUI = false,
  ops = false,
  email = 'alexander@alemayhu.com',
  locals,
}: SidebarRenderOpts = {}) {
  const resolvedLocals =
    locals === undefined ? { patreon, subscriber, autoSyncActive } : locals;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <Sidebar
          email={email}
          locals={resolvedLocals}
          features={{ kiUI, ops }}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Sidebar convert group', () => {
  it('renders Upload, My Decks, and Notion to Anki for every logged-in user', () => {
    renderSidebar();
    expect(
      screen.getByRole('link', { name: 'Make flashcards' })
    ).toHaveAttribute('href', '/upload');
    expect(screen.getByRole('link', { name: 'My decks' })).toHaveAttribute(
      'href',
      '/downloads'
    );
    expect(
      screen.getByRole('link', { name: 'Notion to Anki' })
    ).toHaveAttribute('href', '/notion');
  });

  it('shows Print as a normal link for free users (1 free PDF per month)', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Print Decks' })).toHaveAttribute(
      'href',
      '/print'
    );
    expect(
      screen.queryByRole('button', { name: /Print Decks — upgrade to unlock/i })
    ).not.toBeInTheDocument();
  });

  it('shows Print as a real link for paying users', () => {
    renderSidebar({ subscriber: true });
    expect(screen.getByRole('link', { name: 'Print Decks' })).toHaveAttribute(
      'href',
      '/print'
    );
  });

  it('hides Auto Sync from a subscriber without Auto Sync access', () => {
    renderSidebar({ subscriber: true });
    expect(
      screen.queryByRole('link', { name: 'Auto Sync' })
    ).not.toBeInTheDocument();
  });

  it('shows Auto Sync for a Lifetime (Patreon) user', () => {
    renderSidebar({ patreon: true });
    expect(screen.getByRole('link', { name: 'Auto Sync' })).toHaveAttribute(
      'href',
      '/ankify'
    );
  });

  it('shows Auto Sync for an Auto Sync subscriber', () => {
    renderSidebar({ subscriber: true, autoSyncActive: true });
    expect(screen.getByRole('link', { name: 'Auto Sync' })).toHaveAttribute(
      'href',
      '/ankify'
    );
  });
});

describe('Sidebar your-stuff group', () => {
  it('shows Favorites for a logged-in user', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Favorites' })).toHaveAttribute(
      'href',
      '/favorites'
    );
  });

  it('hides Favorites when there is no signed-in account', () => {
    renderSidebar({ email: null });
    expect(
      screen.queryByRole('link', { name: 'Favorites' })
    ).not.toBeInTheDocument();
  });
});

describe('Sidebar admin group', () => {
  it('hides the admin group when no flags are on', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'KI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ops' })).not.toBeInTheDocument();
  });

  it('shows KI when kiUI is on', () => {
    renderSidebar({ kiUI: true });
    expect(screen.getByRole('link', { name: 'KI' })).toHaveAttribute(
      'href',
      '/ki'
    );
  });

  it('shows Ops as an expandable folder when ops is on', () => {
    renderSidebar({ ops: true, pathname: '/upload' });
    expect(screen.getByRole('button', { name: 'Ops' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });
});

describe('Sidebar Ops folder', () => {
  beforeEach(() => {
    localStorage.clear();
    listContactMessages.mockReset();
    listContactMessages.mockResolvedValue([]);
  });
  afterEach(() => localStorage.clear());

  it('keeps the folder collapsed and its tabs hidden off /ops', () => {
    renderSidebar({ ops: true, pathname: '/upload' });
    expect(
      screen.queryByRole('link', { name: 'Errors' })
    ).not.toBeInTheDocument();
  });

  it('expands the folder and reveals tabs when the header is clicked', () => {
    renderSidebar({ ops: true, pathname: '/upload' });
    fireEvent.click(screen.getByRole('button', { name: 'Ops' }));
    expect(screen.getByRole('button', { name: 'Ops' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('link', { name: 'Business' })).toHaveAttribute(
      'href',
      '/ops/business'
    );
  });

  it('shows only the four everyday rows until More is opened', () => {
    renderSidebar({ ops: true, pathname: '/ops/today' });
    for (const label of ['Today', 'Business', 'Growth', 'Flags']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of ['System', 'Errors', 'Messages', 'Tools', 'Showcase']) {
      expect(
        screen.queryByRole('link', { name: label })
      ).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('reveals the rest when More is clicked', () => {
    renderSidebar({ ops: true, pathname: '/ops/today' });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute(
      'href',
      '/ops/tools'
    );
    expect(screen.getByRole('link', { name: 'Errors' })).toHaveAttribute(
      'href',
      '/ops/errors'
    );
  });

  it('shows the unread message count on More while it is closed', async () => {
    listContactMessages.mockResolvedValue([
      { id: 1, is_acknowledged: false },
      { id: 2, is_acknowledged: true },
      { id: 3, is_acknowledged: false },
    ]);
    renderSidebar({ ops: true, pathname: '/ops/today' });
    expect(
      await screen.findByRole('button', { name: 'More, 2 unread' })
    ).toBeInTheDocument();
  });

  it('moves the unread count to the Messages row once More is open', async () => {
    listContactMessages.mockResolvedValue([{ id: 1, is_acknowledged: false }]);
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    expect(
      await screen.findByRole('link', { name: 'Messages, 1 unread' })
    ).toHaveAttribute('href', '/ops/messages');
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('shows no count when every message is acknowledged', async () => {
    listContactMessages.mockResolvedValue([{ id: 1, is_acknowledged: true }]);
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    await act(async () => {});
    expect(screen.getByRole('link', { name: 'Messages' })).toBeInTheDocument();
  });

  it('does not ask for messages while the Ops folder is closed', async () => {
    renderSidebar({ ops: true, pathname: '/upload' });
    await act(async () => {});
    expect(listContactMessages).not.toHaveBeenCalled();
  });

  it('auto-expands Ops and More when on a page kept under More', () => {
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    expect(screen.getByRole('button', { name: 'Ops' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('link', { name: 'System' })).toHaveAttribute(
      'href',
      '/ops/system'
    );
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute(
      'href',
      '/ops/tools'
    );
  });

  it('carries the shared ops window across ops rows', () => {
    renderSidebar({ ops: true, pathname: '/ops/growth?window=90d' });
    expect(screen.getByRole('link', { name: 'Business' })).toHaveAttribute(
      'href',
      '/ops/business?window=90d'
    );
    expect(screen.getByRole('link', { name: 'Flags' })).toHaveAttribute(
      'href',
      '/ops/flags?window=90d'
    );
  });

  it('drops a window outside the vocabulary from ops row links', () => {
    renderSidebar({ ops: true, pathname: '/ops/system?window=24h' });
    expect(screen.getByRole('link', { name: 'Business' })).toHaveAttribute(
      'href',
      '/ops/business'
    );
  });

  it('lists every ops row and none of the retired ones', () => {
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    for (const [label, href] of [
      ['Today', '/ops/today'],
      ['Business', '/ops/business'],
      ['Growth', '/ops/growth'],
      ['Flags', '/ops/flags'],
      ['System', '/ops/system'],
      ['Errors', '/ops/errors'],
      ['Messages', '/ops/messages'],
      ['Tools', '/ops/tools'],
      ['Showcase', '/ops/showcase'],
    ] as const) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        href
      );
    }
    for (const retired of [
      'Commands',
      'Users',
      'Engineering',
      'Performance',
      'Conversions',
      'Upload funnel',
      'Return rate',
      'Interviews',
      'Pricing A/B',
      'Mindmaps',
    ]) {
      expect(
        screen.queryByRole('link', { name: retired })
      ).not.toBeInTheDocument();
    }
  });

  it('marks exactly the current row active', () => {
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    expect(screen.getByRole('link', { name: 'Errors' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'System' })).not.toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('marks Today active on the /ops index', () => {
    renderSidebar({ ops: true, pathname: '/ops' });
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Business' })).not.toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('falls back to a single Ops link when the sidebar is collapsed', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    expect(screen.getByRole('link', { name: 'Ops' })).toHaveAttribute(
      'href',
      '/ops'
    );
    expect(
      screen.queryByRole('button', { name: 'Ops' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Errors' })
    ).not.toBeInTheDocument();
  });
});

describe('Sidebar active state', () => {
  it('marks the My Decks row active on /downloads', () => {
    renderSidebar({ pathname: '/downloads' });
    expect(screen.getByRole('link', { name: 'My decks' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      screen.getByRole('link', { name: 'Make flashcards' })
    ).not.toHaveAttribute('aria-current', 'page');
  });

  it('marks the My Decks row active on a /downloads sub-route', () => {
    renderSidebar({ pathname: '/downloads/123' });
    expect(screen.getByRole('link', { name: 'My decks' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('Sidebar group hierarchy', () => {
  it('labels the More tools group', () => {
    renderSidebar();
    expect(screen.getByText('More tools')).toBeInTheDocument();
  });

  it('keeps account, usage, theme and legal links out of the sidebar', () => {
    renderSidebar();
    expect(
      screen.queryByRole('link', { name: /log out/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Privacy' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('alexander@alemayhu.com')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('orders the top feature group by visit frequency (Upload, Notion, Note types first)', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation');
    const hrefs = Array.from(nav.querySelectorAll('a')).map((a) =>
      a.getAttribute('href')
    );
    const upload = hrefs.indexOf('/upload');
    const notion = hrefs.indexOf('/notion');
    const templates = hrefs.indexOf('/templates');
    const importRoute = hrefs.indexOf('/import');
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(upload).toBeLessThan(notion);
    expect(notion).toBeLessThan(templates);
    expect(templates).toBeLessThan(importRoute);
  });

  it('omits the Admin group label when no admin flags are on', () => {
    renderSidebar();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('does not render Admin group label even when ops is on', () => {
    renderSidebar({ ops: true });
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});

describe('Sidebar collapse toggle', () => {
  beforeEachReset();

  it('defaults to expanded when localStorage has no preference', () => {
    renderSidebar();
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' })
    ).toBeInTheDocument();
  });

  it('toggles the data-collapsed attribute on click', () => {
    renderSidebar();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    fireEvent.click(toggle);
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' })
    ).toBeInTheDocument();
  });

  it('renders the collapse rail outside the sidebar aside element', () => {
    renderSidebar();
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    const rail = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(aside.contains(rail)).toBe(false);
  });

  it('renders the collapse rail as a sibling inside the component tree, not portaled to document.body', () => {
    const { container } = renderSidebar();
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    const rail = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(container.contains(rail)).toBe(true);
    expect(rail.parentElement).toBe(aside.parentElement);
    expect(document.body.contains(rail)).toBe(true);
  });

  it('renders the rail label, flipping between Collapse and Expand', () => {
    renderSidebar();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveTextContent('Collapse');
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' })
    ).toHaveTextContent('Expand');
  });

  it('persists the collapsed state to localStorage', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('sidebar.collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('sidebar.collapsed')).toBe('false');
  });

  it('reads the collapsed state from localStorage on mount', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    expect(aside).toHaveAttribute('data-collapsed', 'true');
  });
});

describe('Sidebar stays put while the reader is idle', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(track).mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it.each(['/upload', '/notion', '/downloads', '/mindmaps/abc123'])(
    'keeps the sidebar expanded on %s after minutes without input',
    (pathname) => {
      renderSidebar({ pathname });
      const aside = screen.getByRole('complementary', {
        name: 'Main navigation',
      });
      advance(5 * 60_000);
      expect(aside).toHaveAttribute('data-collapsed', 'false');
      expect(localStorage.getItem('sidebar.collapsed')).toBeNull();
    }
  );

  it('keeps a manual collapse after minutes without input', () => {
    renderSidebar({ pathname: '/upload' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    advance(5 * 60_000);
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem('sidebar.collapsed')).toBe('true');
  });

  it('records no sidebar event while the reader is idle', () => {
    renderSidebar({ pathname: '/upload' });
    advance(5 * 60_000);
    expect(track).not.toHaveBeenCalled();
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
    if (hasVisibleText && parentMixesElements) {
      offenders.push(node.textContent ?? '');
    }
    node = walker.nextNode();
  }
  return offenders;
};

const wrapTextNodesInFont = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node != null) {
    if ((node.textContent ?? '').trim().length > 0) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const font = document.createElement('font');
    textNode.parentNode?.insertBefore(font, textNode);
    font.appendChild(textNode);
  }
};

describe('Sidebar collapse rail survives browser translation', () => {
  beforeEachReset();

  it('renders no bare text nodes next to the rail icon when expanded', () => {
    renderSidebar();
    const rail = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collectUnwrappedTextNodes(rail)).toEqual([]);
  });

  it('renders no bare text nodes next to the rail icon when collapsed', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    const rail = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(collectUnwrappedTextNodes(rail)).toEqual([]);
  });

  it('toggles after a translation tool wraps the rail text in font tags', () => {
    renderSidebar();
    const rail = screen.getByRole('button', { name: 'Collapse sidebar' });
    wrapTextNodesInFont(rail);
    fireEvent.click(rail);
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' })
    ).toBeInTheDocument();
  });
});
