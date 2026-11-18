import { vi, type Mock } from 'vitest';
import jwt from 'jsonwebtoken';

import AuthenticationService from '../../services/AuthenticationService';
import type TokenRepository from '../../data_layer/TokenRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import { track } from '../../services/events/track';
import {
  RecordConnectorArrivalUseCase,
  type ArrivalRequest,
} from './RecordConnectorArrivalUseCase';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

const trackMock = track as Mock;
const SECRET = 'arrival-test-secret';
const SIGNED_IN_USER = 42;

function sessionFor(userId: number, secret = SECRET): string {
  return jwt.sign({ userId }, secret);
}

const STORED_SESSION = sessionFor(SIGNED_IN_USER);

function authService(): AuthenticationService {
  const tokens = {
    getAccessTokenFromString: vi.fn(async (token: string) =>
      token === STORED_SESSION ? { owner: SIGNED_IN_USER, token } : undefined
    ),
  } as unknown as TokenRepository;
  const users = {
    getById: vi.fn(async (id: string) =>
      id === String(SIGNED_IN_USER) ? { id: SIGNED_IN_USER } : undefined
    ),
  } as unknown as UsersRepository;
  return new AuthenticationService(tokens, users);
}

const BROWSER_NAVIGATION: ArrivalRequest = {
  fetchSite: 'cross-site',
  prefetch: false,
  uaClass: 'browser',
};

const REQUEST_PROPS = {
  fetch_site: 'cross-site',
  prefetch: false,
  ua_class: 'browser',
};

function arrival(
  query: string,
  sessionToken: string | null = null,
  anonymousId: string | null = null,
  request: ArrivalRequest = BROWSER_NAVIGATION
) {
  return {
    query: new URLSearchParams(query),
    sessionToken,
    anonymousId,
    request,
  };
}

describe('RecordConnectorArrivalUseCase', () => {
  const previousSecret = process.env.SECRET;

  beforeEach(() => {
    process.env.SECRET = SECRET;
    trackMock.mockReset();
  });

  afterAll(() => {
    process.env.SECRET = previousSecret;
  });

  it('records a signed-in arrival under the user', async () => {
    await new RecordConnectorArrivalUseCase(authService()).execute(
      arrival(
        'ref=mcp&k=partial&a=b&held_until=2026-11-25',
        STORED_SESSION,
        'anon-1'
      )
    );

    expect(trackMock).toHaveBeenCalledWith('connector_link_arrived', {
      userId: SIGNED_IN_USER,
      anonymousId: 'anon-1',
      props: {
        limit_kind: 'partial',
        arm: 'b',
        signed_in: true,
        held: true,
        ...REQUEST_PROPS,
      },
    });
  });

  it('records a signed-out arrival with no user', async () => {
    await new RecordConnectorArrivalUseCase(authService()).execute(
      arrival('ref=mcp&k=limit&a=a')
    );

    expect(trackMock).toHaveBeenCalledWith('connector_link_arrived', {
      userId: null,
      anonymousId: null,
      props: {
        limit_kind: 'limit',
        arm: 'a',
        signed_in: false,
        held: false,
        ...REQUEST_PROPS,
      },
    });
  });

  it.each([
    ['signed with another secret', sessionFor(SIGNED_IN_USER, 'forged')],
    ['validly signed but not a stored session', sessionFor(7)],
    ['not a token at all', 'garbage'],
  ])(
    'counts a session cookie %s as signed out',
    async (_label, sessionToken) => {
      await new RecordConnectorArrivalUseCase(authService()).execute(
        arrival('ref=mcp&k=held&a=a&held_until=2026-11-25', sessionToken)
      );

      expect(trackMock).toHaveBeenCalledWith('connector_link_arrived', {
        userId: null,
        anonymousId: null,
        props: {
          limit_kind: 'held',
          arm: 'a',
          signed_in: false,
          held: true,
          ...REQUEST_PROPS,
        },
      });
    }
  );

  it.each([
    ['ref=mcp', 'unknown', 'unknown', false],
    ['ref=mcp&held_until=2026-11-25', 'unknown', 'unknown', true],
    ['ref=mcp&k=upgrade&a=c', 'unknown', 'unknown', false],
    ['ref=mcp&k=PARTIAL&a=B', 'unknown', 'unknown', false],
    ['ref=mcp&k=held&a=b&held_until=2026-13-40', 'held', 'b', false],
    ['ref=mcp&k=held&a=b&held_until=next-week', 'held', 'b', false],
    ['ref=mcp&k=photo&a=b', 'photo', 'b', false],
    ['ref=mcp&k=held&a=b&held_until=2020-01-01', 'held', 'b', true],
  ])(
    'reads %s as kind %s, arm %s, held %s',
    async (query, limitKind, arm, held) => {
      await new RecordConnectorArrivalUseCase(authService()).execute(
        arrival(query)
      );

      expect(trackMock).toHaveBeenCalledWith('connector_link_arrived', {
        userId: null,
        anonymousId: null,
        props: {
          limit_kind: limitKind,
          arm,
          signed_in: false,
          held,
          ...REQUEST_PROPS,
        },
      });
    }
  );

  it('stores nothing from the query string beyond its labels', async () => {
    await new RecordConnectorArrivalUseCase(authService()).execute(
      arrival(
        'ref=mcp&k=partial&a=b&held_until=2026-11-25&utm_source=x&id=99&email=a@b.c'
      )
    );

    const [, options] = trackMock.mock.calls[0];
    expect(Object.keys(options.props)).toEqual([
      'limit_kind',
      'arm',
      'signed_in',
      'held',
      'fetch_site',
      'prefetch',
      'ua_class',
    ]);
    expect(JSON.stringify(options)).not.toContain('2026-11-25');
  });

  it('records a fetcher prefetch with its request labels', async () => {
    await new RecordConnectorArrivalUseCase(authService()).execute(
      arrival('ref=mcp&k=limit&a=b', null, null, {
        fetchSite: 'absent',
        prefetch: true,
        uaClass: 'fetcher',
      })
    );

    expect(trackMock).toHaveBeenCalledWith('connector_link_arrived', {
      userId: null,
      anonymousId: null,
      props: {
        limit_kind: 'limit',
        arm: 'b',
        signed_in: false,
        held: false,
        fetch_site: 'absent',
        prefetch: true,
        ua_class: 'fetcher',
      },
    });
  });

  it('records nothing and resolves when the session lookup fails', async () => {
    const failing = {
      getUserFrom: vi.fn(async () => {
        throw new TypeError('connection lost');
      }),
    } as unknown as AuthenticationService;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      new RecordConnectorArrivalUseCase(failing).execute(
        arrival('ref=mcp&k=partial&a=b', STORED_SESSION)
      )
    ).resolves.toBeUndefined();

    expect(trackMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[connector-arrival] session lookup failed',
      { errorClass: 'TypeError' }
    );
    warn.mockRestore();
  });
});
