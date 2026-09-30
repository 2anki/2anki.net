import knex from 'knex';
import { canonicalizeSurface, canonicalSurfaceSql } from './canonicalSurface';

describe('canonicalizeSurface', () => {
  it('unifies the two spellings that split one real surface', () => {
    expect(canonicalizeSurface({ surface: 'upload-limit-wall' })).toBe(
      'upload_limit_wall'
    );
    expect(canonicalizeSurface({ surface: 'upload_limit_wall' })).toBe(
      'upload_limit_wall'
    );
  });

  it.each([
    ['limit-wall', 'limit_wall'],
    ['downloads-limit', 'downloads_limit'],
    ['notion-limit-wall', 'notion_limit_wall'],
    ['notion-marketplace', 'notion_marketplace'],
  ])('rewrites %s to %s', (raw, expected) => {
    expect(canonicalizeSurface({ surface: raw })).toBe(expected);
  });

  it.each(['pricing_page', 'chat', 'mcp', 'downloads_upsell', 'note_type_ai'])(
    'leaves %s alone',
    (raw) => {
      expect(canonicalizeSurface({ surface: raw })).toBe(raw);
    }
  );

  it('keeps surfaces distinct that merely share a prefix', () => {
    expect(canonicalizeSurface({ surface: 'downloads_upsell' })).not.toBe(
      canonicalizeSurface({ surface: 'downloads-limit' })
    );
  });

  it.each([
    ['anonymous', 'upload', 'anonymous_cap_upload'],
    ['card_count', 'upload', 'card_limit_upload'],
    ['card_count', 'notion', 'card_limit_notion'],
    ['anonymous', 'google_drive', 'anonymous_cap_google_drive'],
    ['card_count', 'google_drive', 'card_limit_google_drive'],
  ])('names the unattributed %s/%s bucket', (kind, source, expected) => {
    expect(canonicalizeSurface({ kind, source })).toBe(expected);
  });

  it('prefers an explicit surface over the kind and source fallback', () => {
    expect(
      canonicalizeSurface({
        surface: 'pricing_page',
        kind: 'card_count',
        source: 'upload',
      })
    ).toBe('pricing_page');
  });

  it.each<[string, unknown]>([
    ['nothing at all', undefined],
    ['an empty object', {}],
    ['a blank surface with no kind', { surface: '   ' }],
    ['a kind with no source', { kind: 'card_count' }],
    ['an unknown kind', { kind: 'something_else', source: 'upload' }],
    ['non-string values', { surface: 42, kind: true }],
  ])('returns null for %s', (_label, props) => {
    expect(canonicalizeSurface(props as never)).toBeNull();
  });
});

describe('canonicalSurfaceSql', () => {
  const pg = knex({ client: 'pg' });

  it('generates SQL Postgres accepts, grouping on the canonical value', () => {
    const sql = pg('events')
      .select(pg.raw(`${canonicalSurfaceSql()} as surface`))
      .count('id as n')
      .groupByRaw(canonicalSurfaceSql())
      .toString();

    expect(sql).toContain("replace(btrim(props->>'surface'), '-', '_')");
    expect(sql).toContain("props->>'kind' = 'anonymous'");
    expect(sql).toContain("props->>'kind' = 'card_count'");
    expect(sql.toLowerCase()).toContain('group by case when');
    expect(sql).not.toContain('undefined');
  });

  it('groups on the same expression it selects, so counts stay per surface', () => {
    const expression = canonicalSurfaceSql();
    const sql = pg('events')
      .select(pg.raw(`${expression} as surface`))
      .groupByRaw(expression)
      .toString()
      .toLowerCase();

    const selected = sql.slice(sql.indexOf('select'), sql.indexOf('from'));
    const grouped = sql.slice(sql.indexOf('group by'));

    expect(selected).toContain('case when');
    expect(grouped).toContain('case when');
  });
});
