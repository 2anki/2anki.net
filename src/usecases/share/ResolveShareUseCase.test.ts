import { vi } from 'vitest';
import ResolveShareUseCase from './ResolveShareUseCase';

function makeShareService(overrides: Record<string, unknown> = {}) {
  return {
    findActiveShare: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('ResolveShareUseCase', () => {
  it('returns null when the share is revoked', async () => {
    const service = makeShareService({
      findActiveShare: vi.fn().mockResolvedValue(null),
    });
    const useCase = new ResolveShareUseCase(service as any);

    const result = await useCase.execute('some-token');

    expect(result).toBeNull();
  });

  it('returns the share row when the share is active', async () => {
    const activeShare = {
      id: 1,
      owner: 42,
      upload_key: 'test.apkg',
      token: 'some-token',
      created_at: new Date(),
      revoked_at: null,
      view_count: 0,
    };
    const service = makeShareService({
      findActiveShare: vi.fn().mockResolvedValue(activeShare),
    });
    const useCase = new ResolveShareUseCase(service as any);

    const result = await useCase.execute('some-token');

    expect(result).toEqual(activeShare);
  });
});
