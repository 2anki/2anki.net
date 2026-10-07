import { vi, type Mock } from 'vitest';
import {
  CreateMindmapUseCase,
  MindmapLimitError,
  FREE_MAP_LIMIT,
  SUBSCRIBER_MAP_LIMIT,
} from './CreateMindmapUseCase';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps, { MindmapsId } from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';

function makeMap(id: string): Mindmaps {
  return {
    id: id as MindmapsId,
    user_id: 1 as UsersId,
    title: 'Test',
    data: { nodes: [], edges: [] },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function makeRepo(count: number): MindmapRepositoryInterface {
  return {
    create: vi.fn().mockResolvedValue(makeMap('new')),
    findById: vi.fn(),
    findByUserId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countByUserId: vi.fn().mockResolvedValue(count),
  };
}

const FREE_USER = { patreon: false };
const PAID_USER = { patreon: true };

describe('CreateMindmapUseCase', () => {
  it('creates a map for a free user under the cap', async () => {
    const repo = makeRepo(2);
    const useCase = new CreateMindmapUseCase(repo);

    const result = await useCase.execute({
      userId: 1 as UsersId,
      title: 'Anatomy',
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    expect(result.id).toBe('new');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('throws MindmapLimitError carrying 3 when free user is at the free cap', async () => {
    const repo = makeRepo(FREE_MAP_LIMIT);
    const useCase = new CreateMindmapUseCase(repo);

    await expect(
      useCase.execute({
        userId: 1 as UsersId,
        title: 'New map',
        user: FREE_USER,
        subscriptions: [],
        isPaying: false,
      })
    ).rejects.toEqual(new MindmapLimitError(FREE_MAP_LIMIT));
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('lets a paying subscriber create beyond the free cap', async () => {
    const repo = makeRepo(FREE_MAP_LIMIT + 5);
    const useCase = new CreateMindmapUseCase(repo);

    const result = await useCase.execute({
      userId: 1 as UsersId,
      title: 'Map 9',
      user: FREE_USER,
      subscriptions: [],
      isPaying: true,
    });

    expect(result.id).toBe('new');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('throws MindmapLimitError carrying 25 when subscriber is at the subscriber cap', async () => {
    const repo = makeRepo(SUBSCRIBER_MAP_LIMIT);
    const useCase = new CreateMindmapUseCase(repo);

    await expect(
      useCase.execute({
        userId: 1 as UsersId,
        title: 'Map 26',
        user: FREE_USER,
        subscriptions: [],
        isPaying: true,
      })
    ).rejects.toEqual(new MindmapLimitError(SUBSCRIBER_MAP_LIMIT));
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('allows a lifetime (patreon) user to create even when above the subscriber cap', async () => {
    const repo = makeRepo(SUBSCRIBER_MAP_LIMIT + 100);
    const useCase = new CreateMindmapUseCase(repo);

    const result = await useCase.execute({
      userId: 1 as UsersId,
      title: 'Map 200',
      user: PAID_USER,
      subscriptions: [],
      isPaying: true,
    });

    expect(result.id).toBe('new');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('allows an auto-sync subscriber to create beyond the subscriber cap', async () => {
    const repo = makeRepo(SUBSCRIBER_MAP_LIMIT + 5);
    const useCase = new CreateMindmapUseCase(repo);
    const autoSyncProductId = 'prod_autosync';

    const result = await useCase.execute({
      userId: 1 as UsersId,
      title: 'Map',
      user: FREE_USER,
      subscriptions: [{ active: true, stripe_product_id: autoSyncProductId }],
      autoSyncProductId,
      isPaying: true,
    });

    expect(result.id).toBe('new');
  });

  it('seeds a root node in the data passed to repo.create', async () => {
    const repo = makeRepo(0);
    const useCase = new CreateMindmapUseCase(repo);

    await useCase.execute({
      userId: 1 as UsersId,
      title: 'Organic Chemistry',
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    const callArg = (repo.create as Mock).mock.calls[0][0] as {
      data: { nodes: { id: string; label: string }[]; edges: unknown[] };
    };
    expect(callArg.data.nodes).toHaveLength(1);
    expect(callArg.data.nodes[0].label).toBe('Organic Chemistry');
    expect(typeof callArg.data.nodes[0].id).toBe('string');
    expect(callArg.data.edges).toHaveLength(0);
  });
});
