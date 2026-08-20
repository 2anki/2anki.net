import { Knex } from 'knex';
import DeckShares, { DeckSharesId } from './public/DeckShares';
import { UsersId } from './public/Users';

export interface IShareRepository {
  create(owner: UsersId, uploadKey: string, token: string): Promise<DeckShares>;
  findByToken(token: string): Promise<DeckShares | null>;
  findByOwnerAndKey(
    owner: UsersId,
    uploadKey: string
  ): Promise<DeckShares | null>;
  findAllByOwner(owner: UsersId): Promise<DeckShares[]>;
  revoke(token: string, owner: UsersId): Promise<boolean>;
  recordView(id: DeckSharesId): Promise<void>;
  hasActiveShareForKey(uploadKey: string): Promise<boolean>;
}

class ShareRepository implements IShareRepository {
  private readonly table = 'deck_shares';

  constructor(private readonly database: Knex) {}

  async create(
    owner: UsersId,
    uploadKey: string,
    token: string
  ): Promise<DeckShares> {
    const [row] = await this.database<DeckShares>(this.table)
      .insert({ owner, upload_key: uploadKey, token })
      .returning('*');
    return row;
  }

  async findByToken(token: string): Promise<DeckShares | null> {
    const row = await this.database<DeckShares>(this.table)
      .where({ token })
      .first();
    return row ?? null;
  }

  async findByOwnerAndKey(
    owner: UsersId,
    uploadKey: string
  ): Promise<DeckShares | null> {
    const row = await this.database<DeckShares>(this.table)
      .where({ owner, upload_key: uploadKey })
      .whereNull('revoked_at')
      .orderBy('created_at', 'desc')
      .first();
    return row ?? null;
  }

  async findAllByOwner(owner: UsersId): Promise<DeckShares[]> {
    return this.database<DeckShares>(this.table)
      .where({ owner })
      .whereNull('revoked_at')
      .orderBy('created_at', 'desc');
  }

  async revoke(token: string, owner: UsersId): Promise<boolean> {
    const count = await this.database<DeckShares>(this.table)
      .where({ token, owner })
      .whereNull('revoked_at')
      .update({ revoked_at: this.database.fn.now() });
    return count > 0;
  }

  async recordView(id: DeckSharesId): Promise<void> {
    await this.database(this.table)
      .where({ id })
      .update({
        view_count: this.database.raw('view_count + 1'),
        last_viewed_at: this.database.fn.now(),
      });
  }

  async hasActiveShareForKey(uploadKey: string): Promise<boolean> {
    const row = await this.database<DeckShares>(this.table)
      .where({ upload_key: uploadKey })
      .whereNull('revoked_at')
      .first();
    return row != null;
  }
}

export default ShareRepository;
