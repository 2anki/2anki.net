// The public shared-deck library (#3827) was removed in #4155 without its
// schema. No code path ever wrote these columns (zero listing events in the
// feature's lifetime), so `down` restores the shape, not any data.
//
// One ordinary (transactional) migration on purpose: deck_shares is small and
// DROP INDEX / DROP COLUMN are catalog-only, so the brief exclusive lock is
// cheaper than a non-transactional CONCURRENTLY drop that could not be retried
// after a partial failure.
exports.up = async (knex) => {
  await knex.schema.raw('DROP INDEX IF EXISTS deck_shares_public_listing_idx');
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
    'CREATE INDEX IF NOT EXISTS deck_shares_public_listing_idx ON deck_shares (created_at DESC) WHERE is_public = true AND revoked_at IS NULL'
  );
};
