import { vi } from 'vitest';
import { DeleteDropboxUploadUseCase } from './DeleteDropboxUploadUseCase';
import { DropboxRepository } from '../../data_layer/DropboxRepository';

describe('DeleteDropboxUploadUseCase', () => {
  function makeRepo(deleteResult: number): DropboxRepository {
    return {
      deleteByIdAndOwner: vi.fn().mockResolvedValue(deleteResult),
    } as unknown as DropboxRepository;
  }

  it('calls repository with id and owner', async () => {
    const repo = makeRepo(1);
    const useCase = new DeleteDropboxUploadUseCase(repo);
    await useCase.execute(5, 42);
    expect(repo.deleteByIdAndOwner).toHaveBeenCalledWith(5, 42);
  });

  it('throws when no row was deleted (wrong owner or missing id)', async () => {
    const repo = makeRepo(0);
    const useCase = new DeleteDropboxUploadUseCase(repo);
    await expect(useCase.execute(99, 42)).rejects.toThrow();
  });

  it('resolves when deletion succeeded', async () => {
    const repo = makeRepo(1);
    const useCase = new DeleteDropboxUploadUseCase(repo);
    await expect(useCase.execute(1, 42)).resolves.toBeUndefined();
  });
});
