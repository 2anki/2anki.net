import type { Knex } from 'knex';
import type { ListBlockChildrenResponse } from '@notionhq/client/build/src/api-endpoints';

import type Blocks from './public/Blocks';

export interface BlocksCacheLookup {
  id: string;
  owner: string;
  lastEditedAt: string | Date;
}

export interface BlocksCacheSave {
  id: string;
  owner: string;
  payload: ListBlockChildrenResponse;
  createdAt: string | Date;
  lastEditedAt: string | Date;
}

export interface IBlocksCacheRepository {
  get(
    lookup: BlocksCacheLookup
  ): Promise<ListBlockChildrenResponse | undefined>;
  save(entry: BlocksCacheSave): Promise<void>;
}

export class BlocksCacheRepository implements IBlocksCacheRepository {
  private readonly table = 'blocks';

  constructor(private readonly database: Knex) {}

  async get({
    id,
    owner,
    lastEditedAt,
  }: BlocksCacheLookup): Promise<ListBlockChildrenResponse | undefined> {
    const cache: Blocks = await this.database(this.table)
      .where({ object_id: id, owner })
      .first();
    if (!cache || new Date(lastEditedAt) > new Date(cache.last_edited_time)) {
      return undefined;
    }
    try {
      await this.database(this.table)
        .where({ object_id: id, owner })
        .update({ fetch: cache.fetch + 1 });
    } catch (error) {
      console.error('[blocks-cache] fetch counter update failed:', error);
    }
    return cache.payload as ListBlockChildrenResponse;
  }

  async save({
    id,
    owner,
    payload,
    createdAt,
    lastEditedAt,
  }: BlocksCacheSave): Promise<void> {
    await this.database(this.table)
      .insert({
        owner,
        object_id: id,
        payload: JSON.stringify(payload),
        fetch: 1,
        created_at: createdAt,
        last_edited_time: lastEditedAt,
      })
      .onConflict(['object_id', 'owner'])
      .merge();
  }
}

export default BlocksCacheRepository;
