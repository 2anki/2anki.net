import { Knex } from 'knex';
import Uploads from './public/Uploads';
import { UploadSource } from '../lib/upload/validateUploadSource';

export interface LastUpload {
  filename: string;
  created_at: Date;
}

export interface LastReconvertibleUpload {
  key: string;
  filename: string;
  created_at: Date;
}

export interface NativeDeckInsert {
  owner: number;
  key: string;
  filename: string;
  size_mb: number;
  dedupe_key: string | null;
}

export interface ConvertedDeckInsert {
  owner: number;
  object_id: string;
  key: string;
  filename: string;
  size_mb: number;
}

export interface IUploadRepository {
  deleteUpload(owner: number, key: string): Promise<number>;
  getUploadsByOwner(owner: number): Promise<Uploads[]>;
  findByIdAndOwner(id: number, owner: number): Promise<Uploads | null>;
  findByObjectId(objectId: string): Promise<Uploads | null>;
  findByKey(owner: number, key: string): Promise<Uploads | null>;
  findAllByObjectIdAndOwner(
    objectId: string,
    owner: number
  ): Promise<Uploads[]>;
  update(
    owner: number,
    filename: string,
    key: string,
    size_mb: number,
    source?: UploadSource | null
  ): Promise<Uploads[]>;
  getLastUploadForUser(userId: number): Promise<LastUpload | null>;
  getLastReconvertibleUpload(
    userId: number
  ): Promise<LastReconvertibleUpload | null>;
  findByOwnerAndDedupeKey(
    owner: number,
    dedupeKey: string
  ): Promise<Uploads | null>;
  insertNativeDeck(row: NativeDeckInsert): Promise<Uploads>;
  insertConvertedDeck(row: ConvertedDeckInsert): Promise<Uploads>;
}
class UploadRepository implements IUploadRepository {
  private readonly table = 'uploads';

  constructor(private readonly database: Knex) {}

  deleteUpload(owner: number, key: string): Promise<number> {
    if (owner == null) {
      console.warn('[UploadRepository] deleteUpload called with no owner');
      return Promise.resolve(0);
    }
    return this.database(this.table).del().where({ owner, key });
  }

  async getAllUploadReferences(): Promise<
    { id: number; key: string; owner: number }[]
  > {
    const rows = await this.database<Uploads>(this.table)
      .select('id', 'key', 'owner')
      .whereNotNull('key');
    return rows
      .filter((row) => typeof row.key === 'string' && row.key.length > 0)
      .map((row) => ({ id: row.id, key: row.key, owner: row.owner }));
  }

  getUploadsByOwner(owner: number): Promise<Uploads[]> {
    if (owner == null) {
      console.warn('[UploadRepository] getUploadsByOwner called with no owner');
      return Promise.resolve([]);
    }
    return this.database(this.table)
      .where({ owner: owner })
      .orderBy('id', 'desc')
      .returning('*');
  }

  async findByIdAndOwner(id: number, owner: number): Promise<Uploads | null> {
    if (owner == null || id == null) {
      return null;
    }
    const row = await this.database<Uploads>(this.table)
      .select('*')
      .where('id', id)
      .andWhere('owner', owner)
      .first();
    return row ?? null;
  }

  async findByObjectId(objectId: string): Promise<Uploads | null> {
    if (objectId == null) {
      return null;
    }
    const row = await this.database<Uploads>(this.table)
      .select('*')
      .where({ object_id: objectId })
      .whereNotNull('object_id')
      .whereNotNull('key')
      .first();
    return row ?? null;
  }

  async findByKey(owner: number, key: string): Promise<Uploads | null> {
    if (owner == null || key == null) {
      return null;
    }
    const row = await this.database<Uploads>(this.table)
      .select('*')
      .where({ owner, key })
      .first();
    return row ?? null;
  }

  async findAllByObjectIdAndOwner(
    objectId: string,
    owner: number
  ): Promise<Uploads[]> {
    if (owner == null || objectId == null) {
      return [];
    }
    return this.database<Uploads>(this.table)
      .select('*')
      .where({ owner, object_id: objectId });
  }

  update(
    owner: number,
    filename: string,
    key: string,
    size_mb: number,
    source: UploadSource | null = null
  ): Promise<Uploads[]> {
    return this.database(this.table).insert({
      owner,
      filename,
      key,
      size_mb,
      source,
    });
  }

  async getLastUploadForUser(userId: number): Promise<LastUpload | null> {
    const row = await this.database<Uploads>(this.table)
      .select('filename', 'created_at')
      .where({ owner: userId })
      .whereNotNull('filename')
      .orderBy('created_at', 'desc')
      .first();
    if (row == null || row.filename == null || row.created_at == null) {
      return null;
    }
    return { filename: row.filename, created_at: row.created_at };
  }

  async getLastReconvertibleUpload(
    userId: number
  ): Promise<LastReconvertibleUpload | null> {
    if (userId == null) {
      return null;
    }
    const row = await this.database<Uploads>(this.table)
      .select('key', 'filename', 'created_at')
      .where({ owner: userId })
      .whereNotNull('filename')
      .whereRaw('lower(key) like ?', ['%.apkg'])
      .orderBy('created_at', 'desc')
      .first();
    if (row == null || row.filename == null || row.created_at == null) {
      return null;
    }
    return {
      key: row.key,
      filename: row.filename,
      created_at: row.created_at,
    };
  }

  async findByOwnerAndDedupeKey(
    owner: number,
    dedupeKey: string
  ): Promise<Uploads | null> {
    if (owner == null || dedupeKey == null) {
      return null;
    }
    const row = await this.database<Uploads>(this.table)
      .select('*')
      .where({ owner, dedupe_key: dedupeKey })
      .first();
    return row ?? null;
  }

  async insertNativeDeck(row: NativeDeckInsert): Promise<Uploads> {
    const [inserted] = await this.database<Uploads>(this.table)
      .insert({
        owner: row.owner,
        key: row.key,
        filename: row.filename,
        size_mb: row.size_mb,
        object_id: null,
        source: 'app',
        dedupe_key: row.dedupe_key,
      })
      .returning('*');
    return inserted;
  }

  async insertConvertedDeck(row: ConvertedDeckInsert): Promise<Uploads> {
    const [inserted] = await this.database<Uploads>(this.table)
      .insert({
        owner: row.owner,
        object_id: row.object_id,
        key: row.key,
        filename: row.filename,
        size_mb: row.size_mb,
        source: 'app',
      })
      .returning('*');
    return inserted;
  }
}

export default UploadRepository;
