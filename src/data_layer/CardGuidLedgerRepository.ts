import type { Knex } from 'knex';

import type { IssuedCardGuid } from '../lib/anki/guidLedgerTypes';
import type { UsersId } from './public/Users';

export interface UploadIdentityRow {
  guid: string;
  sourcePageId: string | null;
  // Epoch seconds, converted from the stored timestamptz — null before
  // #4445 or when a row has never carried a content hash comparison.
  contentChangedAt: number | null;
}

export interface ICardGuidLedgerRepository {
  getAllForOwner(owner: number): Promise<Record<string, string>>;
  getUploadIdentityForOwner(
    owner: number
  ): Promise<Record<string, UploadIdentityRow>>;
  record(owner: number, entries: IssuedCardGuid[]): Promise<void>;
  reissue(owner: number, entries: IssuedCardGuid[]): Promise<void>;
}

const UPLOAD_IDENTITY_BLOCK_PREFIX = 'u:%';

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
      .where({ owner: owner as UsersId })
      .whereNot('block_id', 'like', UPLOAD_IDENTITY_BLOCK_PREFIX);
    const known: Record<string, string> = {};
    for (const row of rows) {
      known[row.block_id] = row.guid;
    }
    return known;
  }

  async getUploadIdentityForOwner(
    owner: number
  ): Promise<Record<string, UploadIdentityRow>> {
    const rows: Array<{
      block_id: string;
      guid: string;
      source_page_id: string | null;
      content_changed_at: Date | null;
    }> = await this.database(this.table)
      .select('block_id', 'guid', 'source_page_id', 'content_changed_at')
      .where({ owner: owner as UsersId })
      .andWhere('block_id', 'like', UPLOAD_IDENTITY_BLOCK_PREFIX);
    const identity: Record<string, UploadIdentityRow> = {};
    for (const row of rows) {
      identity[row.block_id] = {
        guid: row.guid,
        sourcePageId: row.source_page_id,
        contentChangedAt:
          row.content_changed_at == null
            ? null
            : Math.floor(row.content_changed_at.getTime() / 1000),
      };
    }
    return identity;
  }

  async record(owner: number, entries: IssuedCardGuid[]): Promise<void> {
    for (const batch of this.batches(owner, entries)) {
      await this.database(this.table)
        .insert(batch)
        .onConflict(['owner', 'block_id'])
        .ignore();
    }
  }

  async reissue(owner: number, entries: IssuedCardGuid[]): Promise<void> {
    for (const batch of this.batches(owner, entries)) {
      await this.database(this.table)
        .insert(batch)
        .onConflict(['owner', 'block_id'])
        .merge(['guid', 'source_page_id', 'content_changed_at']);
    }
  }

  private batches(
    owner: number,
    entries: IssuedCardGuid[]
  ): Array<Array<Record<string, unknown>>> {
    const filtered = entries.filter(
      (entry) =>
        entry.blockId.length <= MAX_ID_LENGTH &&
        entry.guid.length <= MAX_ID_LENGTH &&
        (entry.sourcePageId == null ||
          entry.sourcePageId.length <= MAX_ID_LENGTH)
    );
    if (filtered.length < entries.length) {
      console.warn(
        `[CardGuidLedgerRepository] dropped ${entries.length - filtered.length} over-length entries`
      );
    }
    // A zip upload resolves each file's identity independently, so two files
    // can land on the same block_id in one call (identical normalized front
    // + card type). ON CONFLICT DO UPDATE cannot touch one row twice inside a
    // single statement (Postgres error 21000) — collapse here, last write
    // wins, same as issuing the rows one at a time would.
    const byKey = new Map<string, Record<string, unknown>>();
    for (const entry of filtered) {
      byKey.set(entry.blockId, {
        owner: owner as UsersId,
        block_id: entry.blockId,
        source_page_id: entry.sourcePageId ?? null,
        guid: entry.guid,
        content_changed_at:
          entry.contentChangedAt == null
            ? null
            : new Date(entry.contentChangedAt * 1000),
      });
    }
    const rows = [...byKey.values()];
    const batches: Array<Array<Record<string, unknown>>> = [];
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
      batches.push(rows.slice(start, start + INSERT_CHUNK_SIZE));
    }
    return batches;
  }
}
