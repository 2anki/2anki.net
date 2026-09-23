import { FavoritesRepository } from '../../data_layer/FavoritesRepository';
import DeleteFavoriteUseCase from './DeleteFavoriteUseCase';

function buildRepository(
  overrides: Partial<FavoritesRepository> = {}
): FavoritesRepository {
  return {
    findById: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  } as unknown as FavoritesRepository;
}

describe('DeleteFavoriteUseCase', () => {
  it('removes an existing favorite', async () => {
    const repository = buildRepository({
      findById: jest.fn().mockResolvedValue({ object_id: 'abc', owner: 1 }),
      remove: jest.fn().mockResolvedValue(undefined),
    });
    const useCase = new DeleteFavoriteUseCase(repository);

    await useCase.execute('abc', 1);

    expect(repository.remove).toHaveBeenCalledWith('abc', 1);
  });

  it('is a no-op, not an error, when the favorite is already gone', async () => {
    const repository = buildRepository({
      findById: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
    });
    const useCase = new DeleteFavoriteUseCase(repository);

    await expect(useCase.execute('abc', 1)).resolves.toBeUndefined();
    expect(repository.remove).not.toHaveBeenCalled();
  });
});
