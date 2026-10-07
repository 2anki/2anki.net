import { vi } from 'vitest';
import { NotionService } from './NotionService';
import type { INotionRepository } from '../../data_layer/NotionRespository';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeService() {
  const stubRepo: INotionRepository = {
    getNotionData: vi.fn().mockResolvedValue(null),
    saveNotionToken: vi.fn().mockResolvedValue(true),
    getNotionToken: vi.fn().mockResolvedValue(null),
    deleteBlocksByOwner: vi.fn().mockResolvedValue(0),
    deleteNotionData: vi.fn().mockResolvedValue(true),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
  };
  return new NotionService(stubRepo);
}

test('includes client_id, response_type, owner, and redirect_uri', () => {
  process.env.NOTION_CLIENT_ID = 'client-abc';
  process.env.NOTION_REDIRECT_URI = 'https://2anki.net/api/notion/connect';

  const url = new URL(makeService().getNotionAuthorizationLink('client-abc'));

  expect(url.origin + url.pathname).toBe(
    'https://api.notion.com/v1/oauth/authorize'
  );
  expect(url.searchParams.get('owner')).toBe('user');
  expect(url.searchParams.get('client_id')).toBe('client-abc');
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('redirect_uri')).toBe(
    'https://2anki.net/api/notion/connect'
  );
});

test('url-encodes the redirect_uri', () => {
  process.env.NOTION_CLIENT_ID = 'client-abc';
  process.env.NOTION_REDIRECT_URI =
    'https://2anki.net/api/notion/connect?from=signup';

  const link = makeService().getNotionAuthorizationLink('client-abc');

  expect(link).toContain(
    'redirect_uri=https%3A%2F%2F2anki.net%2Fapi%2Fnotion%2Fconnect%3Ffrom%3Dsignup'
  );
});

test('omits the state param when no state is passed (web flow unchanged)', () => {
  process.env.NOTION_CLIENT_ID = 'client-abc';
  process.env.NOTION_REDIRECT_URI = 'https://2anki.net/api/notion/connect';

  const url = new URL(makeService().getNotionAuthorizationLink('client-abc'));

  expect(url.searchParams.has('state')).toBe(false);
});

test('adds state=native when the native state is passed', () => {
  process.env.NOTION_CLIENT_ID = 'client-abc';
  process.env.NOTION_REDIRECT_URI = 'https://2anki.net/api/notion/connect';

  const url = new URL(
    makeService().getNotionAuthorizationLink('client-abc', 'native')
  );

  expect(url.searchParams.get('state')).toBe('native');
});
