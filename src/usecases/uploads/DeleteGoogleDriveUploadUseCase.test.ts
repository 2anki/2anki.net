import { vi } from 'vitest';
import { DeleteGoogleDriveUploadUseCase } from './DeleteGoogleDriveUploadUseCase';
import { GoogleDriveRepository } from '../../data_layer/GoogleDriveRepository';

describe('DeleteGoogleDriveUploadUseCase', () => {
  function makeRepo(deleteResult: number): GoogleDriveRepository {
    return {
      deleteByIdAndOwner: vi.fn().mockResolvedValue(deleteResult),
    } as unknown as GoogleDriveRepository;
  }

  it('calls repository with id and owner', async () => {
    const repo = makeRepo(1);
    const useCase = new DeleteGoogleDriveUploadUseCase(repo);
    await useCase.execute('abc', 42);
    expect(repo.deleteByIdAndOwner).toHaveBeenCalledWith('abc', 42);
  });

  it('throws when no row was deleted (wrong owner or missing id)', async () => {
    const repo = makeRepo(0);
    const useCase = new DeleteGoogleDriveUploadUseCase(repo);
    await expect(useCase.execute('nope', 42)).rejects.toThrow();
  });

  it('resolves when deletion succeeded', async () => {
    const repo = makeRepo(1);
    const useCase = new DeleteGoogleDriveUploadUseCase(repo);
    await expect(useCase.execute('abc', 42)).resolves.toBeUndefined();
  });
});
