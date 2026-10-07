import { vi } from 'vitest';
import { ResolveErrorGroupUseCase } from './ResolveErrorGroupUseCase';
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

describe('ResolveErrorGroupUseCase', () => {
  it('delegates to the repository with the hash and resolver id', async () => {
    const repo = makeRepo();
    const useCase = new ResolveErrorGroupUseCase(repo);

    await useCase.execute('a'.repeat(64), 42);

    expect(repo.resolveGroup).toHaveBeenCalledWith('a'.repeat(64), 42);
  });

  it('passes a null resolver through unchanged', async () => {
    const repo = makeRepo();
    const useCase = new ResolveErrorGroupUseCase(repo);

    await useCase.execute('b'.repeat(64), null);

    expect(repo.resolveGroup).toHaveBeenCalledWith('b'.repeat(64), null);
  });
});
