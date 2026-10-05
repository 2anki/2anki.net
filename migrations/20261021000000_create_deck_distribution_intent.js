exports.up = (knex) =>
  knex.schema.createTable('deck_distribution_intent', (table) => {
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

exports.down = (knex) =>
  knex.schema.dropTableIfExists('deck_distribution_intent');
