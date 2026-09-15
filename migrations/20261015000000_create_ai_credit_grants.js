exports.up = async (knex) => {
  await knex.schema.createTable('ai_credit_grants', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.string('source', 16).notNullable();
    t.integer('amount_credits').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('stripe_session_id', 255).nullable().unique();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'expires_at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('ai_credit_grants');
};
