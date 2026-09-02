exports.up = async (knex) => {
  await knex.schema.createTable('ai_card_fingerprints', (table) => {
    table.bigIncrements('id').primary();
    table
      .integer('owner')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.string('fingerprint', 64).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['owner', 'fingerprint']);
    table.index(['owner', 'created_at'], 'ai_card_fingerprints_owner_recent');
  });
};

// Reverting discards the per-user AI card fingerprint history. Cross-deck dedup
// then falls back to same-upload behavior until a later conversion re-seeds the
// ledger; no card is lost, only the suppression signal is. Accepted.
exports.down = async (knex) =>
  knex.schema.dropTableIfExists('ai_card_fingerprints');
