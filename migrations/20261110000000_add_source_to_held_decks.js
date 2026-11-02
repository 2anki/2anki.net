exports.up = async (knex) => {
  await knex.schema.alterTable('held_decks', (table) => {
    table.string('source', 16);
  });
};

// Reverting drops where each held deck came from. Claims are untouched; only
// the claim event loses the field that tells a connector deck from a web one.
exports.down = async (knex) =>
  knex.schema.alterTable('held_decks', (table) => {
    table.dropColumn('source');
  });
