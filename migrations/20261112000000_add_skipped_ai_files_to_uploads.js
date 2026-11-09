exports.up = async (knex) => {
  // Adding a nullable column is a catalog change, but it still queues behind a
  // long read of uploads and blocks every upload behind it while it waits.
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.alterTable('uploads', (table) => {
    table.jsonb('skipped_ai_files');
  });
};

// Reverting drops the list of files Claude made no cards from. My decks then
// shows those decks with no note about the left-out files, exactly as before
// this column existed; the decks themselves are untouched.
exports.down = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.alterTable('uploads', (table) => {
    table.dropColumn('skipped_ai_files');
  });
};
