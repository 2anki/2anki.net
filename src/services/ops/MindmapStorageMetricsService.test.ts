import { vi } from 'vitest';
import { MindmapStorageMetricsService } from './MindmapStorageMetricsService';

interface StubObject {
  key: string;
  size: number;
}

function makeService(objects: StubObject[]): MindmapStorageMetricsService {
  const listMindmapObjects = vi.fn().mockResolvedValue(objects);
  return new MindmapStorageMetricsService(listMindmapObjects);
}

describe('MindmapStorageMetricsService', () => {
  it('returns zero totals when there are no objects', async () => {
    const service = makeService([]);
    const result = await service.getMetrics();
    expect(result.total_bytes).toBe(0);
    expect(result.total_objects).toBe(0);
    expect(result.top_users).toEqual([]);
  });

  it('sums bytes across all objects', async () => {
    const service = makeService([
      { key: 'mindmaps/1/map1/a.png', size: 1000 },
      { key: 'mindmaps/1/map1/b.jpg', size: 2000 },
      { key: 'mindmaps/2/map2/c.png', size: 500 },
    ]);
    const result = await service.getMetrics();
    expect(result.total_bytes).toBe(3500);
    expect(result.total_objects).toBe(3);
  });

  it('aggregates bytes per user and returns top-N sorted descending', async () => {
    const service = makeService([
      { key: 'mindmaps/10/map1/a.png', size: 5_000_000 },
      { key: 'mindmaps/10/map1/b.png', size: 5_000_000 },
      { key: 'mindmaps/20/map2/c.png', size: 1_000_000 },
      { key: 'mindmaps/30/map3/d.png', size: 2_000_000 },
    ]);
    const result = await service.getMetrics();
    expect(result.top_users).toEqual([
      { user_id: '10', bytes: 10_000_000, object_count: 2 },
      { user_id: '30', bytes: 2_000_000, object_count: 1 },
      { user_id: '20', bytes: 1_000_000, object_count: 1 },
    ]);
  });

  it('limits top_users to the configured limit', async () => {
    const objects: StubObject[] = Array.from({ length: 15 }, (_, i) => ({
      key: `mindmaps/${i}/map/a.png`,
      size: (15 - i) * 1000,
    }));
    const service = makeService(objects);
    const result = await service.getMetrics(10);
    expect(result.top_users).toHaveLength(10);
  });

  it('skips objects with malformed keys that lack a user segment', async () => {
    const service = makeService([
      { key: 'mindmaps/a.png', size: 100 },
      { key: 'other/1/map/b.png', size: 200 },
      { key: 'mindmaps/5/map/c.png', size: 300 },
    ]);
    const result = await service.getMetrics();
    expect(result.total_bytes).toBe(300);
    expect(result.total_objects).toBe(1);
    expect(result.top_users).toEqual([
      { user_id: '5', bytes: 300, object_count: 1 },
    ]);
  });

  it('propagates errors from the storage list call', async () => {
    const listMindmapObjects = vi
      .fn()
      .mockRejectedValue(new Error('S3 unavailable'));
    const service = new MindmapStorageMetricsService(listMindmapObjects);
    await expect(service.getMetrics()).rejects.toThrow('S3 unavailable');
  });
});
