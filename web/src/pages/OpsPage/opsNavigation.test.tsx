import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Sidebar } from '../../components/AppShell/Sidebar';
import FlagsTab from './FlagsTab';
import OpsLayout from './OpsLayout';
import { OPS_TABS } from './opsTabs';
import ShowcaseTab from './ShowcaseTab';
import ToolsTab from './ToolsTab';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../lib/backend/getCardUsage', () => ({
  getCardUsage: vi.fn().mockResolvedValue({
    cards_used: 0,
    cards_limit: 100,
    unlimited: false,
  }),
}));

vi.mock('../../lib/backend/getAiCredits', () => ({
  getAiCredits: vi.fn().mockResolvedValue(null),
}));

interface OpsPageCase {
  label: string;
  path: string;
  component: string;
  Page: ComponentType;
  heading: string;
}

const SPLIT_PAGES: OpsPageCase[] = [
  {
    label: 'Tools',
    path: 'tools',
    component: 'ToolsTab',
    Page: ToolsTab,
    heading: 'Commands',
  },
  {
    label: 'Flags',
    path: 'flags',
    component: 'FlagsTab',
    Page: FlagsTab,
    heading: 'Flags',
  },
  {
    label: 'Showcase',
    path: 'showcase',
    component: 'ShowcaseTab',
    Page: ShowcaseTab,
    heading: 'Homepage showcase',
  },
];

const appSource = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');

function renderOpsAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar
          email="owner@example.com"
          locals={{ patreon: false, subscriber: false, autoSyncActive: false }}
          features={{ kiUI: false, ops: true }}
        />
        <Routes>
          <Route path="/ops" element={<OpsLayout />}>
            {SPLIT_PAGES.map(({ path: child, Page }) => (
              <Route key={child} path={child} element={<Page />} />
            ))}
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('the split ops command pages', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => (url === '/api/ops/flags' ? [] : {}),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test.each(SPLIT_PAGES)(
    'App.tsx mounts $component at /ops/$path',
    ({ path, component }) => {
      expect(appSource).toMatch(
        new RegExp(`<Route\\s+path="${path}"\\s+element=\\{<${component} />\\}`)
      );
    }
  );

  test.each(SPLIT_PAGES)(
    'the ops nav links to /ops/$path and the page shows "$heading"',
    async ({ label, path, heading }) => {
      renderOpsAt('/ops/today');

      if (screen.queryByRole('link', { name: label }) == null) {
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
      }
      fireEvent.click(screen.getByRole('link', { name: label }));

      expect(
        await screen.findByText(heading, { selector: 'p' })
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        `/ops/${path}`
      );
      expect(
        screen.getByText(label, { selector: '[aria-current="page"]:not(a)' })
      ).toBeInTheDocument();
    }
  );

  test('every split page has exactly one ops nav row', () => {
    for (const { label, path } of SPLIT_PAGES) {
      expect(OPS_TABS.filter((tab) => tab.to === `/ops/${path}`)).toEqual([
        expect.objectContaining({ label }),
      ]);
    }
  });

  test('the Tools page hosts the jobs and the per-account tools, not flags or showcase', async () => {
    renderOpsAt('/ops/tools');

    expect(
      await screen.findByText('Commands', { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByText('Users', { selector: 'p' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Grant unclaimed pass' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Homepage showcase')).toBeNull();
    expect(screen.queryByText('Flags', { selector: 'p' })).toBeNull();
  });
});
