exports.up = async (knex) => {
  await knex.schema.alterTable('held_decks', (table) => {
    table.string('source', 16);
  });
};

// Reverting drops where each held deck came from. Claims are untouched; only
// the claim event loses the field that tells a connector deck from a web one.
// Revert the code before running down: the current code writes this column on
// every plan hold, so dropping it under live code fails every hold insert.
exports.down = async (knex) =>
  knex.schema.alterTable('held_decks', (table) => {
    table.dropColumn('source');
  });
