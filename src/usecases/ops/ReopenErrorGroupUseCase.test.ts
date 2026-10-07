import { vi } from 'vitest';
import { ReopenErrorGroupUseCase } from './ReopenErrorGroupUseCase';
import { IErrorEventRepository } from '../../data_layer/ErrorEventRepository';

function makeRepo(): IErrorEventRepository {
  return {
    insert: vi.fn(),
    existsWithinWindow: vi.fn(async () => false),
    listGroups: vi.fn(async () => []),
    countGroups: vi.fn(async () => 0),
    latestSamples: vi.fn(async () => []),
    resolveGroup: vi.fn(async () => {}),
    reopenGroup: vi.fn(async () => {}),
  };
}

describe('ReopenErrorGroupUseCase', () => {
  it('delegates to the repository with the hash', async () => {
    const repo = makeRepo();
    const useCase = new ReopenErrorGroupUseCase(repo);

    await useCase.execute('c'.repeat(64));

    expect(repo.reopenGroup).toHaveBeenCalledWith('c'.repeat(64));
  });
});
