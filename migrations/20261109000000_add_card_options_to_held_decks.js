exports.up = async (knex) => {
  await knex.schema.alterTable('held_decks', (table) => {
    table.jsonb('card_options');
  });
};

// Reverting drops the card options saved with each held deck. A claim then
// rebuilds every hold from the account's stored settings alone, exactly as it
// did before this column existed; the held files themselves are untouched.
exports.down = async (knex) =>
  knex.schema.alterTable('held_decks', (table) => {
    table.dropColumn('card_options');
  });
