import type { Knex } from 'knex';

import type { ConversionEngine } from '../lib/parser/conversionEngine';
import {
  EXPECTED_CHARS_PER_CARD,
  GRANULARITY_MAX_BACK_CHARS,
  GRANULARITY_MIN_BACK_CHARS,
  WEIGHTS,
  type DeckScore,
} from '../lib/parser/scoreCandidateDeck';

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
export type ConversionScoreOutcome =
  | 'shipped'
  | 'no_cards'
  // Reserved for #3883. Nothing writes these yet; the vocabulary exists now so
  // the rescue path starts accumulating its own corpus on its first deploy
  // instead of needing a second migration and a second full window.
  | 'rescue_shipped'
  | 'rescue_rejected';

// Bump alongside SCORER_VERSION in scoreCandidateDeck when the measurement
// changes, so rows measured differently are never averaged together.
export const CURRENT_SCORER_VERSION = 1;

export interface CohortDistributionRow {
  engine: string;
  inputFormat: string;
  sampleSize: number;
  shapedSampleSize: number;
  noCardsCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  compositeP10: number | null;
  compositeP25: number | null;
  compositeP50: number | null;
  compositeP90: number | null;
  cardCountP50: number | null;
  medianBackLenP50: number | null;
  blankBackRateP90: number | null;
}

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
  distribution(params: {
    since: Date;
    scorerVersion: number;
  }): Promise<CohortDistributionRow[]>;
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
      scorer_version: CURRENT_SCORER_VERSION,
      card_count: entry.score.cardCount,
      card_chars: entry.score.cardChars,
      doc_chars: entry.score.docChars,
      median_front_len: Math.round(entry.score.medianFrontLen),
      median_back_len: Math.round(entry.score.medianBackLen),
      blank_back_rate: entry.score.blankBackRate,
      duplicate_front_rate: entry.score.duplicateFrontRate,
      balance: entry.score.balance,
    });
  }

  // The composite is recomputed here rather than read from a column, because a
  // stored composite silently pins the weight vector that produced it: retuning
  // the weights would make every past row incomparable. The weights and bands
  // are bound in from scoreCandidateDeck, never duplicated as SQL literals, so
  // a retune re-scores the whole accumulated corpus on the next read.
  //
  // Percentiles do not compose, so the composite has to be built per row inside
  // the CTE before percentile_cont sees it — the composite's p10 cannot be
  // assembled from the p10 of each signal.
  buildDistributionQuery(params: {
    since: Date;
    scorerVersion: number;
  }): Knex.Raw {
    const shipped = "outcome = 'shipped' AND card_count > 0";
    return this.knex.raw(
      `WITH scored AS (
  SELECT engine, input_format, outcome, created_at, card_count, median_back_len,
         blank_back_rate,
         LEAST(1.0, GREATEST(0.0,
             ? * CASE
                   WHEN median_back_len BETWEEN ? AND ? THEN 1.0
                   WHEN median_back_len < ? THEN LEAST(1.0, GREATEST(0.0, median_back_len::float / ?))
                   ELSE LEAST(1.0, GREATEST(0.0, 1.0 - (median_back_len - ?)::float / ?))
                 END
           + ? * CASE WHEN doc_chars <= 0 THEN 0.0
                      ELSE LEAST(1.0, GREATEST(0.0, card_chars::float / doc_chars)) END
           + ? * balance
           + ? * (1.0 - blank_back_rate)
           + ? * (1.0 - duplicate_front_rate)
           + ? * CASE WHEN doc_chars <= 0 THEN 0.0
                      ELSE LEAST(1.0, GREATEST(0.0,
                             card_count::float / GREATEST(1.0, doc_chars::float / ?))) END
         )) AS composite
  FROM conversion_rule_scores
  WHERE scorer_version = ? AND created_at >= ?
)
SELECT engine, input_format,
       COUNT(*) FILTER (WHERE ${shipped})::int AS sample_size,
       COUNT(*) FILTER (WHERE ${shipped} AND doc_chars > 0)::int AS shaped_sample_size,
       COUNT(*) FILTER (WHERE outcome = 'no_cards')::int AS no_cards_count,
       MIN(created_at) AS first_seen,
       MAX(created_at) AS last_seen,
       percentile_cont(0.10) WITHIN GROUP (ORDER BY composite) FILTER (WHERE ${shipped})::float AS composite_p10,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY composite) FILTER (WHERE ${shipped})::float AS composite_p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY composite) FILTER (WHERE ${shipped})::float AS composite_p50,
       percentile_cont(0.90) WITHIN GROUP (ORDER BY composite) FILTER (WHERE ${shipped})::float AS composite_p90,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY card_count) FILTER (WHERE ${shipped})::int AS card_count_p50,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY median_back_len) FILTER (WHERE ${shipped})::int AS median_back_len_p50,
       percentile_cont(0.90) WITHIN GROUP (ORDER BY blank_back_rate) FILTER (WHERE ${shipped})::float AS blank_back_rate_p90
FROM scored
GROUP BY engine, input_format
ORDER BY sample_size DESC`,
      [
        WEIGHTS.granularity,
        GRANULARITY_MIN_BACK_CHARS,
        GRANULARITY_MAX_BACK_CHARS,
        GRANULARITY_MIN_BACK_CHARS,
        GRANULARITY_MIN_BACK_CHARS,
        GRANULARITY_MAX_BACK_CHARS,
        GRANULARITY_MAX_BACK_CHARS,
        WEIGHTS.coverage,
        WEIGHTS.balance,
        WEIGHTS.blankBack,
        WEIGHTS.duplicateFront,
        WEIGHTS.density,
        EXPECTED_CHARS_PER_CARD,
        params.scorerVersion,
        params.since,
      ]
    );
  }

  async distribution(params: {
    since: Date;
    scorerVersion: number;
  }): Promise<CohortDistributionRow[]> {
    const result = await this.buildDistributionQuery(params);
    const rows = (result.rows ?? result) as Record<string, unknown>[];
    return rows.map((row) => ({
      engine: String(row.engine),
      inputFormat: String(row.input_format),
      sampleSize: Number(row.sample_size ?? 0),
      shapedSampleSize: Number(row.shaped_sample_size ?? 0),
      noCardsCount: Number(row.no_cards_count ?? 0),
      firstSeen: row.first_seen == null ? null : String(row.first_seen),
      lastSeen: row.last_seen == null ? null : String(row.last_seen),
      compositeP10: numberOrNull(row.composite_p10),
      compositeP25: numberOrNull(row.composite_p25),
      compositeP50: numberOrNull(row.composite_p50),
      compositeP90: numberOrNull(row.composite_p90),
      cardCountP50: numberOrNull(row.card_count_p50),
      medianBackLenP50: numberOrNull(row.median_back_len_p50),
      blankBackRateP90: numberOrNull(row.blank_back_rate_p90),
    }));
  }
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default ConversionRuleScoresRepository;
