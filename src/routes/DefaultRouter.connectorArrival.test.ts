import { vi, type Mock } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { mountWebBuild } from '../lib/mountWebBuild';
import { isKnownAppRoute } from './knownRoutes';
import IndexController from '../controllers/IndexController/IndexController';
import { track } from '../services/events/track';
import type { SessionResolver } from '../usecases/mcp/RecordConnectorArrivalUseCase';

const { buildDir } = vi.hoisted(() => {
  const nodeFs = require('node:fs') as typeof import('node:fs');
  const nodeOs = require('node:os') as typeof import('node:os');
  const nodePath = require('node:path') as typeof import('node:path');
  return {
    buildDir: nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), 'connector-arrival-')
    ),
  };
});

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

vi.mock('../controllers/IndexController/getIndexFileContents', () => ({
  getIndexFileContents: () => '<html><head></head><body>shell</body></html>',
}));

vi.mock(
  '../controllers/IndexController/getPrerenderedPage',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../controllers/IndexController/getPrerenderedPage')
      >();
    return {
      getPrerenderedPage: (requestPath: string) =>
        actual.getPrerenderedPage(requestPath, buildDir),
    };
  }
);

const trackMock = track as Mock;
const PRICING_HTML = '<html><head></head><body>pricing page</body></html>';
const VALID_SESSION = 'valid-session';
const CONNECTOR_LINK = '/pricing/?ref=mcp&k=partial&a=b&held_until=2026-11-25';
const BROWSER_NAVIGATION = {
  returned: false,
  fetch_site: 'cross-site',
  prefetch: false,
  ua_class: 'browser',
};
const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const sessions: SessionResolver = {
  getUserFrom: vi.fn(async (token: string) =>
    token === VALID_SESSION
      ? ({ id: 42, owner: 42 } as Awaited<
          ReturnType<SessionResolver['getUserFrom']>
        >)
      : null
  ),
};

function mainCatchAll(): express.Router {
  const controller = new IndexController();
  const router = express.Router();
  router.get(/^\/(?!api).*/, (req, res) => {
    if (!isKnownAppRoute(req.path)) {
      res.status(404);
    }
    controller.getIndex(req, res);
  });
  return router;
}

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function buildApp(
  router: express.Router,
  withWebBuild = true
): Promise<{ server: http.Server; url: string }> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  if (withWebBuild) {
    mountWebBuild(app, buildDir);
  }
  app.use(router);
  return listen(app);
}

interface Snapshot {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function snapshot(
  base: string,
  pathAndQuery: string,
  init: RequestInit = {}
): Promise<Snapshot> {
  const res = await fetch(`${base}${pathAndQuery}`, {
    redirect: 'manual',
    ...init,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (key !== 'date' && key !== 'keep-alive') {
      headers[key] = value;
    }
  });
  return { status: res.status, headers, body: await res.text() };
}

function rawGet(
  base: string,
  pathAndQuery: string,
  headers: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}${pathAndQuery}`, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', reject);
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function visit(base: string, pathAndQuery: string, init: RequestInit = {}) {
  return fetch(`${base}${pathAndQuery}`, {
    redirect: 'manual',
    ...init,
    headers: {
      'user-agent': BROWSER,
      'sec-fetch-site': 'cross-site',
      ...(init.headers ?? {}),
    },
  });
}

describe('recording a connector link arrival on /pricing', () => {
  let current: { server: http.Server; url: string };
  let main: { server: http.Server; url: string };
  let devServer: { server: http.Server; url: string };

  beforeAll(async () => {
    fs.mkdirSync(path.join(buildDir, 'pricing'), { recursive: true });
    fs.writeFileSync(
      path.join(buildDir, 'pricing', 'index.html'),
      PRICING_HTML
    );
    const { default: DefaultRouter } = await import('./DefaultRouter');
    current = await buildApp(DefaultRouter(() => sessions));
    main = await buildApp(mainCatchAll());
    devServer = await buildApp(
      DefaultRouter(() => sessions),
      false
    );
  });

  afterAll(() => {
    current.server.close();
    main.server.close();
    devServer.server.close();
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    trackMock.mockReset();
  });

  it('records one signed-out arrival for the prerendered page', async () => {
    const res = await visit(current.url, CONNECTOR_LINK);

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('pricing page');
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock).toHaveBeenCalledWith('connector_link_arrived', {
      userId: null,
      anonymousId: null,
      props: {
        limit_kind: 'partial',
        arm: 'b',
        signed_in: false,
        held: true,
        ...BROWSER_NAVIGATION,
      },
    });
  });

  it('marks a provider-style sign-in return as returned, not as a first arrival', async () => {
    await visit(current.url, CONNECTOR_LINK);
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    const providerReturn = {
      headers: {
        cookie: `token=${VALID_SESSION}`,
        'sec-fetch-site': 'cross-site',
      },
    };
    const redirect = await visit(
      current.url,
      '/pricing?ref=mcp&k=partial&a=b&held_until=2026-11-25&r=1',
      providerReturn
    );
    expect(redirect.status).toBe(301);
    await visit(
      current.url,
      redirect.headers.get('location') as string,
      providerReturn
    );
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(2));

    expect(
      trackMock.mock.calls.map(([, options]) => [
        options.userId,
        options.props.signed_in,
        options.props.returned,
        options.props.fetch_site,
      ])
    ).toEqual([
      [null, false, false, 'cross-site'],
      [42, true, true, 'cross-site'],
    ]);
  });

  it.each(['&r=2', '&r=', '&r=1&r=1', '&r=yes'])(
    'records %s as not returned and stores no r value',
    async (marker) => {
      await visit(current.url, `${CONNECTOR_LINK}${marker}`, {
        headers: { cookie: `token=${VALID_SESSION}` },
      });

      await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
      const [, options] = trackMock.mock.calls[0];
      expect(options.props.returned).toBe(false);
      expect(JSON.stringify(options)).not.toMatch(/"r"|yes/);
    }
  );

  it.each([
    [
      'a chat client fetching the link',
      { 'user-agent': 'Mozilla/5.0 (compatible; Claude-User/1.0)' },
      { fetch_site: 'absent', prefetch: false, ua_class: 'fetcher' },
    ],
    [
      'a script fetching the link',
      { 'user-agent': 'python-requests/2.32.3' },
      { fetch_site: 'absent', prefetch: false, ua_class: 'fetcher' },
    ],
    [
      'a browser prefetch',
      { 'sec-purpose': 'prefetch', 'sec-fetch-site': 'none' },
      { fetch_site: 'none', prefetch: true, ua_class: 'browser' },
    ],
  ])('records %s with its request labels', async (_label, headers, labels) => {
    await rawGet(current.url, CONNECTOR_LINK, {
      'user-agent': BROWSER,
      ...headers,
    });

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock.mock.calls[0][1].props).toMatchObject(labels);
  });

  it('records a signed-in arrival under the user', async () => {
    await visit(current.url, CONNECTOR_LINK, {
      headers: { cookie: `token=${VALID_SESSION}` },
    });

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock).toHaveBeenCalledWith(
      'connector_link_arrived',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({ signed_in: true }),
      })
    );
  });

  it('counts an invalid session cookie as signed out', async () => {
    await visit(current.url, CONNECTOR_LINK, {
      headers: { cookie: 'token=expired-or-forged' },
    });

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock).toHaveBeenCalledWith(
      'connector_link_arrived',
      expect.objectContaining({
        userId: null,
        props: expect.objectContaining({ signed_in: false }),
      })
    );
  });

  it('keeps the anonymous id only when the visitor consented', async () => {
    await visit(current.url, CONNECTOR_LINK, {
      headers: { cookie: 'anon_id=anon-granted; cookie_consent=granted' },
    });
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    await visit(current.url, CONNECTOR_LINK, {
      headers: { cookie: 'anon_id=anon-denied; cookie_consent=denied' },
    });
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(2));
    await visit(current.url, CONNECTOR_LINK, {
      headers: { cookie: 'anon_id=anon-no-choice' },
    });
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(3));

    expect(
      trackMock.mock.calls.map(([, options]) => options.anonymousId)
    ).toEqual(['anon-granted', null, null]);
  });

  it('records the page request a /pricing link redirects to, once', async () => {
    const redirect = await visit(current.url, '/pricing?ref=mcp&k=limit&a=a');
    expect(redirect.status).toBe(301);
    const location = redirect.headers.get('location') as string;
    expect(location).toBe('/pricing/?ref=mcp&k=limit&a=a');
    await settle();
    expect(trackMock).not.toHaveBeenCalled();

    await visit(current.url, location);
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock).toHaveBeenCalledWith(
      'connector_link_arrived',
      expect.objectContaining({
        props: {
          limit_kind: 'limit',
          arm: 'a',
          signed_in: false,
          held: false,
          ...BROWSER_NAVIGATION,
        },
      })
    );
  });

  it.each(['/pricing?ref=mcp&k=held&a=a', '/pricing/?ref=mcp&k=held&a=a'])(
    'records %s when the router serves it directly',
    async (link) => {
      const res = await visit(devServer.url, link);

      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    }
  );

  it('records an old link without k or a as unknown', async () => {
    await visit(current.url, '/pricing/?ref=mcp&held_until=2026-11-09');

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock).toHaveBeenCalledWith(
      'connector_link_arrived',
      expect.objectContaining({
        props: {
          limit_kind: 'unknown',
          arm: 'unknown',
          signed_in: false,
          held: true,
          ...BROWSER_NAVIGATION,
        },
      })
    );
  });

  it('records a photo-limit link under its own kind', async () => {
    await visit(current.url, '/pricing/?ref=mcp&k=photo&a=a');

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(trackMock.mock.calls[0][1].props).toMatchObject({
      limit_kind: 'photo',
      arm: 'a',
    });
  });

  it.each([
    ['a HEAD request', CONNECTOR_LINK, { method: 'HEAD' }],
    [
      'a crawler',
      CONNECTOR_LINK,
      { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } },
    ],
    [
      'a link preview fetcher',
      CONNECTOR_LINK,
      { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } },
    ],
    ['a visit without the connector ref', '/pricing/?k=partial&a=b', {}],
    ['a visit with another ref', '/pricing/?ref=newsletter&k=partial', {}],
    ['another page with the connector ref', '/upload?ref=mcp&k=partial', {}],
    ['a ref in another case', '/pricing/?ref=MCP&k=partial&a=b', {}],
  ] as const)('records nothing for %s', async (_label, link, init) => {
    const res = await visit(current.url, link, init as RequestInit);

    expect(res.status).toBe(200);
    await settle();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('serves the page unchanged when recording throws', async () => {
    trackMock.mockImplementation(() => {
      throw new Error('sink down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const withFailure = await snapshot(current.url, CONNECTOR_LINK);
    const reference = await snapshot(main.url, CONNECTOR_LINK);

    expect(withFailure).toEqual(reference);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[connector-arrival] not recorded', {
        errorClass: 'Error',
      })
    );
    warn.mockRestore();
  });

  it('serves the page unchanged when the session lookup cannot be built', async () => {
    const { default: DefaultRouter } = await import('./DefaultRouter');
    const broken = await buildApp(
      DefaultRouter(() => {
        throw new Error('no database');
      })
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const withFailure = await snapshot(broken.url, CONNECTOR_LINK, {
      headers: { cookie: `token=${VALID_SESSION}` },
    });
    const reference = await snapshot(main.url, CONNECTOR_LINK, {
      headers: { cookie: `token=${VALID_SESSION}` },
    });

    expect(withFailure).toEqual(reference);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(trackMock).not.toHaveBeenCalled();
    warn.mockRestore();
    broken.server.close();
  });

  it.each([
    [CONNECTOR_LINK, {}],
    [CONNECTOR_LINK, { headers: { cookie: `token=${VALID_SESSION}` } }],
    [CONNECTOR_LINK, { method: 'HEAD' }],
    ['/pricing?ref=mcp&k=limit&a=a', {}],
    ['/pricing/', {}],
    ['/pricing/?interval=year', {}],
    ['/pricing/?ref=mcp', { headers: { 'if-none-match': 'W/"x"' } }],
  ] as const)(
    'answers %s exactly as the handler on main does',
    async (link, init) => {
      const withRecording = await snapshot(
        current.url,
        link,
        init as RequestInit
      );
      const reference = await snapshot(main.url, link, init as RequestInit);

      expect(withRecording).toEqual(reference);
    }
  );
});
