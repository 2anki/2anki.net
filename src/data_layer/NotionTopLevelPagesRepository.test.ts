import { NotionTopLevelPagesRepository } from './NotionTopLevelPagesRepository';

interface FakeRow {
  owner: number;
  notion_page_id: string;
  title: string;
  icon: unknown;
  url: string | null;
  parent_type: string;
  last_edited_time: Date | null;
  cached_at: Date;
}

function makeFakeKnex(
  initial: {
    pages?: FakeRow[];
    tokens?: { owner: number; token: string }[];
  } = {}
) {
  const pages: FakeRow[] = [...(initial.pages ?? [])];
  const tokens = [...(initial.tokens ?? [])];
  const calls: string[] = [];

  const queryBuilder = (rows: FakeRow[], filter: Partial<FakeRow>) => {
    const matches = (r: FakeRow) =>
      Object.entries(filter).every(([k, v]) => (r as never)[k] === v);

    return {
      del: () => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (matches(rows[i])) rows.splice(i, 1);
        }
        return Promise.resolve(before - rows.length);
      },
      orderBy: () => ({
        select: () => Promise.resolve(rows.filter(matches)),
      }),
      first: () => Promise.resolve(rows.find(matches) ?? undefined),
    };
  };

  const tableHandler = (tableName: string) => {
    if (tableName === 'notion_top_level_pages') {
      return {
        where: (filter: Partial<FakeRow>) => queryBuilder(pages, filter),
        insert: (rows: FakeRow[]) => {
          calls.push(`insert ${rows.length}`);
          const keys = new Set(
            pages.map((r) => `${r.owner}:${r.notion_page_id}`)
          );
          for (const row of rows) {
            const key = `${row.owner}:${row.notion_page_id}`;
            if (keys.has(key)) {
              return Promise.reject(
                Object.assign(new Error('duplicate key'), { code: '23505' })
              );
            }
            keys.add(key);
          }
          pages.push(...rows);
          return Promise.resolve(rows.length);
        },
        max: () => ({
          where: (filter: Partial<FakeRow>) => ({
            first: () => {
              const filtered = pages.filter((r) =>
                Object.entries(filter).every(([k, v]) => (r as never)[k] === v)
              );
              if (filtered.length === 0) return Promise.resolve({ max: null });
              const max = filtered
                .map((r) => r.cached_at)
                .reduce((a, b) => (a > b ? a : b));
              return Promise.resolve({ max });
            },
          }),
        }),
      };
    }
    if (tableName === 'notion_tokens') {
      return {
        where: (filter: { owner: number }) => {
          const first = () =>
            Promise.resolve(
              tokens.find((t) => t.owner === filter.owner) ?? undefined
            );
          return {
            first,
            forUpdate: () => {
              calls.push(`lock token ${filter.owner}`);
              return { first };
            },
          };
        },
      };
    }
    throw new Error(`unexpected table: ${tableName}`);
  };

  const fn = ((tableName: string) => tableHandler(tableName)) as never;
  (
    fn as unknown as {
      transaction: <T>(cb: (trx: unknown) => Promise<T>) => Promise<T>;
    }
  ).transaction = (cb) => cb(fn);

  return { db: fn, pages, tokens, calls };
}

describe('NotionTopLevelPagesRepository', () => {
  const sampleRow = (owner: number, id: string): FakeRow => ({
    owner,
    notion_page_id: id,
    title: `T-${id}`,
    icon: null,
    url: `https://notion.so/${id}`,
    parent_type: 'workspace',
    last_edited_time: new Date('2026-05-01'),
    cached_at: new Date(),
  });

  it('getByOwner returns all rows for that owner only', async () => {
    const fixture = makeFakeKnex({
      pages: [sampleRow(1, 'a'), sampleRow(1, 'b'), sampleRow(2, 'c')],
    });
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    const rows = await repo.getByOwner(1);
    expect(rows.map((r) => r.notion_page_id).sort()).toEqual(['a', 'b']);
  });

  it('newestCachedAt returns the latest cached_at for that owner', async () => {
    const old = sampleRow(1, 'a');
    old.cached_at = new Date('2026-01-01');
    const fresh = sampleRow(1, 'b');
    fresh.cached_at = new Date('2026-05-01');
    const fixture = makeFakeKnex({ pages: [old, fresh] });
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    const result = await repo.newestCachedAt(1);
    expect(result?.toISOString()).toEqual(fresh.cached_at.toISOString());
  });

  it('newestCachedAt returns null for an owner with no rows', async () => {
    const fixture = makeFakeKnex();
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    expect(await repo.newestCachedAt(99)).toBeNull();
  });

  it('replaceForOwnerIfTokenStillValid replaces all rows when the token exists', async () => {
    const fixture = makeFakeKnex({
      pages: [
        sampleRow(1, 'old-1'),
        sampleRow(1, 'old-2'),
        sampleRow(2, 'other'),
      ],
      tokens: [{ owner: 1, token: 't' }],
    });
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    await repo.replaceForOwnerIfTokenStillValid(1, [
      sampleRow(1, 'new-1'),
      sampleRow(1, 'new-2'),
    ]);
    expect(
      fixture.pages
        .filter((p) => p.owner === 1)
        .map((p) => p.notion_page_id)
        .sort()
    ).toEqual(['new-1', 'new-2']);
    expect(fixture.pages.find((p) => p.owner === 2)).toBeDefined();
  });

  it('replaceForOwnerIfTokenStillValid no-ops when the token has been revoked', async () => {
    const fixture = makeFakeKnex({
      pages: [sampleRow(1, 'old-1')],
      tokens: [],
    });
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    await repo.replaceForOwnerIfTokenStillValid(1, [sampleRow(1, 'new-1')]);
    expect(fixture.pages.map((p) => p.notion_page_id)).toEqual(['old-1']);
    expect(fixture.calls.find((c) => c.startsWith('insert'))).toBeUndefined();
  });

  it('replaceForOwnerIfTokenStillValid keeps one row when Notion returns a page twice', async () => {
    const fixture = makeFakeKnex({ tokens: [{ owner: 1, token: 't' }] });
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    const first = sampleRow(1, 'dup');
    const repeat = { ...sampleRow(1, 'dup'), title: 'repeat' };

    await repo.replaceForOwnerIfTokenStillValid(1, [
      first,
      sampleRow(1, 'other'),
      repeat,
    ]);

    expect(
      fixture.pages.map((p) => [p.notion_page_id, p.title]).sort()
    ).toEqual([
      ['dup', 'T-dup'],
      ['other', 'T-other'],
    ]);
  });

  it('replaceForOwnerIfTokenStillValid locks the owner token row before replacing', async () => {
    const fixture = makeFakeKnex({ tokens: [{ owner: 1, token: 't' }] });
    const repo = new NotionTopLevelPagesRepository(fixture.db);

    await repo.replaceForOwnerIfTokenStillValid(1, [sampleRow(1, 'a')]);

    expect(fixture.calls).toEqual(['lock token 1', 'insert 1']);
  });

  it('deleteByOwner removes only that owner', async () => {
    const fixture = makeFakeKnex({
      pages: [sampleRow(1, 'a'), sampleRow(2, 'b')],
    });
    const repo = new NotionTopLevelPagesRepository(fixture.db);
    await repo.deleteByOwner(1);
    expect(fixture.pages.map((p) => p.notion_page_id)).toEqual(['b']);
  });
});
