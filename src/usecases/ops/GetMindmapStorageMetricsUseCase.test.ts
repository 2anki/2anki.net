import { vi, type Mock } from 'vitest';
import { GetMindmapStorageMetricsUseCase } from './GetMindmapStorageMetricsUseCase';
import type {
  MindmapStorageMetricsResponse,
  MindmapStorageMetricsService,
} from '../../services/ops/MindmapStorageMetricsService';

describe('GetMindmapStorageMetricsUseCase', () => {
  it('delegates to the service and returns its response unchanged', async () => {
    const fake: MindmapStorageMetricsResponse = {
      total_bytes: 10_485_760,
      total_objects: 42,
      top_users: [
        { user_id: '7', bytes: 5_242_880, object_count: 21 },
        { user_id: '3', bytes: 5_242_880, object_count: 21 },
      ],
      measured_at: '2026-05-26T12:00:00.000Z',
    };
    const service = {
      getMetrics: vi.fn().mockResolvedValue(fake),
    } as unknown as MindmapStorageMetricsService;
    const useCase = new GetMindmapStorageMetricsUseCase(service);

    const result = await useCase.execute();

    expect(result).toBe(fake);
    expect(service.getMetrics as Mock).toHaveBeenCalledTimes(1);
  });
});
