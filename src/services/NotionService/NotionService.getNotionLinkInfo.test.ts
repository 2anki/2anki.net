import { vi } from 'vitest';
import { NotionService } from './NotionService';
import type { INotionRepository } from '../../data_layer/NotionRespository';
import { verifyNativeOAuthState } from './nativeOAuthState';

function makeRepo(
  overrides: Partial<INotionRepository> = {}
): INotionRepository {
  return {
    getNotionData: vi.fn().mockResolvedValue(null),
    saveNotionToken: vi.fn().mockResolvedValue(true),
    getNotionToken: vi.fn().mockResolvedValue(null),
    deleteBlocksByOwner: vi.fn().mockResolvedValue(0),
    deleteNotionData: vi.fn().mockResolvedValue(true),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NOTION_CLIENT_ID = 'client-abc';
  process.env.NOTION_CLIENT_SECRET = 'secret-xyz';
  process.env.NOTION_REDIRECT_URI = 'https://2anki.net/api/notion/connect';
  process.env.SECRET = 'link-info-secret';
});

describe('getNotionLinkInfo', () => {
  it('returns isConnected: false when no token row exists', async () => {
    const repo = makeRepo({ getNotionData: vi.fn().mockResolvedValue(null) });
    const service = new NotionService(repo);
    const result = await service.getNotionLinkInfo(1);
    expect(result.isConnected).toBe(false);
  });

  it('returns isConnected: true when a valid token row exists', async () => {
    const repo = makeRepo({
      getNotionData: vi.fn().mockResolvedValue({
        token: 'some-token',
        workspace_name: 'My Workspace',
        invalidated_at: null,
        owner: 1,
        created_at: new Date(),
        token_type: 'bearer',
        bot_id: 'bot',
        workspace_icon: null,
        workspace_id: 'ws-1',
        notion_owner: null,
      }),
    });
    const service = new NotionService(repo);
    const result = await service.getNotionLinkInfo(1);
    expect(result.isConnected).toBe(true);
    expect(result.workspace).toBe('My Workspace');
  });

  it('omits state from the link by default (web flow unchanged)', async () => {
    const service = new NotionService(makeRepo());
    const result = await service.getNotionLinkInfo(1);
    expect(new URL(result.link).searchParams.has('state')).toBe(false);
  });

  it('carries a signed native state encoding the app owner when client is native', async () => {
    const service = new NotionService(makeRepo());
    const result = await service.getNotionLinkInfo(7, { client: 'native' });
    const state = new URL(result.link).searchParams.get('state');
    expect(state).not.toBeNull();
    expect(state!.startsWith('native:')).toBe(true);
    expect(verifyNativeOAuthState(state!, 'link-info-secret')).toBe(7);
  });

  it('returns isConnected: false when token row has invalidated_at set', async () => {
    const repo = makeRepo({
      getNotionData: vi.fn().mockResolvedValue({
        token: 'stale-token',
        workspace_name: 'My Workspace',
        invalidated_at: new Date('2026-01-01T00:00:00Z'),
        owner: 1,
        created_at: new Date(),
        token_type: 'bearer',
        bot_id: 'bot',
        workspace_icon: null,
        workspace_id: 'ws-1',
        notion_owner: null,
      }),
    });
    const service = new NotionService(repo);
    const result = await service.getNotionLinkInfo(1);
    expect(result.isConnected).toBe(false);
  });
});
