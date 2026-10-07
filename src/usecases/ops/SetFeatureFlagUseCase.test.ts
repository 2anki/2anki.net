import { vi } from 'vitest';
import type {
  FeatureFlagWithEmail,
  IFeatureFlagsRepository,
} from '../../data_layer/FeatureFlagsRepository';
import {
  FeatureFlagNotFoundError,
  SetFeatureFlagUseCase,
} from './SetFeatureFlagUseCase';

vi.mock('../../services/events/track', () => ({
  track: vi.fn(),
}));

import { track as trackFn } from '../../services/events/track';

const track = vi.mocked(trackFn);

const buildRepo = (
  result: FeatureFlagWithEmail | null
): IFeatureFlagsRepository & { setCalls: Array<unknown[]> } => {
  const setCalls: Array<unknown[]> = [];
  return {
    setCalls,
    async getAll() {
      return result == null ? [] : [result];
    },
    async get() {
      return result?.value ?? null;
    },
    async set(...args: unknown[]) {
      setCalls.push(args);
      return result;
    },
  } as IFeatureFlagsRepository & { setCalls: Array<unknown[]> };
};

describe('SetFeatureFlagUseCase', () => {
  beforeEach(() => {
    track.mockClear();
  });

  it('throws FeatureFlagNotFoundError when the key does not exist', async () => {
    const repo = buildRepo(null);
    const useCase = new SetFeatureFlagUseCase(repo);
    await expect(
      useCase.execute({ key: 'missing', value: true, userId: 1 })
    ).rejects.toBeInstanceOf(FeatureFlagNotFoundError);
    expect(track).not.toHaveBeenCalled();
  });

  it('updates the flag, emits the analytics event, and returns the row', async () => {
    const row: FeatureFlagWithEmail = {
      key: 'ai-converter-floor-v1',
      value: true,
      description: 'desc',
      updated_at: '2026-05-30T12:00:00.000Z',
      updated_by: 42,
      updated_by_email: 'admin@example.com',
    };
    const repo = buildRepo(row);
    const useCase = new SetFeatureFlagUseCase(repo);

    const result = await useCase.execute({
      key: 'ai-converter-floor-v1',
      value: true,
      userId: 42,
    });

    expect(result).toEqual(row);
    expect(repo.setCalls).toEqual([['ai-converter-floor-v1', true, 42]]);
    expect(track).toHaveBeenCalledWith('feature_flag_changed', {
      userId: 42,
      props: { key: 'ai-converter-floor-v1', value: true },
    });
  });
});
