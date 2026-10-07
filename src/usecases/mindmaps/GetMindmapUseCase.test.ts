import { vi, type Mock } from 'vitest';
import { GetMindmapUseCase } from './GetMindmapUseCase';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps, { MindmapsId } from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';
import { MindmapData } from './MindmapData';
import StorageHandler from '../../lib/storage/StorageHandler';

function makeRepo(map: Mindmaps | null): MindmapRepositoryInterface {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(map),
    findByUserId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countByUserId: vi.fn(),
  };
}

function makeStorage(
  presignedUrl = 'https://spaces.example.com/presigned'
): StorageHandler {
  return {
    getPresignedUrl: vi.fn().mockResolvedValue(presignedUrl),
    uploadFile: vi.fn(),
    getFileContents: vi.fn(),
    objectExists: vi.fn(),
    listByPrefix: vi.fn(),
    deleteObjects: vi.fn(),
    delete: vi.fn(),
    getContents: vi.fn(),
    uniqify: vi.fn(),
    s3: {} as never,
  } as unknown as StorageHandler;
}

function makeMap(data: MindmapData): Mindmaps {
  return {
    id: 'map-1' as MindmapsId,
    user_id: 1 as UsersId,
    title: 'Test',
    data,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('GetMindmapUseCase', () => {
  it('returns null when map is not found', async () => {
    const useCase = new GetMindmapUseCase(makeRepo(null), makeStorage());
    const result = await useCase.execute('map-1' as MindmapsId, 1 as UsersId);
    expect(result).toBeNull();
  });

  it('resolves s3 key to presigned URL', async () => {
    const data: MindmapData = {
      nodes: [
        {
          id: 'a',
          label: 'Node',
          image: { url: 'mindmaps/1/map-1/uuid.png', width: 10, height: 10 },
        },
      ],
      edges: [],
    };
    const map = makeMap(data);
    const storage = makeStorage('https://presigned.example.com/img.png');
    const useCase = new GetMindmapUseCase(makeRepo(map), storage);

    const result = await useCase.execute('map-1' as MindmapsId, 1 as UsersId);
    const nodes = (result!.data as MindmapData).nodes;
    expect(nodes[0].image?.url).toBe('https://presigned.example.com/img.png');
    expect(nodes[0].image?.missing).toBeUndefined();
  });

  it('marks legacy /api/mindmaps/images/ URLs as missing', async () => {
    const data: MindmapData = {
      nodes: [
        {
          id: 'b',
          label: 'Old',
          image: {
            url: '/api/mindmaps/images/1/map-1/old.png',
            width: 10,
            height: 10,
          },
        },
      ],
      edges: [],
    };
    const map = makeMap(data);
    const useCase = new GetMindmapUseCase(makeRepo(map), makeStorage());

    const result = await useCase.execute('map-1' as MindmapsId, 1 as UsersId);
    const nodes = (result!.data as MindmapData).nodes;
    expect(nodes[0].image?.missing).toBe(true);
    expect(nodes[0].image?.url).toBeNull();
  });

  it('passes through nodes without images unchanged', async () => {
    const data: MindmapData = {
      nodes: [{ id: 'c', label: 'Plain node' }],
      edges: [],
    };
    const map = makeMap(data);
    const useCase = new GetMindmapUseCase(makeRepo(map), makeStorage());

    const result = await useCase.execute('map-1' as MindmapsId, 1 as UsersId);
    const nodes = (result!.data as MindmapData).nodes;
    expect(nodes[0].image).toBeUndefined();
  });

  it('marks image as missing when presigned URL generation fails', async () => {
    const data: MindmapData = {
      nodes: [
        {
          id: 'd',
          label: 'Node',
          image: { url: 'mindmaps/1/map-1/uuid.png', width: 10, height: 10 },
        },
      ],
      edges: [],
    };
    const map = makeMap(data);
    const storage = makeStorage();
    (storage.getPresignedUrl as Mock).mockRejectedValue(new Error('S3 down'));
    const useCase = new GetMindmapUseCase(makeRepo(map), storage);

    const result = await useCase.execute('map-1' as MindmapsId, 1 as UsersId);
    const nodes = (result!.data as MindmapData).nodes;
    expect(nodes[0].image?.missing).toBe(true);
    expect(nodes[0].image?.url).toBeNull();
  });

  it('rejects cross-tenant s3Key: key belongs to user 99, map belongs to user 1', async () => {
    const data: MindmapData = {
      nodes: [
        {
          id: 'e',
          label: 'Node',
          image: {
            url: 'mindmaps/99/other-map/uuid.png',
            width: 10,
            height: 10,
          },
        },
      ],
      edges: [],
    };
    const map = makeMap(data);
    const storage = makeStorage();
    const useCase = new GetMindmapUseCase(makeRepo(map), storage);

    const result = await useCase.execute('map-1' as MindmapsId, 1 as UsersId);
    const nodes = (result!.data as MindmapData).nodes;
    expect(nodes[0].image?.missing).toBe(true);
    expect(nodes[0].image?.url).toBeNull();
    expect(storage.getPresignedUrl).not.toHaveBeenCalled();
  });
});
