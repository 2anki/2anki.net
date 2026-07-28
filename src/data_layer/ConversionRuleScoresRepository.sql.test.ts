import knexLib from 'knex';

import {
  ConversionRuleScoresRepository,
  CURRENT_SCORER_VERSION,
} from './ConversionRuleScoresRepository';
import {
  EXPECTED_CHARS_PER_CARD,
  GRANULARITY_MAX_BACK_CHARS,
  GRANULARITY_MIN_BACK_CHARS,
  WEIGHTS,
} from '../lib/parser/scoreCandidateDeck';

// Built against a real Postgres-dialect knex with no connection, per
// .claude/rules/testing.md: a mocked repository never executes the statement, so
// invalid SQL would ship green and 500 in production. percentile_cont ... WITHIN
// GROUP and FILTER are Postgres-only, so a sqlite test cannot substitute.
describe('ConversionRuleScoresRepository distribution SQL', () => {
  const pg = knexLib({ client: 'pg' });
  const repo = new ConversionRuleScoresRepository(pg);
  const query = repo.buildDistributionQuery({
    since: new Date('2026-07-01T00:00:00.000Z'),
    scorerVersion: CURRENT_SCORER_VERSION,
  });
  const { sql, bindings } = query.toSQL();

  it('computes the composite per row before taking percentiles', () => {
    // Percentiles do not compose: the composite's p10 cannot be assembled from
    // the p10 of each signal, so the composite has to exist per row first.
    expect(sql.indexOf('AS composite')).toBeGreaterThan(-1);
    expect(sql.indexOf('AS composite')).toBeLessThan(
      sql.indexOf('percentile_cont')
    );
    expect(sql).toContain(
      'percentile_cont(0.10) WITHIN GROUP (ORDER BY composite)'
    );
  });

  it('binds the weights and bands rather than inlining them as SQL literals', () => {
    for (const value of [
      WEIGHTS.granularity,
      WEIGHTS.coverage,
      WEIGHTS.balance,
      WEIGHTS.blankBack,
      WEIGHTS.duplicateFront,
      WEIGHTS.density,
      GRANULARITY_MIN_BACK_CHARS,
      GRANULARITY_MAX_BACK_CHARS,
      EXPECTED_CHARS_PER_CARD,
    ]) {
      expect(bindings).toContain(value);
    }
  });

  it('scopes to one scorer_version so differently-measured rows never mix', () => {
    expect(sql).toContain('scorer_version = ?');
    expect(bindings).toContain(CURRENT_SCORER_VERSION);
  });

  it('reports sample size alongside every percentile', () => {
    expect(sql).toContain('AS sample_size');
    expect(sql).toContain('AS shaped_sample_size');
    expect(sql).toContain('AS no_cards_count');
  });

  it('excludes zero-card rows from the percentiles but still counts them', () => {
    expect(sql).toContain("FILTER (WHERE outcome = 'no_cards')");
    expect(sql).toContain("outcome = 'shipped' AND card_count > 0");
  });

  it('groups by the cohort the index leads with', () => {
    expect(sql).toContain('GROUP BY engine, input_format');
  });
});
