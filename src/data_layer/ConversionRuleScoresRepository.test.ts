import knexLib from 'knex';

import { ConversionRuleScoresRepository } from './ConversionRuleScoresRepository';
import { scoreCandidateDeck } from '../lib/parser/scoreCandidateDeck';

// The insert builds real SQL against a Postgres dialect with no connection, so
// a column name that does not exist in the migration fails here rather than in
// production. A mocked-repository test would never execute the statement.
describe('ConversionRuleScoresRepository', () => {
  const pg = knexLib({ client: 'pg' });

  it('inserts every score sub-signal under its column name', async () => {
    const statements: string[] = [];
    const fake = ((table: string) => ({
      insert: (row: Record<string, unknown>) => {
        statements.push(pg(table).insert(row).toString());
        return Promise.resolve();
      },
    })) as never;

    const repo = new ConversionRuleScoresRepository(fake);
    await repo.record({
      owner: 21770,
      source: 'web',
      engine: 'parser',
      inputFormat: 'docx',
      rule: 'headings',
      wasFallback: false,
      outcome: 'shipped',
      score: scoreCandidateDeck(
        [{ name: 'What is ATP?', back: 'Adenosine triphosphate.' }],
        400
      ),
    });

    const sql = statements[0];
    expect(sql).toContain('insert into "conversion_rule_scores"');
    for (const column of [
      'owner',
      'source',
      'engine',
      'input_format',
      'rule',
      'was_fallback',
      'outcome',
      'score',
      'card_count',
      'doc_chars',
      'median_front_len',
      'median_back_len',
      'blank_back_rate',
      'duplicate_front_rate',
      'coverage',
      'balance',
      'density',
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
  });

  it('rounds the median lengths to integers for their integer columns', async () => {
    let inserted: Record<string, unknown> = {};
    const fake = (() => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return Promise.resolve();
      },
    })) as never;

    const repo = new ConversionRuleScoresRepository(fake);
    await repo.record({
      owner: null,
      source: 'notion',
      engine: 'claude',
      inputFormat: 'notion',
      rule: 'toggle',
      wasFallback: true,
      outcome: 'below_floor',
      score: scoreCandidateDeck(
        [
          { name: 'a', back: 'bbb' },
          { name: 'aa', back: 'bbbb' },
        ],
        100
      ),
    });

    expect(Number.isInteger(inserted.median_front_len)).toBe(true);
    expect(Number.isInteger(inserted.median_back_len)).toBe(true);
  });
});

describe('conversion score axes', () => {
  it('keeps source and engine independent so a web upload can be either engine', async () => {
    const rows: Record<string, unknown>[] = [];
    const fake = (() => ({
      insert: (row: Record<string, unknown>) => {
        rows.push(row);
        return Promise.resolve();
      },
    })) as never;
    const repo = new ConversionRuleScoresRepository(fake);
    const score = scoreCandidateDeck([{ name: 'Q', back: 'A' }], 400);

    for (const engine of ['parser', 'claude'] as const) {
      await repo.record({
        owner: 1,
        source: 'web',
        engine,
        inputFormat: 'pdf',
        rule: 'recognized',
        wasFallback: false,
        outcome: 'shipped',
        score,
      });
    }

    expect(rows.map((r) => r.source)).toEqual(['web', 'web']);
    expect(rows.map((r) => r.engine)).toEqual(['parser', 'claude']);
  });
});
