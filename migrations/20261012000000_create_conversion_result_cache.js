/**
 * Content-addressed cache for the Claude conversion inference result (#4213).
 * Re-uploading the identical document with identical settings re-billed the AI
 * path every time; this table lets that repeat return the cached DeckInfo[]
 * instead of another Claude call. The row is keyed only on cache_key — a
 * SHA-256 over normalized content + output-affecting settings + model id +
 * prompt version — so it is deliberately user-agnostic (two people converting
 * the same file share one entry; the second supplied that same content and gets
 * cards derived only from it). deck_info is JSONB so it stays queryable.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('conversion_result_cache', (table) => {
    table.increments('id').primary();
    table.string('cache_key', 64).notNullable().unique();
    table.index('created_at');
    table.string('model').notNullable();
    table.string('prompt_version').notNullable();
    table.jsonb('deck_info').notNullable();
    table.integer('card_count').notNullable().defaultTo(0);
    table.integer('hits').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_accessed_at').notNullable().defaultTo(knex.fn.now());
  });
};

// Dropping the table only discards cached inference results: the next
// conversion of each input recomputes it (re-billing that one call once) and
// re-populates. No deck, job, or user data lives here.
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('conversion_result_cache');
};
