import { vi } from 'vitest';
import { AnkifySyncConflict } from '../../entities/ankify';
import { AnkifySyncConflictsRepository } from './AnkifySyncConflictsRepository';

const stringNoteIdRow = {
  id: 1,
  owner: 1,
  ankify_client_id: 17,
  subscription_id: 10,
  source_id: 'block-1',
  anki_note_id: '1778341400653',
  kind: 'both_edited',
  notion_last_edited_at: new Date(),
  anki_modified_at: '1778400000000',
  notion_snapshot: { front: 'a', back: 'b' },
  anki_snapshot: { front: 'c', back: 'd' },
  status: 'pending',
  resolution: null,
  created_at: new Date(),
  resolved_at: null,
};

function buildKnex(rowToReturn: unknown, rowsToReturn: unknown[] = []) {
  const orderBy = vi.fn().mockReturnValue({
    andWhere: vi.fn().mockReturnThis(),
    then: (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(rowsToReturn).then(resolve),
  });
  const first = vi.fn().mockResolvedValue(rowToReturn);
  const where = vi.fn().mockReturnValue({ first, orderBy });
  const select = vi.fn().mockReturnValue({ where });
  return vi.fn().mockReturnValue({ select });
}

describe('AnkifySyncConflictsRepository — bigint coercion', () => {
  test('findById returns anki_note_id and anki_modified_at as numbers', async () => {
    const knex = buildKnex(stringNoteIdRow);
    const repo = new AnkifySyncConflictsRepository(knex as never);

    const row = (await repo.findById(1, 1)) as AnkifySyncConflict;

    expect(typeof row.anki_note_id).toBe('number');
    expect(row.anki_note_id).toBe(1778341400653);
    expect(typeof row.anki_modified_at).toBe('number');
    expect(row.anki_modified_at).toBe(1778400000000);
  });

  test('findById preserves null anki_modified_at', async () => {
    const knex = buildKnex({ ...stringNoteIdRow, anki_modified_at: null });
    const repo = new AnkifySyncConflictsRepository(knex as never);

    const row = (await repo.findById(1, 1)) as AnkifySyncConflict;

    expect(row.anki_modified_at).toBeNull();
  });

  test('findById returns null untouched when no row exists', async () => {
    const knex = buildKnex(undefined);
    const repo = new AnkifySyncConflictsRepository(knex as never);

    const row = await repo.findById(1, 1);

    expect(row).toBeNull();
  });
});
