import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

import { getCardUsage } from '../../lib/backend/getCardUsage';

vi.mock('../../lib/backend/getCardUsage', () => ({
  getCardUsage: vi.fn().mockResolvedValue({
    cards_used: 23,
    cards_limit: 100,
    unlimited: false,
  }),
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
  onLogOut?: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
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
  onLogOut = vi.fn(),
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
          onLogOut={onLogOut}
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
    expect(screen.getByRole('link', { name: 'My Decks' })).toHaveAttribute(
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
  it('shows Settings for every logged-in user', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/card-options'
    );
  });

  it('marks Settings active on /card-options', () => {
    renderSidebar({ pathname: '/card-options' });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

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

describe('Sidebar help group', () => {
  it('always shows Docs', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute(
      'href',
      '/documentation'
    );
  });

  it('shows Pricing only for free users', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    );
  });

  it('hides Pricing for paying users', () => {
    renderSidebar({ subscriber: true });
    expect(
      screen.queryByRole('link', { name: 'Pricing' })
    ).not.toBeInTheDocument();
  });

  it('does not render a Billing row for paying users', () => {
    renderSidebar({ patreon: true });
    expect(
      screen.queryByRole('link', { name: 'Billing' })
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
  beforeEach(() => localStorage.clear());
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
    expect(screen.getByRole('link', { name: 'Errors' })).toHaveAttribute(
      'href',
      '/ops/errors'
    );
  });

  it('auto-expands and lists every ops tab when on an /ops route', () => {
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    expect(screen.getByRole('button', { name: 'Ops' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('link', { name: 'System' })).toHaveAttribute(
      'href',
      '/ops/system'
    );
    expect(screen.getByRole('link', { name: 'Commands' })).toHaveAttribute(
      'href',
      '/ops/commands'
    );
  });

  it('lists the seven consolidated rows and none of the retired ones', () => {
    renderSidebar({ ops: true, pathname: '/ops/errors' });
    for (const [label, href] of [
      ['Today', '/ops/today'],
      ['Growth', '/ops/growth'],
      ['Business', '/ops/business'],
      ['System', '/ops/system'],
      ['Errors', '/ops/errors'],
      ['Messages', '/ops/messages'],
      ['Commands', '/ops/commands'],
    ] as const) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        href
      );
    }
    for (const retired of [
      'Engineering',
      'Performance',
      'Conversions',
      'Upload funnel',
      'Return rate',
      'Flags',
      'Showcase',
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

  it('marks System active on the /ops index', () => {
    renderSidebar({ ops: true, pathname: '/ops' });
    expect(screen.getByRole('link', { name: 'System' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Errors' })).not.toHaveAttribute(
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

describe('Sidebar identity block', () => {
  it('renders the email and plan label', () => {
    renderSidebar({ email: 'alexander@alemayhu.com', patreon: true });
    expect(screen.getByText('alexander@alemayhu.com')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });

  it('shows Free when neither plan flag is set', () => {
    renderSidebar();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('renders Account and Log out as first-class rows', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/account'
    );
    expect(screen.getByRole('link', { name: /log out/i })).toBeInTheDocument();
  });

  it('fires onLogOut when the Log out row is clicked', () => {
    const onLogOut = vi.fn();
    renderSidebar({ onLogOut });
    fireEvent.click(screen.getByRole('link', { name: /log out/i }));
    expect(onLogOut).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar active state', () => {
  it('marks the My Decks row active on /downloads', () => {
    renderSidebar({ pathname: '/downloads' });
    expect(screen.getByRole('link', { name: 'My Decks' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      screen.getByRole('link', { name: 'Make flashcards' })
    ).not.toHaveAttribute('aria-current', 'page');
  });

  it('marks the Account row active on /account', () => {
    renderSidebar({ pathname: '/account' });
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('marks the My Decks row active on a /downloads sub-route', () => {
    renderSidebar({ pathname: '/downloads/123' });
    expect(screen.getByRole('link', { name: 'My Decks' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('Sidebar group hierarchy', () => {
  it('labels the Library and Resources groups', () => {
    renderSidebar();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Resources')).toBeInTheDocument();
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

describe('Sidebar cards-used counter', () => {
  beforeEach(() => {
    vi.mocked(getCardUsage).mockClear();
  });

  it('renders the counter for free users with the fetched usage', async () => {
    renderSidebar();
    await waitFor(() => expect(screen.getByText('23')).toBeInTheDocument());
    expect(screen.getByText('/ 100 cards this month')).toBeInTheDocument();
  });

  it('does not render the counter for paying users', async () => {
    renderSidebar({ subscriber: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(
      screen.queryByText('/ 100 cards this month')
    ).not.toBeInTheDocument();
  });

  it('does not call getCardUsage when locals is null (unauthenticated visitor)', async () => {
    renderSidebar({ locals: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(getCardUsage).not.toHaveBeenCalled();
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

describe('Sidebar auto-minimize', () => {
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

  it('auto-minimizes on /upload after 20 seconds of sidebar inactivity', () => {
    renderSidebar({ pathname: '/upload' });
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    advance(20_000);
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(track).toHaveBeenCalledWith('sidebar_auto_minimize_fired');
  });

  it('does not auto-minimize on a non-workflow route', () => {
    renderSidebar({ pathname: '/account' });
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    advance(60_000);
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    expect(track).not.toHaveBeenCalled();
  });

  it('does not touch localStorage when auto-minimizing', () => {
    renderSidebar({ pathname: '/upload' });
    advance(20_000);
    expect(localStorage.getItem('sidebar.collapsed')).toBeNull();
  });

  it('resets the timer when the user hovers the sidebar', () => {
    renderSidebar({ pathname: '/upload' });
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    advance(15_000);
    fireEvent.mouseEnter(aside);
    advance(15_000);
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    advance(10_000);
    expect(aside).toHaveAttribute('data-collapsed', 'true');
  });

  it('pins the sidebar when the user manually expands after auto-minimize', () => {
    renderSidebar({ pathname: '/upload' });
    const aside = screen.getByRole('complementary', {
      name: 'Main navigation',
    });
    advance(20_000);
    expect(aside).toHaveAttribute('data-collapsed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    expect(localStorage.getItem('sidebar.collapsed')).toBeNull();

    advance(60_000);
    expect(aside).toHaveAttribute('data-collapsed', 'false');
  });

  it('fires the reverted event when the user expands within 60s of auto-collapse', () => {
    renderSidebar({ pathname: '/upload' });
    advance(20_000);
    vi.mocked(track).mockClear();
    advance(5_000);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(track).toHaveBeenCalledWith('sidebar_auto_minimize_reverted');
  });

  it('does not auto-minimize when the user already has a persisted collapsed preference', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar({ pathname: '/upload' });
    advance(20_000);
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

describe('Sidebar More block', () => {
  it('renders the footer links', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      '/about'
    );
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute(
      'href',
      '/contact'
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/documentation/misc/terms-of-service'
    );
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/documentation/misc/privacy-policy'
    );
  });
});
