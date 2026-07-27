exports.up = async (knex) => {
  await knex.schema.createTable('conversion_rule_scores', (table) => {
    table.increments('id').primary();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    // Numeric id only. No filenames, no titles, no card text — shape metrics
    // only, per .claude/rules/support-confidentiality.md.
    table.integer('owner').nullable();
    table.string('source').notNullable();
    table.string('input_format').notNullable();
    table.string('rule').notNullable();
    table.boolean('was_fallback').notNullable().defaultTo(false);
    table.string('outcome').notNullable();
    table.float('score').notNullable();
    table.integer('card_count').notNullable();
    table.integer('doc_chars').notNullable();
    table.integer('median_front_len').notNullable();
    table.integer('median_back_len').notNullable();
    table.float('blank_back_rate').notNullable();
    table.float('duplicate_front_rate').notNullable();
    table.float('coverage').notNullable();
    table.float('balance').notNullable();
    table.float('density').notNullable();
  });

  // Every read is a trend: "score over time", optionally narrowed to one path
  // or format. At ~14k conversions/month the table reaches ~170k rows/year, so
  // the time index earns its keep well before it is large.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS conversion_rule_scores_created_at_index ON conversion_rule_scores (created_at)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS conversion_rule_scores_source_input_format_index ON conversion_rule_scores (source, input_format)'
  );
};

// Reverting discards the score rows written since the deploy. That is the
// intended trade for a metrics-only table — there is nothing to preserve and
// nothing downstream reads it — not an oversight.
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('conversion_rule_scores');
};
