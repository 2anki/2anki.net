import type { Knex } from 'knex';

import type { IssuedCardGuid } from '../lib/anki/guidLedgerTypes';
import type { UsersId } from './public/Users';

export interface ICardGuidLedgerRepository {
  getAllForOwner(owner: number): Promise<Record<string, string>>;
  record(owner: number, entries: IssuedCardGuid[]): Promise<void>;
}

const MAX_ID_LENGTH = 255;
const INSERT_CHUNK_SIZE = 500;

export class CardGuidLedgerRepository implements ICardGuidLedgerRepository {
  private readonly table = 'card_guids';

  constructor(private readonly database: Knex) {}

  async getAllForOwner(owner: number): Promise<Record<string, string>> {
    const rows: Array<{ block_id: string; guid: string }> = await this.database(
      this.table
    )
      .select('block_id', 'guid')
      .where({ owner: owner as UsersId });
    const known: Record<string, string> = {};
    for (const row of rows) {
      known[row.block_id] = row.guid;
    }
    return known;
  }

  async record(owner: number, entries: IssuedCardGuid[]): Promise<void> {
    const rows = entries
      .filter(
        (entry) =>
          entry.blockId.length <= MAX_ID_LENGTH &&
          entry.guid.length <= MAX_ID_LENGTH &&
          (entry.sourcePageId == null ||
            entry.sourcePageId.length <= MAX_ID_LENGTH)
      )
      .map((entry) => ({
        owner: owner as UsersId,
        block_id: entry.blockId,
        source_page_id: entry.sourcePageId ?? null,
        guid: entry.guid,
      }));
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
      await this.database(this.table)
        .insert(rows.slice(start, start + INSERT_CHUNK_SIZE))
        .onConflict(['owner', 'block_id'])
        .ignore();
    }
  }
}
