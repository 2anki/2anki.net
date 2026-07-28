import type { Knex } from 'knex';

import type { ConversionEngine } from '../lib/parser/conversionEngine';
import type { DeckScore } from '../lib/parser/scoreCandidateDeck';

// The entry point the user came through. Mirrors the vocabulary the
// conversion_failed analytics events already use, so scores and funnel events
// can be read side by side. 'notion' is reserved for the Notion API path, which
// does not record yet.
export type ConversionScoreSource =
  | 'web'
  | 'app'
  | 'dropbox'
  | 'google_drive'
  | 'mcp'
  | 'api'
  | 'upload'
  | 'notion';
export type ConversionScoreOutcome = 'shipped' | 'below_floor';

export interface ConversionScoreRecord {
  owner: number | null;
  source: ConversionScoreSource;
  engine: ConversionEngine;
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
      engine: entry.engine,
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
