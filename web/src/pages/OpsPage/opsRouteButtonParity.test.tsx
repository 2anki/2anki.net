import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import CommandsTab from './CommandsTab';
import FlagsTab from './FlagsTab';
import ShowcaseTab from './ShowcaseTab';
import UsersTab from './UsersTab';

const OPS_ROUTER = join(__dirname, '../../../../src/routes/OpsRouter.ts');
const APP = join(__dirname, '../../App.tsx');

const POST_OPS_ROUTE = /router\.post\(\s*['"]([^'"]+)['"]/g;

const OPS_COMMAND_PAGES: Array<[string, ComponentType]> = [
  ['CommandsTab', CommandsTab],
  ['UsersTab', UsersTab],
  ['FlagsTab', FlagsTab],
  ['ShowcaseTab', ShowcaseTab],
];

const CLICK_ROUNDS = 4;

const FILL_VALUES: Record<string, string> = {
  number: '1',
  email: 'ops-check@example.com',
  text: 'ops-check',
};

const ANY_COMMAND_RESULT = {
  message: 'ok',
  count: 1,
  failed: 0,
  suppressed: 0,
  alreadyRunning: false,
  missingRows: 1,
  sampleKeys: [],
  deleted: 1,
  orphans: [],
  found: 0,
  emailed: 0,
  skippedRecentlyNotified: 0,
  skippedNoEmail: 0,
  granted: true,
  userId: 1,
  kind: 'week',
  expiresAt: '2026-01-01T00:00:00.000Z',
  blockIdIdentity: true,
  account: {
    userId: 1,
    createdAt: null,
    lastLoginAt: null,
    activeSubscription: false,
    activePass: null,
    jobs: 0,
    uploads: 0,
  },
};

function postOpsRoutes(): string[] {
  const source = readFileSync(OPS_ROUTER, 'utf8');
  const paths = Array.from(
    source.matchAll(POST_OPS_ROUTE),
    (match) => match[1]
  );
  return paths.filter((path) => path.startsWith('/api/ops/'));
}

function opsClientSource(): string {
  const entries = readdirSync(__dirname, { recursive: true }) as string[];
  return entries
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => readFileSync(join(__dirname, name), 'utf8'))
    .join('\n');
}

function isDryRun(url: string, init?: RequestInit): boolean {
  if (url.includes('dryRun=true')) return true;
  if (typeof init?.body !== 'string') return false;
  const body = JSON.parse(init.body) as { dryRun?: unknown };
  return body.dryRun === true;
}

function responseBody(url: string, init?: RequestInit): unknown {
  if (url === '/api/ops/flags') return [];
  if (url === '/api/showcase') return {};
  return { ...ANY_COMMAND_RESULT, dryRun: isDryRun(url, init) };
}

function fillEveryInput(container: HTMLElement) {
  for (const input of Array.from(container.querySelectorAll('input'))) {
    if (input.type === 'checkbox') {
      if (!input.checked && input.getAttribute('role') !== 'switch') {
        fireEvent.click(input);
      }
      continue;
    }
    const value = FILL_VALUES[input.type];
    if (value != null && input.value !== value) {
      fireEvent.change(input, { target: { value } });
    }
  }
}

async function clickEveryEnabledButton(container: HTMLElement) {
  for (const button of Array.from(container.querySelectorAll('button'))) {
    if (button.disabled || !button.isConnected) continue;
    await act(async () => {
      fireEvent.click(button);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function postedPaths(fetchMock: ReturnType<typeof vi.fn>): Set<string> {
  const paths = fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url]) => String(url).split('?')[0]);
  return new Set(paths);
}

async function workThroughEveryPage(
  fetchMock: ReturnType<typeof vi.fn>
): Promise<Set<string>> {
  for (const [, Page] of OPS_COMMAND_PAGES) {
    const { container, unmount } = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    for (let round = 0; round < CLICK_ROUNDS; round += 1) {
      fillEveryInput(container);
      await clickEveryEnabledButton(container);
    }
    unmount();
  }
  return postedPaths(fetchMock);
}

describe('every POST /api/ops route in OpsRouter has an ops page button', () => {
  const routes = postOpsRoutes();

  it('extraction reads router.post("/api/ops/…") paths from OpsRouter source text', () => {
    expect(routes).toContain('/api/ops/send-inactivity-warnings');
    expect(routes).toContain('/api/ops/delete-inactive-users');
    expect(routes.length).toBeGreaterThanOrEqual(7);
  });

  it.each(OPS_COMMAND_PAGES.map(([name]) => name))(
    '%s is mounted as an /ops child route in App.tsx',
    (name) => {
      expect(readFileSync(APP, 'utf8')).toMatch(
        new RegExp(`<Route\\s+path="[a-z-]+"\\s+element=\\{<${name} />\\}`)
      );
    }
  );

  it.each(routes)(
    'POST %s appears as a fetch URL in a non-test web/src/pages/OpsPage module',
    (route) => {
      expect(opsClientSource()).toContain(route);
    }
  );

  describe('clicking through every ops command page', () => {
    const originalFetch = globalThis.fetch;
    let posted = new Set<string>();

    beforeAll(async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async (url: string, init?: RequestInit) => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => responseBody(url, init),
        }));
      globalThis.fetch = fetchMock;
      vi.spyOn(globalThis, 'confirm').mockImplementation(() => true);
      posted = await workThroughEveryPage(fetchMock);
    }, 20_000);

    afterAll(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it.each(routes)('POST %s is sent by a button on an ops page', (route) => {
      expect([...posted]).toContain(route);
    });
  });
});
