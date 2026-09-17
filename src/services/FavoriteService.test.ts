import { FavoritesRepository } from '../data_layer/FavoritesRepository';
import FavoriteService from './FavoriteService';

function buildRepository() {
  return {
    findById: jest.fn().mockResolvedValue(undefined),
    addToFavorites: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
    getAllByOwner: jest.fn(),
  } as unknown as jest.Mocked<FavoritesRepository>;
}

describe('FavoriteService', () => {
  it('defaults type to page when the client omits it', async () => {
    const repository = buildRepository();
    const service = new FavoriteService(repository);

    const created = await service.create({
      object_id: 'page-1',
      owner: '1',
      type: undefined as unknown as string,
    });

    expect(created).toBe(true);
    expect(repository.addToFavorites).toHaveBeenCalledWith({
      object_id: 'page-1',
      owner: '1',
      type: 'page',
    });
  });

  it('defaults type to page when the client sends an unrecognized type', async () => {
    const repository = buildRepository();
    const service = new FavoriteService(repository);

    await service.create({ object_id: 'page-2', owner: '1', type: 'bogus' });

    expect(repository.addToFavorites).toHaveBeenCalledWith({
      object_id: 'page-2',
      owner: '1',
      type: 'page',
    });
  });

  it('keeps an explicit database type', async () => {
    const repository = buildRepository();
    const service = new FavoriteService(repository);

    await service.create({ object_id: 'db-1', owner: '1', type: 'database' });

    expect(repository.addToFavorites).toHaveBeenCalledWith({
      object_id: 'db-1',
      owner: '1',
      type: 'database',
    });
  });

  it('returns false without inserting when object_id is missing', async () => {
    const repository = buildRepository();
    const service = new FavoriteService(repository);

    const created = await service.create({
      object_id: '',
      owner: '1',
      type: 'page',
    });

    expect(created).toBe(false);
    expect(repository.addToFavorites).not.toHaveBeenCalled();
  });
});
