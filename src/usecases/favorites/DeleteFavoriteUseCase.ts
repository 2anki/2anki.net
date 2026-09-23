import { FavoritesRepository } from '../../data_layer/FavoritesRepository';

class DeleteFavoriteUseCase {
  constructor(private favoriteRepository: FavoritesRepository) {}

  // A missing favorite is not an error here: two rapid unfavorite clicks (or
  // a second browser tab already removing it) both want the same end state
  // - not favorited - so the second call is a no-op, not a failure.
  async execute(favoriteId: string, owner: string | number): Promise<void> {
    const favorite = await this.favoriteRepository.findById(favoriteId);

    if (!favorite) {
      return;
    }

    await this.favoriteRepository.remove(favoriteId, owner);
  }
}

export default DeleteFavoriteUseCase;
