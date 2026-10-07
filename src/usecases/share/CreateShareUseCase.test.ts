import { vi } from 'vitest';
import CreateShareUseCase from './CreateShareUseCase';
import { UsersId } from '../../data_layer/public/Users';

const asOwner = (n: number) => n as unknown as UsersId;

function makeUploadRepository(overrides: Record<string, unknown> = {}) {
  return {
    findByKey: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeShareService(overrides: Record<string, unknown> = {}) {
  return {
    createShare: vi.fn().mockResolvedValue({
      id: 1,
      owner: 42,
      upload_key: 'test.apkg',
      token: '550e8400-e29b-41d4-a716-446655440000',
      created_at: new Date(),
      revoked_at: null,
      view_count: 0,
    }),
    findActiveShareForOwnerAndKey: vi.fn().mockResolvedValue(null),
    buildShareUrl: vi
      .fn()
      .mockReturnValue(
        'https://2anki.net/s/550e8400-e29b-41d4-a716-446655440000'
      ),
    ...overrides,
  };
}

describe('CreateShareUseCase', () => {
  it('rejects when upload does not exist', async () => {
    const uploadRepo = makeUploadRepository({
      findByKey: vi.fn().mockResolvedValue(null),
    });
    const shareService = makeShareService();
    const useCase = new CreateShareUseCase(
      uploadRepo as any,
      shareService as any
    );

    await expect(useCase.execute(asOwner(42), 'missing.apkg')).rejects.toThrow(
      'Upload not found'
    );
  });

  it('rejects when caller does not own the upload', async () => {
    const uploadRepo = makeUploadRepository({
      findByKey: vi
        .fn()
        .mockResolvedValue({ id: 1, owner: 99, key: 'test.apkg' }),
    });
    const shareService = makeShareService();
    const useCase = new CreateShareUseCase(
      uploadRepo as any,
      shareService as any
    );

    await expect(useCase.execute(asOwner(42), 'test.apkg')).rejects.toThrow(
      'Upload not found'
    );
  });

  it('generates a token via createShare when owner matches', async () => {
    const uploadRow = { id: 1, owner: 42, key: 'test.apkg' };
    const uploadRepo = makeUploadRepository({
      findByKey: vi.fn().mockResolvedValue(uploadRow),
    });
    const shareService = makeShareService();
    const useCase = new CreateShareUseCase(
      uploadRepo as any,
      shareService as any
    );

    const result = await useCase.execute(asOwner(42), 'test.apkg');

    expect(shareService.createShare).toHaveBeenCalledWith(42, 'test.apkg');
    expect(result.token).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.url).toBe(
      'https://2anki.net/s/550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('returns existing active share instead of creating a duplicate', async () => {
    const uploadRow = { id: 1, owner: 42, key: 'test.apkg' };
    const existingShare = {
      id: 5,
      owner: 42,
      upload_key: 'test.apkg',
      token: 'existing-token',
      created_at: new Date(),
      revoked_at: null,
      view_count: 3,
    };
    const uploadRepo = makeUploadRepository({
      findByKey: vi.fn().mockResolvedValue(uploadRow),
    });
    const shareService = makeShareService({
      findActiveShareForOwnerAndKey: vi.fn().mockResolvedValue(existingShare),
    });
    const useCase = new CreateShareUseCase(
      uploadRepo as any,
      shareService as any
    );

    const result = await useCase.execute(asOwner(42), 'test.apkg');

    expect(shareService.createShare).not.toHaveBeenCalled();
    expect(result.token).toBe('existing-token');
  });
});
