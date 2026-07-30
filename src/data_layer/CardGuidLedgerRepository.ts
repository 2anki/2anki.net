import type { Knex } from 'knex';

import type { IssuedCardGuid } from '../lib/anki/guidLedgerTypes';
import type { UsersId } from './public/Users';

export interface ICardGuidLedgerRepository {
  getAllForOwner(owner: number): Promise<Record<string, string>>;
  record(owner: number, entries: IssuedCardGuid[]): Promise<void>;
}

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
    if (entries.length === 0) {
      return;
    }
    await this.database(this.table)
      .insert(
        entries.map((entry) => ({
          owner: owner as UsersId,
          block_id: entry.blockId,
          source_page_id: entry.sourcePageId ?? null,
          guid: entry.guid,
        }))
      )
      .onConflict(['owner', 'block_id'])
      .ignore();
  }
}
