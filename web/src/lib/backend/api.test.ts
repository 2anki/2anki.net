import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { get } from './api';
import { UserNotice } from '../errors/UserNotice';

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('location', { origin: 'http://localhost', pathname: '/' });
  fetchSpy.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api.get error tagging', () => {
  it('tags a 5xx error message with the request path', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'boom' }), { status: 503 })
    );

    await expect(get('http://localhost/api/jobs')).rejects.toThrowError(
      /GET \/api\/jobs/
    );
  });

  it('attaches url, method, and status as properties on the thrown error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'boom' }), { status: 503 })
    );

    let caught:
      | (Error & { url?: string; method?: string; status?: number })
      | undefined;
    try {
      await get('http://localhost/api/uploads');
    } catch (e) {
      caught = e as Error & {
        url?: string;
        method?: string;
        status?: number;
      };
    }

    expect(caught?.url).toBe('/api/uploads');
    expect(caught?.method).toBe('GET');
    expect(caught?.status).toBe(503);
  });

  it('tags a 404 with the method and request path', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 404, statusText: 'Not Found' })
    );

    await expect(
      get('http://localhost/api/notion/page/abc')
    ).rejects.toThrowError(
      /Resource not found: GET \/api\/notion\/page\/abc status: 404/
    );
  });

  it('tags network failures with the URL', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(get('http://localhost/api/jobs')).rejects.toThrowError(
      /GET \/api\/jobs/
    );
  });

  it('throws UserNotice for an intentional backend message', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Notion is not connected.' }), {
        status: 409,
      })
    );

    await expect(get('http://localhost/api/notion/me')).rejects.toBeInstanceOf(
      UserNotice
    );
  });

  it('a notion_unauthorized 401 keeps the session — no /login bounce, code preserved', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/notion',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'API token is invalid.',
          code: 'notion_unauthorized',
        }),
        { status: 401 }
      )
    );

    let caught: UserNotice | undefined;
    try {
      await get('http://localhost/api/notion/search');
    } catch (e) {
      caught = e as UserNotice;
    }

    expect(caught).toBeInstanceOf(UserNotice);
    expect(caught?.code).toBe('notion_unauthorized');
    expect(location.href).toBe('');
  });

  it('a bare 401 still redirects to /login', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/search',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication required' }), {
        status: 401,
      })
    );

    await expect(
      get('http://localhost/api/notion/search')
    ).rejects.toBeInstanceOf(UserNotice);
    expect(location.href).toBe('/login');
  });

  it('a 401 on the password reset page does not bounce to /login', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/users/r/abc123resettoken',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication required' }), {
        status: 401,
      })
    );

    await expect(get('http://localhost/api/users/me')).rejects.toBeInstanceOf(
      UserNotice
    );
    expect(location.href).toBe('');
  });

  it('a 401 on the public note-type gallery does not bounce to /login', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/templates',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication required' }), {
        status: 401,
      })
    );

    await expect(
      get('http://localhost/api/templates/user')
    ).rejects.toBeInstanceOf(UserNotice);
    expect(location.href).toBe('');
  });

  it('a 401 on the bare reset path does not bounce to /login', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/users/r',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication required' }), {
        status: 401,
      })
    );

    await expect(get('http://localhost/api/users/me')).rejects.toBeInstanceOf(
      UserNotice
    );
    expect(location.href).toBe('');
  });

  it('a 401 on an authed path that merely shares the reset prefix still bounces', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/users/recent',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication required' }), {
        status: 401,
      })
    );

    await expect(get('http://localhost/api/users/me')).rejects.toBeInstanceOf(
      UserNotice
    );
    expect(location.href).toBe('/login');
  });

  it('a 401 on the account page bounces to /login', async () => {
    const location = {
      origin: 'http://localhost',
      pathname: '/account',
      href: '',
    };
    vi.stubGlobal('location', location);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication required' }), {
        status: 401,
      })
    );

    await expect(get('http://localhost/api/users/me')).rejects.toBeInstanceOf(
      UserNotice
    );
    expect(location.href).toBe('/login');
  });

  it('throws UserNotice with code when present', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'API token is invalid.',
          code: 'notion_unauthorized',
        }),
        { status: 409 }
      )
    );

    let caught: UserNotice | undefined;
    try {
      await get('http://localhost/api/notion/search');
    } catch (e) {
      caught = e as UserNotice;
    }

    expect(caught).toBeInstanceOf(UserNotice);
    expect(caught?.code).toBe('notion_unauthorized');
  });
});
