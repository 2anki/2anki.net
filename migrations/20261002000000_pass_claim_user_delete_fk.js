// The pass-claim columns shipped with the default NO ACTION delete rule while
// every other FK into users is CASCADE or SET NULL, so deleting a user who had
// merely been issued a claim link raised 23503 and rolled the whole transaction
// back. Both constraints have to change: dropping only one still fails on the
// other.
exports.up = async (knex) => {
  await knex.schema.table('pass_claim_tokens', (table) => {
    table.dropForeign(['user_id']);
    table
      .foreign('user_id')
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
  });

  // The pass was paid for and outlives the account. Nulling the column is what
  // AnonymousPassRepository.unclaim already does to return a pass to the pool.
  await knex.schema.table('anonymous_passes', (table) => {
    table.dropForeign(['claimed_by_user_id']);
    table
      .foreign('claimed_by_user_id')
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
  });

  // Without an index on the referencing column Postgres seq-scans the child
  // table for every row removed from users, which the bulk inactive-user sweep
  // pays repeatedly.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS pass_claim_tokens_user_id_index ON pass_claim_tokens (user_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS anonymous_passes_claimed_by_user_id_index ON anonymous_passes (claimed_by_user_id)'
  );
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS anonymous_passes_claimed_by_user_id_index');
  await knex.raw('DROP INDEX IF EXISTS pass_claim_tokens_user_id_index');

  await knex.schema.table('anonymous_passes', (table) => {
    table.dropForeign(['claimed_by_user_id']);
    table
      .foreign('claimed_by_user_id')
      .references('id')
      .inTable('users')
      .onDelete('NO ACTION');
  });

  await knex.schema.table('pass_claim_tokens', (table) => {
    table.dropForeign(['user_id']);
    table
      .foreign('user_id')
      .references('id')
      .inTable('users')
      .onDelete('NO ACTION');
  });
};
