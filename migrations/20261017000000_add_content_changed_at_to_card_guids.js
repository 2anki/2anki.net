exports.up = async (knex) => {
  await knex.schema.alterTable('card_guids', (table) => {
    table.timestamp('content_changed_at');
  });
};

// Reverting drops the change-tracking column. The next re-upload for every
// owner re-seeds it as a first sighting under the old-null state, so one
// re-import per returning user gets a single extra mod bump. Accepted, same
// shape as the guid table's own down migration.
exports.down = async (knex) =>
  knex.schema.alterTable('card_guids', (table) => {
    table.dropColumn('content_changed_at');
  });
