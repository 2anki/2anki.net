import { TodaySnapshotService } from '../../services/ops/TodaySnapshotService';
import { GetTodaySnapshotUseCase } from './GetTodaySnapshotUseCase';

describe('GetTodaySnapshotUseCase', () => {
  it('returns the service snapshot', async () => {
    const snapshot = {
      rows: [],
      as_of: '2026-09-09T00:00:00.000Z',
      cache_age_seconds: 0,
      stale: false,
      errors: [],
    };
    const service = {
      getSnapshot: jest.fn().mockResolvedValue(snapshot),
    } as unknown as TodaySnapshotService;
    await expect(new GetTodaySnapshotUseCase(service).execute()).resolves.toBe(
      snapshot
    );
  });
});
