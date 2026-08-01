import { afterEach, describe, expect, it, vi } from 'vitest';
import { Backend } from './Backend';

vi.mock('./api', () => ({
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  redirectToLogin: vi.fn(),
}));

describe('Backend.contactUs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('always sends the honeypot field, empty for humans', async () => {
    const fetchMock = stubFetch();

    await new Backend().contactUs('A', 'a@example.com', 'hello there');

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('website')).toBe('');
    expect(body.get('name')).toBe('A');
    expect(body.get('email')).toBe('a@example.com');
    expect(body.get('message')).toBe('hello there');
  });

  it('forwards a filled honeypot value untouched', async () => {
    const fetchMock = stubFetch();

    await new Backend().contactUs(
      'Bot',
      'bot@example.com',
      'buy things',
      [],
      'https://spam.example.ru'
    );

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('website')).toBe('https://spam.example.ru');
  });
});
