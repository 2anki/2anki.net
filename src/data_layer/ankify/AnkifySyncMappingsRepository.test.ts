import { vi, type Mock } from 'vitest';
import { AnkifySyncMapping } from '../../entities/ankify';
import { AnkifySyncMappingsRepository } from './AnkifySyncMappingsRepository';

const stringNoteIdRow = {
  id: 43,
  ankify_client_id: 17,
  source_id: 'block-1',
  source_type: 'notion_block',
  anki_note_id: '1778341400653',
  deck_name: 'Notion Sync::Hva og når skal vi spise?',
  last_synced_at: new Date(),
};

function buildKnex(rowToReturn: unknown) {
  const first = vi.fn().mockResolvedValue(rowToReturn);
  const orderBy = vi.fn().mockReturnValue(Promise.resolve([rowToReturn]));
  const select = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ first, orderBy }),
  });
  const tableBuilder = { select };
  return vi.fn().mockReturnValue(tableBuilder);
}

describe('AnkifySyncMappingsRepository — bigint coercion', () => {
  test('findBySourceId returns anki_note_id as a number even when pg yields a bigint string', async () => {
    const knex = buildKnex(stringNoteIdRow);
    const repo = new AnkifySyncMappingsRepository(knex as never);

    const row = (await repo.findBySourceId(17, 'block-1')) as AnkifySyncMapping;

    expect(row).not.toBeNull();
    expect(typeof row.anki_note_id).toBe('number');
    expect(row.anki_note_id).toBe(1778341400653);
  });

  test('findByAnkiNoteId returns anki_note_id as a number', async () => {
    const knex = buildKnex(stringNoteIdRow);
    const repo = new AnkifySyncMappingsRepository(knex as never);

    const row = (await repo.findByAnkiNoteId(
      17,
      1778341400653
    )) as AnkifySyncMapping;

    expect(typeof row.anki_note_id).toBe('number');
    expect(row.anki_note_id).toBe(1778341400653);
  });

  test('listByClient maps every row through the coercion', async () => {
    const knex = buildKnex(stringNoteIdRow);
    const repo = new AnkifySyncMappingsRepository(knex as never);

    const rows = await repo.listByClient(17);

    expect(rows).toHaveLength(1);
    expect(typeof rows[0].anki_note_id).toBe('number');
  });

  test('findBySourceId returns null untouched when no row exists', async () => {
    const knex = buildKnex(undefined);
    const repo = new AnkifySyncMappingsRepository(knex as never);

    const row = await repo.findBySourceId(17, 'missing');

    expect(row).toBeNull();
  });
});

describe('AnkifySyncMappingsRepository — upsert carries content_hash', () => {
  function buildUpsertKnex() {
    const insert = vi.fn();
    const onConflict = vi.fn();
    const merge = vi.fn();
    const returning = vi.fn().mockResolvedValue([
      {
        ...stringNoteIdRow,
        content_hash: 'abc123',
      },
    ]);
    insert.mockReturnValue({ onConflict });
    onConflict.mockReturnValue({ merge });
    merge.mockReturnValue({ returning });
    const knex = vi.fn().mockReturnValue({ insert }) as unknown as {
      fn: { now: () => unknown };
    } & Mock;
    knex.fn = { now: () => 'NOW()' };
    return { knex, insert, merge };
  }

  test('passes content_hash into both the insert and the merge', async () => {
    const { knex, insert, merge } = buildUpsertKnex();
    const repo = new AnkifySyncMappingsRepository(knex as never);

    await repo.upsert({
      ankify_client_id: 17,
      source_id: 'block-1',
      source_type: 'notion_block',
      anki_note_id: 1778341400653,
      deck_name: 'Notion Sync::Algebra',
      content_hash: 'abc123',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ content_hash: 'abc123' })
    );
    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({ content_hash: 'abc123' })
    );
  });

  test('defaults content_hash to null when omitted', async () => {
    const { knex, insert, merge } = buildUpsertKnex();
    const repo = new AnkifySyncMappingsRepository(knex as never);

    await repo.upsert({
      ankify_client_id: 17,
      source_id: 'block-1',
      source_type: 'notion_block',
      anki_note_id: 1778341400653,
      deck_name: 'Notion Sync::Algebra',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ content_hash: null })
    );
    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({ content_hash: null })
    );
  });
});
