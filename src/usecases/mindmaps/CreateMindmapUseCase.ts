import {
  hasAnkifyAccess,
  AnkifyAccessUser,
  AnkifyAccessSubscription,
} from '../../lib/ankify/access';
import { HttpCodedError } from '../../lib/errors/HttpCodedError';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';

export const FREE_MAP_LIMIT = 3;
export const SUBSCRIBER_MAP_LIMIT = 25;

export class MindmapLimitError extends HttpCodedError {
  constructor(public readonly limit: number) {
    super(`Mind map limit reached (${limit})`, 402, 'mindmap_limit');
  }
}

export function resolveMapLimit(
  hasUnlimited: boolean,
  isPaying: boolean
): number | null {
  if (hasUnlimited) return null;
  return isPaying ? SUBSCRIBER_MAP_LIMIT : FREE_MAP_LIMIT;
}

interface CreateInput {
  userId: UsersId;
  title: string;
  user: AnkifyAccessUser;
  subscriptions: AnkifyAccessSubscription[];
  autoSyncProductId?: string;
  isPaying: boolean;
}

export class CreateMindmapUseCase {
  constructor(private readonly repo: MindmapRepositoryInterface) {}

  async execute(input: CreateInput): Promise<Mindmaps> {
    const {
      userId,
      title,
      user,
      subscriptions,
      autoSyncProductId = '',
      isPaying,
    } = input;
    const hasUnlimited = hasAnkifyAccess(
      user,
      subscriptions,
      autoSyncProductId
    );
    const limit = resolveMapLimit(hasUnlimited, isPaying);

    if (limit != null) {
      const count = await this.repo.countByUserId(userId);
      if (count >= limit) {
        throw new MindmapLimitError(limit);
      }
    }

    const rootNode = { id: crypto.randomUUID(), label: title || 'Untitled' };
    return this.repo.create({
      user_id: userId,
      title,
      data: { nodes: [rootNode], edges: [] },
    });
  }
}
