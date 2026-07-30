exports.up = async (knex) => {
  await knex.schema.createTable('card_guids', (table) => {
    table.increments('id').primary();
    table
      .integer('owner')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.string('block_id').notNullable();
    table.string('source_page_id');
    table.string('guid').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['owner', 'block_id']);
  });
};

// Reverting discards the guid rows written since the deploy; affected users'
// next conversion re-issues the same deterministic values. Not an oversight.
exports.down = async (knex) => knex.schema.dropTableIfExists('card_guids');
