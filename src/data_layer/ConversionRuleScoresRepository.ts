import type { Knex } from 'knex';

import type { DeckScore } from '../lib/parser/scoreCandidateDeck';

export type ConversionScoreSource = 'upload' | 'notion';
export type ConversionScoreOutcome = 'shipped' | 'below_floor';

export interface ConversionScoreRecord {
  owner: number | null;
  source: ConversionScoreSource;
  inputFormat: string;
  rule: string;
  wasFallback: boolean;
  outcome: ConversionScoreOutcome;
  score: DeckScore;
}

export interface IConversionRuleScoresRepository {
  record(entry: ConversionScoreRecord): Promise<void>;
}

export class ConversionRuleScoresRepository implements IConversionRuleScoresRepository {
  constructor(private readonly knex: Knex) {}

  async record(entry: ConversionScoreRecord): Promise<void> {
    await this.knex('conversion_rule_scores').insert({
      owner: entry.owner,
      source: entry.source,
      input_format: entry.inputFormat,
      rule: entry.rule,
      was_fallback: entry.wasFallback,
      outcome: entry.outcome,
      score: entry.score.score,
      card_count: entry.score.cardCount,
      doc_chars: entry.score.docChars,
      median_front_len: Math.round(entry.score.medianFrontLen),
      median_back_len: Math.round(entry.score.medianBackLen),
      blank_back_rate: entry.score.blankBackRate,
      duplicate_front_rate: entry.score.duplicateFrontRate,
      coverage: entry.score.coverage,
      balance: entry.score.balance,
      density: entry.score.density,
    });
  }
}

export default ConversionRuleScoresRepository;
