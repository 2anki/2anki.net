import {
  hasAnkifyAccess,
  AnkifyAccessUser,
  AnkifyAccessSubscription,
} from '../../lib/ankify/access';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import Mindmaps, { MindmapsId } from '../../data_layer/public/Mindmaps';
import { MindmapData, MindmapImageMeta } from './MindmapData';
import { UsersId } from '../../data_layer/public/Users';

import { MindmapLimitError } from './CreateMindmapUseCase';

export { MindmapLimitError };

export const FREE_NODE_LIMIT = 50;
export const SUBSCRIBER_NODE_LIMIT = 250;

export function resolveNodeLimit(
  hasUnlimited: boolean,
  isPaying: boolean
): number | null {
  if (hasUnlimited) return null;
  return isPaying ? SUBSCRIBER_NODE_LIMIT : FREE_NODE_LIMIT;
}

const LEGACY_PREFIX = '/api/mindmaps/images/';
const S3_KEY_PREFIX = 'mindmaps/';

function sanitizeImageUrl(
  image: MindmapImageMeta,
  userId: UsersId,
  mapId: MindmapsId
): MindmapImageMeta {
  const { url } = image;
  if (url == null) {
    return { ...image, missing: true, url: null };
  }
  if (url.startsWith(LEGACY_PREFIX)) {
    return {
      url: null,
      width: image.width,
      height: image.height,
      missing: true,
    };
  }
  const expectedPrefix = `${S3_KEY_PREFIX}${userId}/${mapId}/`;
  if (url.startsWith(S3_KEY_PREFIX)) {
    if (!url.startsWith(expectedPrefix)) {
      return {
        url: null,
        width: image.width,
        height: image.height,
        missing: true,
      };
    }
    return { ...image, url };
  }
  const s3KeyMatch = url.match(/[?#]/);
  const rawPath = s3KeyMatch != null ? url.slice(0, s3KeyMatch.index) : url;
  const keyStart = rawPath.indexOf(S3_KEY_PREFIX);
  if (keyStart !== -1) {
    const s3Key = rawPath.slice(keyStart);
    if (!s3Key.startsWith(expectedPrefix)) {
      return {
        url: null,
        width: image.width,
        height: image.height,
        missing: true,
      };
    }
    return { ...image, url: s3Key };
  }
  return { url: null, width: image.width, height: image.height, missing: true };
}

function sanitizeData(
  data: MindmapData,
  userId: UsersId,
  mapId: MindmapsId
): MindmapData {
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  return {
    ...data,
    nodes: data.nodes.map((node) => {
      if (node.image == null) return node;
      return { ...node, image: sanitizeImageUrl(node.image, userId, mapId) };
    }),
    edges: data.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    ),
  };
}

interface UpdateInput {
  id: MindmapsId;
  userId: UsersId;
  title?: string;
  data?: MindmapData;
  user: AnkifyAccessUser;
  subscriptions: AnkifyAccessSubscription[];
  autoSyncProductId?: string;
  isPaying: boolean;
}

export class UpdateMindmapUseCase {
  constructor(private readonly repo: MindmapRepositoryInterface) {}

  async execute(input: UpdateInput): Promise<Mindmaps | null> {
    const {
      id,
      userId,
      title,
      data,
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
    const nodeLimit = resolveNodeLimit(hasUnlimited, isPaying);

    if (nodeLimit != null && data != null && data.nodes.length > nodeLimit) {
      throw new MindmapLimitError(nodeLimit);
    }

    const patch: Partial<Pick<Mindmaps, 'title' | 'data'>> = {};
    if (title != null) patch.title = title;
    if (data != null) patch.data = sanitizeData(data, userId, id);

    return this.repo.update(id, userId, patch);
  }
}
