exports.up = async (knex) => {
  await knex.schema.alterTable('uploads', (table) => {
    table.integer('empty_back_count');
  });
};

// Reverting drops the per-upload count of cards skipped for having no answer.
// My decks falls back to showing no empty-back notice on upload rows, exactly
// as before this column existed; the decks themselves are untouched.
exports.down = async (knex) =>
  knex.schema.alterTable('uploads', (table) => {
    table.dropColumn('empty_back_count');
  });
