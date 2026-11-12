// Dropping a table with a foreign key also takes a brief exclusive lock on
// users, so a long transaction there must not leave every request queued
// behind the drop while it waits.
exports.up = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.dropTableIfExists('deck_distribution_intent');
};

// Reverting brings the table back empty: the survey answers are gone for good.
exports.down = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.createTable('deck_distribution_intent', (table) => {
    table.increments('id').primary();
    table.text('answer').notNullable();
    table.text('notify_email').nullable();
    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.text('upload_key').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.index(['answer']);
    table.index(['user_id']);
  });
};
