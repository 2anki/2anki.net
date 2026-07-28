exports.up = async (knex) => {
  await knex.schema.alterTable('deck_shares', (t) => {
    t.timestamp('last_viewed_at', { useTz: true }).nullable();
  });
  // Give the installed base a fresh inactivity window so no share expires on
  // deploy day; brand-new shares stay null and fall back to created_at.
  await knex('deck_shares')
    .whereNull('revoked_at')
    .update({ last_viewed_at: knex.fn.now() });
};

// Rolling back after deploy loses view timestamps recorded in the interim;
// the TTL then falls back to created_at, matching pre-migration behavior.
exports.down = async (knex) => {
  await knex.schema.alterTable('deck_shares', (t) => {
    t.dropColumn('last_viewed_at');
  });
};
