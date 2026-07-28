exports.up = async (knex) => {
  await knex.schema.createTable('conversion_rule_scores', (table) => {
    table.increments('id').primary();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    // Numeric id only. No filenames, no titles, no card text — shape metrics
    // only, per .claude/rules/support-confidentiality.md.
    table.integer('owner').nullable();
    // Two independent axes. `source` is the entry point the user came through
    // (web, app, dropbox, google_drive, mcp, api, notion); `engine` is which
    // extraction actually ran (parser or claude). The same web upload takes
    // either engine depending on the account and the settings, and the two
    // produce very differently shaped decks — recording one axis alone makes
    // the scores incomparable.
    table.string('source').notNullable();
    table.string('engine').notNullable();
    table.string('input_format').notNullable();
    table.string('rule').notNullable();
    table.boolean('was_fallback').notNullable().defaultTo(false);
    table.string('outcome').notNullable();
    // Raw measurements only. The composite score, coverage, and density are all
    // exact functions of these columns plus the weights and bands in
    // scoreCandidateDeck.ts — storing the transformed values instead would mean
    // a retune invalidates every accumulated row rather than re-scoring it.
    // scorer_version tracks the MEASUREMENT function (how a card is measured),
    // not the weights: bump it when plainText, the median rule, the cloze
    // blank-back exemption, or the card_chars definition changes, because those
    // make old rows incomparable. A weights change does not bump it.
    table.integer('scorer_version').notNullable().defaultTo(1);
    table.integer('card_count').notNullable();
    table.integer('card_chars').notNullable();
    table.integer('doc_chars').notNullable();
    table.integer('median_front_len').notNullable();
    table.integer('median_back_len').notNullable();
    table.float('blank_back_rate').notNullable();
    table.float('duplicate_front_rate').notNullable();
    table.float('balance').notNullable();
  });

  // Every read is a trend: "score over time", optionally narrowed to one path
  // or format. At ~14k conversions/month the table reaches ~170k rows/year, so
  // the time index earns its keep well before it is large.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS conversion_rule_scores_created_at_index ON conversion_rule_scores (created_at)'
  );
  // The distribution read groups by cohort and filters by scorer_version over a
  // rolling window, so the cohort key leads and created_at closes the range.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS conversion_rule_scores_cohort_index ON conversion_rule_scores (scorer_version, engine, input_format, created_at)'
  );
};

// Reverting discards the score rows written since the deploy. That is the
// intended trade for a metrics-only table — there is nothing to preserve and
// nothing downstream reads it — not an oversight.
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('conversion_rule_scores');
};
