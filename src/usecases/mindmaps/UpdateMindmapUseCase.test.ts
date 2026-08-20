import {
  UpdateMindmapUseCase,
  MindmapLimitError,
  FREE_NODE_LIMIT,
  SUBSCRIBER_NODE_LIMIT,
} from './UpdateMindmapUseCase';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps, { MindmapsId } from '../../data_layer/public/Mindmaps';
import { MindmapData } from './MindmapData';
import { UsersId } from '../../data_layer/public/Users';

function makeMap(nodeCount: number): Mindmaps {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: String(i),
    label: `Node ${i}`,
  }));
  return {
    id: 'map-1' as MindmapsId,
    user_id: 1 as UsersId,
    title: 'Test',
    data: { nodes, edges: [] },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function makeRepo(
  updatedMap: Mindmaps | null = null
): MindmapRepositoryInterface {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn().mockResolvedValue(updatedMap),
    delete: jest.fn(),
    countByUserId: jest.fn(),
  };
}

const FREE_USER = { patreon: false };
const PAID_USER = { patreon: true };

describe('UpdateMindmapUseCase', () => {
  it('updates map for free user within node cap', async () => {
    const updated = makeMap(10);
    const repo = makeRepo(updated);
    const useCase = new UpdateMindmapUseCase(repo);

    const data: MindmapData = {
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        label: `N${i}`,
      })),
      edges: [],
    };

    const result = await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data,
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    expect((result?.data as MindmapData).nodes.length).toBe(10);
    expect(repo.update).toHaveBeenCalled();
  });

  it('throws MindmapLimitError for free user exceeding 50 nodes', async () => {
    const repo = makeRepo(null);
    const useCase = new UpdateMindmapUseCase(repo);

    const data: MindmapData = {
      nodes: Array.from({ length: 51 }, (_, i) => ({
        id: String(i),
        label: `N${i}`,
      })),
      edges: [],
    };

    await expect(
      useCase.execute({
        id: 'map-1' as MindmapsId,
        userId: 1 as UsersId,
        data,
        user: FREE_USER,
        subscriptions: [],
        isPaying: false,
      })
    ).rejects.toEqual(new MindmapLimitError(FREE_NODE_LIMIT));
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows paid user to exceed 50 nodes', async () => {
    const bigMap = makeMap(100);
    const repo = makeRepo(bigMap);
    const useCase = new UpdateMindmapUseCase(repo);

    const data: MindmapData = {
      nodes: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        label: `N${i}`,
      })),
      edges: [],
    };

    const result = await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data,
      user: PAID_USER,
      subscriptions: [],
      isPaying: true,
    });

    expect((result?.data as MindmapData).nodes.length).toBe(100);
    expect(repo.update).toHaveBeenCalled();
  });

  it('allows exactly 50 nodes for free user', async () => {
    const map50 = makeMap(50);
    const repo = makeRepo(map50);
    const useCase = new UpdateMindmapUseCase(repo);

    const data: MindmapData = {
      nodes: Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        label: `N${i}`,
      })),
      edges: [],
    };

    const result = await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data,
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    expect((result?.data as MindmapData).nodes.length).toBe(50);
  });

  it('lets a paying subscriber exceed the free node cap', async () => {
    const map = makeMap(120);
    const repo = makeRepo(map);
    const useCase = new UpdateMindmapUseCase(repo);

    const data: MindmapData = {
      nodes: Array.from({ length: 120 }, (_, i) => ({
        id: String(i),
        label: `N${i}`,
      })),
      edges: [],
    };

    const result = await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data,
      user: FREE_USER,
      subscriptions: [],
      isPaying: true,
    });

    expect((result?.data as MindmapData).nodes.length).toBe(120);
    expect(repo.update).toHaveBeenCalled();
  });

  it('throws MindmapLimitError carrying 250 when a subscriber exceeds the subscriber node cap', async () => {
    const repo = makeRepo(null);
    const useCase = new UpdateMindmapUseCase(repo);

    const data: MindmapData = {
      nodes: Array.from({ length: SUBSCRIBER_NODE_LIMIT + 1 }, (_, i) => ({
        id: String(i),
        label: `N${i}`,
      })),
      edges: [],
    };

    await expect(
      useCase.execute({
        id: 'map-1' as MindmapsId,
        userId: 1 as UsersId,
        data,
        user: FREE_USER,
        subscriptions: [],
        isPaying: true,
      })
    ).rejects.toEqual(new MindmapLimitError(SUBSCRIBER_NODE_LIMIT));
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('strips presigned URL back to s3Key before persisting', async () => {
    const baseKey = 'mindmaps/1/map-1/uuid.png';
    const presigned = `https://bucket.spaces.digitaloceanspaces.com/${baseKey}?X-Amz-Signature=abc`;
    const repo = makeRepo(makeMap(1));
    const useCase = new UpdateMindmapUseCase(repo);

    await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data: {
        nodes: [
          {
            id: 'a',
            label: 'n',
            image: { url: presigned, width: 10, height: 10 },
          },
        ],
        edges: [],
      },
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const saved = (repo.update as jest.Mock).mock.calls[0][2] as {
      data: MindmapData;
    };
    const savedImage = saved.data.nodes[0].image!;
    expect(savedImage.url).toBe(baseKey);
  });

  it('strips legacy /api/mindmaps/images/ URL and marks as missing', async () => {
    const repo = makeRepo(makeMap(1));
    const useCase = new UpdateMindmapUseCase(repo);

    await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data: {
        nodes: [
          {
            id: 'a',
            label: 'n',
            image: {
              url: '/api/mindmaps/images/1/map-1/old.png',
              width: 10,
              height: 10,
            },
          },
        ],
        edges: [],
      },
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const saved = (repo.update as jest.Mock).mock.calls[0][2] as {
      data: MindmapData;
    };
    const savedImage = saved.data.nodes[0].image!;
    expect(savedImage.url).toBeNull();
    expect(savedImage.missing).toBe(true);
  });

  it('keeps a bare s3Key unchanged', async () => {
    const repo = makeRepo(makeMap(1));
    const useCase = new UpdateMindmapUseCase(repo);

    await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data: {
        nodes: [
          {
            id: 'a',
            label: 'n',
            image: { url: 'mindmaps/1/map-1/uuid.png', width: 10, height: 10 },
          },
        ],
        edges: [],
      },
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const saved = (repo.update as jest.Mock).mock.calls[0][2] as {
      data: MindmapData;
    };
    const savedImage = saved.data.nodes[0].image!;
    expect(savedImage.url).toBe('mindmaps/1/map-1/uuid.png');
  });

  it('drops edges referencing a missing node id before persisting', async () => {
    const repo = makeRepo(makeMap(2));
    const useCase = new UpdateMindmapUseCase(repo);

    await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data: {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [
          { source: 'a', target: 'b' },
          { source: 'a', target: 'ghost' },
          { source: 'ghost', target: 'b' },
        ],
      },
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const saved = (repo.update as jest.Mock).mock.calls[0][2] as {
      data: MindmapData;
    };
    expect(saved.data.edges).toEqual([{ source: 'a', target: 'b' }]);
  });

  it('rejects cross-tenant s3Key: key for user 99 in map belonging to user 1', async () => {
    const repo = makeRepo(makeMap(1));
    const useCase = new UpdateMindmapUseCase(repo);

    await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data: {
        nodes: [
          {
            id: 'a',
            label: 'n',
            image: {
              url: 'mindmaps/99/other-map/uuid.png',
              width: 10,
              height: 10,
            },
          },
        ],
        edges: [],
      },
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const saved = (repo.update as jest.Mock).mock.calls[0][2] as {
      data: MindmapData;
    };
    const savedImage = saved.data.nodes[0].image!;
    expect(savedImage.url).toBeNull();
    expect(savedImage.missing).toBe(true);
  });

  it('rejects cross-tenant presigned URL: key prefix for user 99', async () => {
    const presigned =
      'https://bucket.spaces.digitaloceanspaces.com/mindmaps/99/other-map/uuid.png?X-Amz-Signature=abc';
    const repo = makeRepo(makeMap(1));
    const useCase = new UpdateMindmapUseCase(repo);

    await useCase.execute({
      id: 'map-1' as MindmapsId,
      userId: 1 as UsersId,
      data: {
        nodes: [
          {
            id: 'a',
            label: 'n',
            image: { url: presigned, width: 10, height: 10 },
          },
        ],
        edges: [],
      },
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const saved = (repo.update as jest.Mock).mock.calls[0][2] as {
      data: MindmapData;
    };
    const savedImage = saved.data.nodes[0].image!;
    expect(savedImage.url).toBeNull();
    expect(savedImage.missing).toBe(true);
  });
});
