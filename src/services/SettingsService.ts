import SettingsRepository from '../data_layer/SettingsRepository';
import { SettingsInitializer } from '../data_layer/public/Settings';

export interface IServiceSettings {
  create: (settings: SettingsInitializer) => Promise<number[]>;
  delete: (owner: string, id: string) => Promise<void>;
  getById: (owner: string, id: string) => Promise<SettingsInitializer>;
  getAllByOwner: (
    owner: string
  ) => Promise<
    { object_id: string; title: string | null; updated_at: Date | null }[]
  >;
  updateTitle: (object_id: string, title: string) => Promise<void>;
}

class SettingsService implements IServiceSettings {
  constructor(private readonly repository: SettingsRepository) {}

  create({ owner, payload, object_id, title }: SettingsInitializer) {
    return new Promise<number[]>((resolve, reject) => {
      return this.repository
        .create({
          owner,
          payload,
          object_id,
          title,
        })
        .then((settings) => {
          resolve(settings);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  async delete(owner: string, id: string): Promise<void> {
    await this.repository.delete(owner, id);
  }

  getById(owner: string, id: string) {
    return this.repository.getById(owner, id);
  }

  getAllByOwner(owner: string) {
    return this.repository.getAllByOwner(owner);
  }

  updateTitle(object_id: string, title: string) {
    return this.repository.updateTitle(object_id, title);
  }
}

export default SettingsService;
