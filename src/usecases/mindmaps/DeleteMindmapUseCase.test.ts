import { vi, type Mock } from 'vitest';
import { DeleteMindmapUseCase } from './DeleteMindmapUseCase';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import { MindmapsId } from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';
import StorageHandler from '../../lib/storage/StorageHandler';

function makeRepo(): MindmapRepositoryInterface {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    countByUserId: vi.fn(),
  };
}

function makeStorage(keys: string[] = []): StorageHandler {
  return {
    listByPrefix: vi.fn().mockResolvedValue(keys),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn(),
    getPresignedUrl: vi.fn(),
    getFileContents: vi.fn(),
    objectExists: vi.fn(),
    delete: vi.fn(),
    getContents: vi.fn(),
    uniqify: vi.fn(),
    s3: {} as never,
  } as unknown as StorageHandler;
}

const ID = 'map-uuid' as MindmapsId;
const USER = 99 as UsersId;

describe('DeleteMindmapUseCase', () => {
  it('calls listByPrefix with the correct prefix', async () => {
    const storage = makeStorage(['mindmaps/99/map-uuid/a.png']);
    const repo = makeRepo();
    const useCase = new DeleteMindmapUseCase(repo, storage);

    await useCase.execute(ID, USER);

    expect(storage.listByPrefix).toHaveBeenCalledWith('mindmaps/99/map-uuid/');
    expect(storage.deleteObjects).toHaveBeenCalledWith([
      'mindmaps/99/map-uuid/a.png',
    ]);
  });

  it('skips deleteObjects when no objects exist', async () => {
    const storage = makeStorage([]);
    const repo = makeRepo();
    const useCase = new DeleteMindmapUseCase(repo, storage);

    await useCase.execute(ID, USER);

    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('still deletes from DB when S3 listByPrefix throws', async () => {
    const storage = makeStorage();
    (storage.listByPrefix as Mock).mockRejectedValue(new Error('S3 down'));
    const repo = makeRepo();
    const useCase = new DeleteMindmapUseCase(repo, storage);

    await useCase.execute(ID, USER);

    expect(repo.delete).toHaveBeenCalledWith(ID, USER);
  });

  it('still deletes from DB when deleteObjects throws', async () => {
    const storage = makeStorage(['mindmaps/99/map-uuid/a.png']);
    (storage.deleteObjects as Mock).mockRejectedValue(new Error('S3 down'));
    const repo = makeRepo();
    const useCase = new DeleteMindmapUseCase(repo, storage);

    await useCase.execute(ID, USER);

    expect(repo.delete).toHaveBeenCalledWith(ID, USER);
  });
});
