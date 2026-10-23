import { vi } from 'vitest';
import { NotionService } from './NotionService';
import { NotionNotConnectedError } from '../../lib/notion/NotionNotConnectedError';
import NotionAPIWrapper from './NotionAPIWrapper';

function makeRepo(
  row: { invalidated_at: Date | null } | null,
  token: string | null
) {
  return {
    getNotionData: vi.fn().mockResolvedValue(row),
    saveNotionToken: vi.fn(),
    getNotionToken: vi.fn().mockResolvedValue(token),
    deleteBlocksByOwner: vi.fn(),
    deleteNotionData: vi.fn(),
    markTokenInvalid: vi.fn(),
    clearTokenInvalid: vi.fn(),
    setReconnectEmailSent: vi.fn(),
  };
}

describe('NotionService.getNotionAPI', () => {
  it('builds a client for a working connection', async () => {
    const service = new NotionService(
      makeRepo({ invalidated_at: null }, 'secret_token') as never
    );
    await expect(service.getNotionAPI('7')).resolves.toBeInstanceOf(
      NotionAPIWrapper
    );
  });

  it('refuses a token Notion already rejected', async () => {
    const repo = makeRepo({ invalidated_at: new Date() }, 'secret_token');
    const service = new NotionService(repo as never);
    await expect(service.getNotionAPI('7')).rejects.toBeInstanceOf(
      NotionNotConnectedError
    );
    expect(repo.getNotionToken).not.toHaveBeenCalled();
  });

  it('refuses an account that never connected Notion', async () => {
    const service = new NotionService(makeRepo(null, null) as never);
    await expect(service.getNotionAPI('7')).rejects.toBeInstanceOf(
      NotionNotConnectedError
    );
  });
});
