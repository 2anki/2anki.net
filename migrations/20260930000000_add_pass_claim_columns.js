exports.up = async function (knex) {
  await knex.schema.alterTable('anonymous_passes', (table) => {
    table
      .integer('claimed_by_user_id')
      .nullable()
      .references('id')
      .inTable('users');
    table.text('buyer_email_hash').nullable();
    table.index(['buyer_email_hash'], 'anonymous_passes_buyer_email_hash_idx');
  });
  await knex.schema.createTable('pass_claim_tokens', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable().references('id').inTable('users');
    table
      .integer('anonymous_pass_id')
      .notNullable()
      .references('id')
      .inTable('anonymous_passes');
    table.text('token_hash').notNullable().unique();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('consumed_at', { useTz: true }).nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('pass_claim_tokens');
  await knex.schema.alterTable('anonymous_passes', (table) => {
    table.dropIndex(['buyer_email_hash'], 'anonymous_passes_buyer_email_hash_idx');
    table.dropColumn('buyer_email_hash');
    table.dropColumn('claimed_by_user_id');
  });
};
