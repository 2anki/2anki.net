import { FavoritesRepository } from '../data_layer/FavoritesRepository';
import {
  NewFavorite,
  isValidFavoriteInput,
  resolveFavoriteType,
} from '../entities/favorites';
import AddToFavoritesUseCase from '../usecases/favorites/AddToFavoritesUseCase';
import DeleteFavoriteUseCase from '../usecases/favorites/DeleteFavoriteUseCase';

class FavoriteService {
  constructor(private repository: FavoritesRepository) {}

  async create(newFavorite: NewFavorite): Promise<boolean> {
    const type = resolveFavoriteType(newFavorite.type);
    if (!isValidFavoriteInput(newFavorite.object_id, type)) {
      return false;
    }

    const useCase = new AddToFavoritesUseCase(this.repository);
    await useCase.execute({ ...newFavorite, type });
    return true;
  }

  async delete(id: string, owner: string): Promise<boolean> {
    const useCase = new DeleteFavoriteUseCase(this.repository);
    await useCase.execute(id, owner);
    return true;
  }
}

export default FavoriteService;
