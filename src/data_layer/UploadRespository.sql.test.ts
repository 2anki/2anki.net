import knex from 'knex';
import UploadRepository from './UploadRespository';

describe('UploadRepository.update generated SQL', () => {
  it('inserts the source column alongside the existing upload fields', () => {
    const pg = knex({ client: 'pg' });
    const repo = new UploadRepository(pg);

    const sql = (
      repo.update(7, 'deck.apkg', 'key/deck.apkg', 1.5, 'app') as unknown as {
        toString(): string;
      }
    ).toString();

    expect(sql).toBe(
      'insert into "uploads" ("dropped_image_count", "filename", "image_drop_reason", "key", "owner", "size_mb", "source") values (NULL, \'deck.apkg\', NULL, \'key/deck.apkg\', 7, 1.5, \'app\')'
    );
  });

  it('inserts a null source when none is supplied', () => {
    const pg = knex({ client: 'pg' });
    const repo = new UploadRepository(pg);

    const sql = (
      repo.update(7, 'deck.apkg', 'key/deck.apkg', 1.5) as unknown as {
        toString(): string;
      }
    ).toString();

    expect(sql).toBe(
      'insert into "uploads" ("dropped_image_count", "filename", "image_drop_reason", "key", "owner", "size_mb", "source") values (NULL, \'deck.apkg\', NULL, \'key/deck.apkg\', 7, 1.5, NULL)'
    );
  });

  it('persists the dropped-image count and reason when conversion metadata is supplied', () => {
    const pg = knex({ client: 'pg' });
    const repo = new UploadRepository(pg);

    const sql = (
      repo.update(7, 'deck.apkg', 'key/deck.apkg', 1.5, null, {
        droppedImageCount: 2,
        imageDropReason: 'notion_html_no_folder',
      }) as unknown as {
        toString(): string;
      }
    ).toString();

    expect(sql).toBe(
      'insert into "uploads" ("dropped_image_count", "filename", "image_drop_reason", "key", "owner", "size_mb", "source") values (2, \'deck.apkg\', \'notion_html_no_folder\', \'key/deck.apkg\', 7, 1.5, NULL)'
    );
  });
});

describe('UploadRepository.findByObjectId generated SQL', () => {
  it('scopes the lookup to the object_id and rows with a non-null key', () => {
    const pg = knex({ client: 'pg' });

    const sql = pg('uploads')
      .select('*')
      .where({ object_id: 'abc-123' })
      .whereNotNull('object_id')
      .whereNotNull('key')
      .first()
      .toString();

    expect(sql).toBe(
      'select * from "uploads" where "object_id" = \'abc-123\' ' +
        'and "object_id" is not null and "key" is not null limit 1'
    );
  });
});

describe('UploadRepository.getLastReconvertibleUpload generated SQL', () => {
  it('filters apkg keys with a bound parameter and orders by created_at desc', () => {
    const pg = knex({ client: 'pg' });

    const sql = pg('uploads')
      .select('key', 'filename', 'created_at')
      .where({ owner: 7 })
      .whereNotNull('filename')
      .whereRaw('lower(key) like ?', ['%.apkg'])
      .orderBy('created_at', 'desc')
      .first()
      .toString();

    expect(sql).toBe(
      'select "key", "filename", "created_at" from "uploads" where "owner" = 7 and "filename" is not null and lower(key) like \'%.apkg\' order by "created_at" desc limit 1'
    );
  });
});
