import { vi } from 'vitest';
import { ListMindmapsUseCase } from './ListMindmapsUseCase';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps, { MindmapsId } from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';
import { FREE_MAP_LIMIT, SUBSCRIBER_MAP_LIMIT } from './CreateMindmapUseCase';
import { FREE_NODE_LIMIT, SUBSCRIBER_NODE_LIMIT } from './UpdateMindmapUseCase';

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

function makeRepo(maps: Mindmaps[], count: number): MindmapRepositoryInterface {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(maps),
    update: vi.fn(),
    delete: vi.fn(),
    countByUserId: vi.fn().mockResolvedValue(count),
  };
}

const USER_ID = 1 as UsersId;
const FREE_USER = { patreon: false as boolean | null };
const PATRON_USER = { patreon: true as boolean | null };

describe('ListMindmapsUseCase', () => {
  it('returns maps and access info for a free user with an empty subscription array', async () => {
    const maps = [makeMap('a'), makeMap('b')];
    const repo = makeRepo(maps, 2);
    const useCase = new ListMindmapsUseCase(repo);

    const result = await useCase.execute({
      userId: USER_ID,
      user: FREE_USER,
      subscriptions: [],
      isPaying: false,
    });

    expect(result.maps).toEqual(maps);
    expect(result.access.hasUnlimited).toBe(false);
    expect(result.access.currentCount).toBe(2);
    expect(result.access.freeMapLimit).toBe(FREE_MAP_LIMIT);
    expect(result.access.maxNodesPerMap).toBe(FREE_NODE_LIMIT);
    expect(result.access.canUpgrade).toBe(true);
  });

  it('reports the subscriber caps for a paying subscriber without unlimited access', async () => {
    const repo = makeRepo([makeMap('a')], 1);
    const useCase = new ListMindmapsUseCase(repo);

    const result = await useCase.execute({
      userId: USER_ID,
      user: FREE_USER,
      subscriptions: [],
      isPaying: true,
    });

    expect(result.access.hasUnlimited).toBe(false);
    expect(result.access.freeMapLimit).toBe(SUBSCRIBER_MAP_LIMIT);
    expect(result.access.maxNodesPerMap).toBe(SUBSCRIBER_NODE_LIMIT);
    // A subscriber is already on the highest cap the pricing page sells.
    expect(result.access.canUpgrade).toBe(false);
  });

  it('does not throw when subscriptions is undefined (guard against caller bug)', async () => {
    const repo = makeRepo([], 0);
    const useCase = new ListMindmapsUseCase(repo);

    const result = await useCase.execute({
      userId: USER_ID,
      user: FREE_USER,
      subscriptions: undefined as unknown as never[],
      isPaying: false,
    });

    expect(result.access.hasUnlimited).toBe(false);
  });

  it('does not throw when subscriptions is null (guard against caller bug)', async () => {
    const repo = makeRepo([], 0);
    const useCase = new ListMindmapsUseCase(repo);

    const result = await useCase.execute({
      userId: USER_ID,
      user: FREE_USER,
      subscriptions: null as unknown as never[],
      isPaying: false,
    });

    expect(result.access.hasUnlimited).toBe(false);
  });

  it('returns hasUnlimited true for a patron user even when subscriptions is undefined', async () => {
    const repo = makeRepo([], 0);
    const useCase = new ListMindmapsUseCase(repo);

    const result = await useCase.execute({
      userId: USER_ID,
      user: PATRON_USER,
      subscriptions: undefined as unknown as never[],
      isPaying: true,
    });

    expect(result.access.hasUnlimited).toBe(true);
    expect(result.access.canUpgrade).toBe(false);
  });

  it('returns hasUnlimited true for an active auto-sync subscriber', async () => {
    const repo = makeRepo([], 0);
    const useCase = new ListMindmapsUseCase(repo);
    const autoSyncProductId = 'prod_autosync';

    const result = await useCase.execute({
      userId: USER_ID,
      user: FREE_USER,
      subscriptions: [{ active: true, stripe_product_id: autoSyncProductId }],
      autoSyncProductId,
      isPaying: true,
    });

    expect(result.access.hasUnlimited).toBe(true);
    expect(result.access.canUpgrade).toBe(false);
  });
});
