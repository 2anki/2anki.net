import { vi, type Mock } from 'vitest';
import type { Request, Response } from 'express';

import NotionController from './NotionController';
import { NotionService } from '../services/NotionService/NotionService';
import type { INotionRepository } from '../data_layer/NotionRespository';
import instrumentedAxios from '../services/observability/instrumentedAxios';
import {
  NOTION_CONNECT_STATE_COOKIE,
  NOTION_STATE_COOKIE,
} from '../lib/auth/oauthState';

vi.mock('../services/events/track', () => ({ track: vi.fn() }));
vi.mock('../services/observability/instrumentedAxios', () => ({
  default: { post: vi.fn() },
}));

const OWNER = 42;
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

type FakeRes = Response & {
  redirect: Mock;
  cookie: Mock;
  clearCookie: Mock;
  status: Mock;
  json: Mock;
  send: Mock;
};

function fakeRes(owner: number | null = OWNER): FakeRes {
  const res = {
    locals: owner == null ? {} : { owner },
    redirect: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res as unknown as FakeRes;
}

function fakeReq(
  query: Record<string, unknown>,
  cookies: Record<string, unknown> = {}
): Request {
  return { query, cookies } as unknown as Request;
}

function build() {
  const repo: INotionRepository = {
    getNotionData: vi.fn().mockResolvedValue(null),
    saveNotionToken: vi.fn().mockResolvedValue(true),
    getNotionToken: vi.fn().mockResolvedValue(null),
    deleteBlocksByOwner: vi.fn().mockResolvedValue(0),
    deleteNotionData: vi.fn().mockResolvedValue(true),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
  };
  const controller = new NotionController(new NotionService(repo));
  return { controller, repo };
}

function startConnect(controller: NotionController) {
  const res = fakeRes();
  controller.startConnect(fakeReq({}), res);
  const location = res.redirect.mock.calls[0]?.[0] as string;
  const issued = res.cookie.mock.calls.find(
    ([name]) => name === NOTION_CONNECT_STATE_COOKIE
  );
  return { res, location, issued };
}

const notionTokenExchanges = () =>
  (instrumentedAxios.post as Mock).mock.calls.filter(
    ([, url]) => url === NOTION_TOKEN_URL
  );

beforeEach(() => {
  vi.stubEnv('NOTION_CLIENT_ID', 'client-abc');
  vi.stubEnv('NOTION_CLIENT_SECRET', 'secret-xyz');
  vi.stubEnv('NOTION_REDIRECT_URI', 'https://2anki.net/api/notion/connect');
  vi.stubEnv('SECRET', 'connect-state-secret');
  (instrumentedAxios.post as Mock).mockReset();
  (instrumentedAxios.post as Mock).mockResolvedValue({
    data: { access_token: 'notion-token', workspace_name: 'Workspace' },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('web Notion connect binds its state to the browser', () => {
  it.each([
    ['a signed-in user', OWNER],
    ['a signed-out visitor', null],
  ])(
    'get-notion-link hands %s a same-origin start path, not a Notion URL',
    async (_who, owner) => {
      const { controller } = build();
      const res = fakeRes(owner);

      await controller.getNotionLink(fakeReq({}), res);

      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({ link: '/api/notion/connect/init' })
      );
      expect(res.cookie).not.toHaveBeenCalled();
    }
  );

  it('the start path sends the browser to Notion with a connect: state and a ten-minute httpOnly Lax cookie', () => {
    const { controller } = build();

    const { location, issued } = startConnect(controller);

    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.notion.com/v1/oauth/authorize'
    );
    expect(url.searchParams.get('client_id')).toBe('client-abc');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://2anki.net/api/notion/connect'
    );
    const nonce = issued?.[1] as string;
    expect(url.searchParams.get('state')).toBe(`connect:${nonce}`);
    expect(issued?.[2]).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
  });

  it('marks the start cookie Secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { controller } = build();

    const { issued } = startConnect(controller);

    expect(issued?.[2]).toMatchObject({ secure: true });
  });

  it.each(['NOTION_CLIENT_ID', 'NOTION_REDIRECT_URI'])(
    'sends the browser back to /notion when %s is unset',
    (name) => {
      vi.stubEnv(name, '');
      const { controller } = build();

      const { res, issued } = startConnect(controller);

      expect(res.redirect).toHaveBeenCalledWith('/notion');
      expect(issued).toBeUndefined();
    }
  );

  it('connects the workspace when the callback state matches the cookie it was handed', async () => {
    const { controller, repo } = build();
    const { location, issued } = startConnect(controller);
    const state = new URL(location).searchParams.get('state');
    const res = fakeRes();

    await controller.connect(
      fakeReq(
        { code: 'auth-code', state },
        { [NOTION_CONNECT_STATE_COOKIE]: issued?.[1] }
      ),
      res
    );

    expect(notionTokenExchanges()).toHaveLength(1);
    expect(repo.saveNotionToken).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ access_token: 'notion-token' }),
      expect.any(Function)
    );
    expect(res.redirect).toHaveBeenCalledWith('/notion');
    expect(res.clearCookie).toHaveBeenCalledWith(
      NOTION_CONNECT_STATE_COOKIE,
      expect.objectContaining({ httpOnly: true, path: '/' })
    );
  });

  it.each([
    ['no state and no cookie', {}, {}],
    [
      'no state, with a cookie',
      {},
      { [NOTION_CONNECT_STATE_COOKIE]: 'nonce-1' },
    ],
    ['a state but no cookie', { state: 'connect:nonce-1' }, {}],
    [
      'a wrong state',
      { state: 'connect:nonce-2' },
      { [NOTION_CONNECT_STATE_COOKIE]: 'nonce-1' },
    ],
    [
      'the bare nonce without the connect: prefix',
      { state: 'nonce-1' },
      { [NOTION_CONNECT_STATE_COOKIE]: 'nonce-1' },
    ],
    [
      'an empty cookie and an empty nonce',
      { state: 'connect:' },
      { [NOTION_CONNECT_STATE_COOKIE]: '' },
    ],
  ])(
    'refuses a web callback with %s and links no workspace',
    async (_case, query, cookies) => {
      const { controller, repo } = build();
      const res = fakeRes();

      await controller.connect(
        fakeReq({ code: 'auth-code', ...query }, cookies),
        res
      );

      expect(notionTokenExchanges()).toHaveLength(0);
      expect(repo.saveNotionToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/notion');
      expect(res.clearCookie).toHaveBeenCalledWith(
        NOTION_CONNECT_STATE_COOKIE,
        expect.objectContaining({ httpOnly: true, path: '/' })
      );
    }
  );

  it('clears the connect cookie when the user cancels on Notion and no code comes back', async () => {
    const { controller, repo } = build();
    const res = fakeRes();

    await controller.connect(
      fakeReq(
        { error: 'access_denied', state: 'connect:nonce-1' },
        { [NOTION_CONNECT_STATE_COOKIE]: 'nonce-1' }
      ),
      res
    );

    expect(repo.saveNotionToken).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/notion');
    expect(res.clearCookie).toHaveBeenCalledWith(
      NOTION_CONNECT_STATE_COOKIE,
      expect.objectContaining({ httpOnly: true, path: '/' })
    );
  });

  it('a state minted for one browser cannot connect in another', async () => {
    const { controller, repo } = build();
    const { location } = startConnect(controller);
    const victimState = new URL(location).searchParams.get('state');
    const { issued: otherBrowserCookie } = startConnect(controller);
    const res = fakeRes();

    await controller.connect(
      fakeReq(
        { code: 'auth-code', state: victimState },
        { [NOTION_CONNECT_STATE_COOKIE]: otherBrowserCookie?.[1] }
      ),
      res
    );

    expect(repo.saveNotionToken).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/notion');
  });

  it('still answers 401 to a signed-out callback and links nothing', async () => {
    const { controller, repo } = build();
    const { location, issued } = startConnect(controller);
    const state = new URL(location).searchParams.get('state');
    const res = fakeRes(null);

    await controller.connect(
      fakeReq(
        { code: 'auth-code', state },
        { [NOTION_CONNECT_STATE_COOKIE]: issued?.[1] }
      ),
      res
    );

    expect(repo.saveNotionToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalledWith(
      NOTION_CONNECT_STATE_COOKIE,
      expect.objectContaining({ httpOnly: true })
    );
  });

  it('leaves the Notion sign-in state and its cookie to the sign-in callback', async () => {
    const { controller, repo } = build();
    const res = fakeRes();

    await controller.connect(
      fakeReq(
        { code: 'auth-code', state: 'login:nonce-1' },
        { [NOTION_STATE_COOKIE]: 'nonce-1' }
      ),
      res
    );

    expect(repo.saveNotionToken).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      '/api/users/auth/notion?code=auth-code&state=login%3Anonce-1'
    );
  });
});
