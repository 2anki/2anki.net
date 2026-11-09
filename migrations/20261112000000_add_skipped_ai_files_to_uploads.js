exports.up = async (knex) => {
  await knex.schema.alterTable('uploads', (table) => {
    table.jsonb('skipped_ai_files');
  });
};

// Reverting drops the list of files Claude made no cards from. My decks then
// shows those decks with no note about the left-out files, exactly as before
// this column existed; the decks themselves are untouched.
exports.down = async (knex) =>
  knex.schema.alterTable('uploads', (table) => {
    table.dropColumn('skipped_ai_files');
  });
