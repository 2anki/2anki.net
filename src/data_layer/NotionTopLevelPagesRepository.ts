import type { Knex } from 'knex';

export interface NotionTopLevelPageRow {
  owner: number;
  notion_page_id: string;
  title: string;
  icon: unknown;
  url: string | null;
  parent_type: string;
  last_edited_time: Date | null;
  cached_at: Date;
}

export interface INotionTopLevelPagesRepository {
  getByOwner(owner: number): Promise<NotionTopLevelPageRow[]>;
  getRecentByOwner(
    owner: number,
    limit: number
  ): Promise<NotionTopLevelPageRow[]>;
  newestCachedAt(owner: number): Promise<Date | null>;
  replaceForOwnerIfTokenStillValid(
    owner: number,
    rows: NotionTopLevelPageRow[]
  ): Promise<boolean>;
  deleteByOwner(owner: number): Promise<number>;
}

function uniqueByPageId(
  rows: NotionTopLevelPageRow[]
): NotionTopLevelPageRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.notion_page_id)) return false;
    seen.add(row.notion_page_id);
    return true;
  });
}

export class NotionTopLevelPagesRepository implements INotionTopLevelPagesRepository {
  private readonly tableName = 'notion_top_level_pages';

  private readonly tokenTable = 'notion_tokens';

  constructor(private readonly database: Knex) {}

  getByOwner(owner: number): Promise<NotionTopLevelPageRow[]> {
    return this.database(this.tableName)
      .where({ owner })
      .orderBy('title', 'asc')
      .select<NotionTopLevelPageRow[]>('*');
  }

  getRecentByOwner(
    owner: number,
    limit: number
  ): Promise<NotionTopLevelPageRow[]> {
    return this.database(this.tableName)
      .where({ owner })
      .orderByRaw('last_edited_time desc nulls last')
      .orderBy('cached_at', 'desc')
      .limit(limit)
      .select<NotionTopLevelPageRow[]>('*');
  }

  async newestCachedAt(owner: number): Promise<Date | null> {
    const row = await this.database(this.tableName)
      .max('cached_at as max')
      .where({ owner })
      .first();
    const max = (row as { max?: Date | string | null } | undefined)?.max;
    if (max == null) return null;
    return max instanceof Date ? max : new Date(max);
  }

  async replaceForOwnerIfTokenStillValid(
    owner: number,
    rows: NotionTopLevelPageRow[]
  ): Promise<boolean> {
    return this.database.transaction(async (trx) => {
      const token = await trx(this.tokenTable)
        .where({ owner })
        .forUpdate()
        .first();
      if (token == null) {
        return false;
      }
      await trx(this.tableName).where({ owner }).del();
      const uniqueRows = uniqueByPageId(rows);
      if (uniqueRows.length > 0) {
        await trx(this.tableName).insert(uniqueRows);
      }
      return true;
    });
  }

  deleteByOwner(owner: number): Promise<number> {
    return this.database(this.tableName).where({ owner }).del();
  }
}

export default NotionTopLevelPagesRepository;
