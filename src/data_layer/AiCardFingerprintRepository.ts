import type { Knex } from 'knex';

import type { UsersId } from './public/Users';

export interface IAiCardFingerprintRepository {
  getRecentForOwner(owner: number, limit: number): Promise<string[]>;
  record(owner: number, fingerprints: string[]): Promise<void>;
}

const INSERT_CHUNK_SIZE = 1000;

export class AiCardFingerprintRepository implements IAiCardFingerprintRepository {
  private readonly table = 'ai_card_fingerprints';

  constructor(private readonly database: Knex) {}

  buildRecentQuery(owner: number, limit: number): Knex.QueryBuilder {
    return this.database(this.table)
      .select('fingerprint')
      .where({ owner: owner as UsersId })
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  buildInsertQuery(owner: number, fingerprints: string[]): Knex.QueryBuilder {
    const rows = fingerprints.map((fingerprint) => ({
      owner: owner as UsersId,
      fingerprint,
    }));
    return this.database(this.table)
      .insert(rows)
      .onConflict(['owner', 'fingerprint'])
      .ignore();
  }

  async getRecentForOwner(owner: number, limit: number): Promise<string[]> {
    const rows: Array<{ fingerprint: string }> = await this.buildRecentQuery(
      owner,
      limit
    );
    return rows.map((row) => row.fingerprint);
  }

  async record(owner: number, fingerprints: string[]): Promise<void> {
    const unique = [...new Set(fingerprints)];
    for (let start = 0; start < unique.length; start += INSERT_CHUNK_SIZE) {
      await this.buildInsertQuery(
        owner,
        unique.slice(start, start + INSERT_CHUNK_SIZE)
      );
    }
  }
}
