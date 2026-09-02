exports.up = async (knex) => {
  await knex.schema.createTable('email_change_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.string('new_email', 255).notNullable();
    t.string('token_hash', 255).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('consumed_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'expires_at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('email_change_tokens');
};
