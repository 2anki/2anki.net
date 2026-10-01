import type {
  MindmapStorageMetricsResponse,
  MindmapUserStorageEntry,
} from '../../types/ops/MindmapStorage';

export type { MindmapStorageMetricsResponse, MindmapUserStorageEntry };

const DEFAULT_TOP_USERS_LIMIT = 20;
const MINDMAPS_PREFIX = 'mindmaps/';
const MIN_KEY_SEGMENTS = 3;

export interface StorageObject {
  key: string;
  size: number;
}

export type ListMindmapObjects = () => Promise<StorageObject[]>;

export class MindmapStorageMetricsService {
  constructor(private readonly listMindmapObjects: ListMindmapObjects) {}

  async getMetrics(
    topUsersLimit: number = DEFAULT_TOP_USERS_LIMIT
  ): Promise<MindmapStorageMetricsResponse> {
    const objects = await this.listMindmapObjects();

    let totalBytes = 0;
    let totalObjects = 0;
    const byUser = new Map<string, { bytes: number; count: number }>();

    for (const obj of objects) {
      const userId = extractUserId(obj.key);
      if (userId == null) continue;

      totalBytes += obj.size;
      totalObjects += 1;

      const existing = byUser.get(userId);
      if (existing != null) {
        existing.bytes += obj.size;
        existing.count += 1;
      } else {
        byUser.set(userId, { bytes: obj.size, count: 1 });
      }
    }

    const topUsers: MindmapUserStorageEntry[] = Array.from(byUser.entries())
      .map(([user_id, { bytes, count }]) => ({
        user_id,
        bytes,
        object_count: count,
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, topUsersLimit);

    return {
      total_bytes: totalBytes,
      total_objects: totalObjects,
      top_users: topUsers,
      measured_at: new Date().toISOString(),
    };
  }
}

const extractUserId = (key: string): string | null => {
  if (!key.startsWith(MINDMAPS_PREFIX)) return null;
  const rest = key.slice(MINDMAPS_PREFIX.length);
  const segments = rest.split('/');
  if (segments.length < MIN_KEY_SEGMENTS) return null;
  const userId = segments[0];
  return userId.length > 0 ? userId : null;
};
