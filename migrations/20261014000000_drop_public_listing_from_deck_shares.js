exports.config = { transaction: false };

exports.up = async (knex) => {
  await knex.schema.raw(
    'DROP INDEX CONCURRENTLY IF EXISTS deck_shares_public_listing_idx'
  );
  await knex.schema.alterTable('deck_shares', (table) => {
    table.dropColumn('is_public');
    table.dropColumn('title');
    table.dropColumn('card_count');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('deck_shares', (table) => {
    table.boolean('is_public').notNullable().defaultTo(false);
    table.string('title', 120).nullable();
    table.integer('card_count').nullable();
  });
  await knex.schema.raw(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS deck_shares_public_listing_idx ON deck_shares (created_at DESC) WHERE is_public = true AND revoked_at IS NULL'
  );
};
