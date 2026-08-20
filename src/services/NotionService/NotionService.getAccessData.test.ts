import { NotionService } from './NotionService';
import instrumentedAxios from '../observability/instrumentedAxios';
import type { INotionRepository } from '../../data_layer/NotionRespository';

jest.mock('../observability/instrumentedAxios');

const mockedAxios = instrumentedAxios as jest.Mocked<typeof instrumentedAxios>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NOTION_CLIENT_ID = 'client-abc';
  process.env.NOTION_CLIENT_SECRET = 'secret-xyz';
  process.env.NOTION_REDIRECT_URI = 'https://2anki.net/api/notion/connect';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mockedAxios.post.mockReset();
});

function makeService() {
  const stubRepo: INotionRepository = {
    getNotionData: jest.fn().mockResolvedValue(null),
    saveNotionToken: jest.fn().mockResolvedValue(true),
    getNotionToken: jest.fn().mockResolvedValue(null),
    deleteBlocksByOwner: jest.fn().mockResolvedValue(0),
    deleteNotionData: jest.fn().mockResolvedValue(true),
    markTokenInvalid: jest.fn().mockResolvedValue(undefined),
    clearTokenInvalid: jest.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: jest.fn().mockResolvedValue(true),
  };
  return new NotionService(stubRepo);
}

test('posts redirect_uri to /v1/oauth/token so Notion accepts the exchange', async () => {
  mockedAxios.post.mockResolvedValue({
    data: { access_token: 'tok', workspace_name: 'Test', bot_id: 'bot' },
  } as Awaited<ReturnType<typeof mockedAxios.post>>);

  await makeService().getAccessData('auth-code-123');

  expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  const [, url, body] = mockedAxios.post.mock.calls[0];
  expect(url).toBe('https://api.notion.com/v1/oauth/token');
  expect(body).toEqual({
    grant_type: 'authorization_code',
    code: 'auth-code-123',
    redirect_uri: 'https://2anki.net/api/notion/connect',
  });
});

test('throws when NOTION_REDIRECT_URI is missing rather than POSTing an invalid request', () => {
  delete process.env.NOTION_REDIRECT_URI;

  expect(() => makeService().getAccessData('auth-code-123')).toThrow(
    /Notion Connection Handler not configured/
  );
  expect(mockedAxios.post).not.toHaveBeenCalled();
});

describe('NotionService.getAccessData settles per the OAuth response', () => {
  test('resolves with the token payload Notion returns', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'tok-abc', workspace_id: 'ws-1' },
    } as Awaited<ReturnType<typeof mockedAxios.post>>);

    const result = await makeService().getAccessData('auth-code-123');

    expect(result).toEqual({ access_token: 'tok-abc', workspace_id: 'ws-1' });
  });

  test('rejects with the underlying error when the token request fails', async () => {
    const failure = new Error('notion oauth request failed');
    mockedAxios.post.mockRejectedValue(failure);

    await expect(makeService().getAccessData('auth-code-123')).rejects.toBe(
      failure
    );
  });

  test('stays pending when Notion responds without an access_token', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {},
    } as Awaited<ReturnType<typeof mockedAxios.post>>);

    const settled = jest.fn();
    void makeService().getAccessData('auth-code-123').then(settled, settled);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).not.toHaveBeenCalled();
  });
});
