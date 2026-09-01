import {
  hasAnkifyAccess,
  AnkifyAccessUser,
  AnkifyAccessSubscription,
} from '../../lib/ankify/access';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';
import { resolveMapLimit } from './CreateMindmapUseCase';
import { resolveNodeLimit } from './UpdateMindmapUseCase';
import { FREE_MAP_LIMIT, FREE_NODE_LIMIT } from '../../lib/limits';

export interface MindmapAccessInfo {
  hasUnlimited: boolean;
  currentCount: number;
  freeMapLimit: number;
  maxNodesPerMap: number;
}

export interface ListMindmapsResult {
  maps: Mindmaps[];
  access: MindmapAccessInfo;
}

interface ListInput {
  userId: UsersId;
  user: AnkifyAccessUser;
  subscriptions: AnkifyAccessSubscription[];
  autoSyncProductId?: string;
  isPaying: boolean;
}

export class ListMindmapsUseCase {
  constructor(private readonly repo: MindmapRepositoryInterface) {}

  async execute(input: ListInput): Promise<ListMindmapsResult> {
    const {
      userId,
      user,
      subscriptions,
      autoSyncProductId = '',
      isPaying,
    } = input;
    const [maps, currentCount] = await Promise.all([
      this.repo.findByUserId(userId),
      this.repo.countByUserId(userId),
    ]);
    const hasUnlimited = hasAnkifyAccess(
      user,
      subscriptions,
      autoSyncProductId
    );
    return {
      maps,
      access: {
        hasUnlimited,
        currentCount,
        freeMapLimit: resolveMapLimit(hasUnlimited, isPaying) ?? FREE_MAP_LIMIT,
        maxNodesPerMap:
          resolveNodeLimit(hasUnlimited, isPaying) ?? FREE_NODE_LIMIT,
      },
    };
  }
}
