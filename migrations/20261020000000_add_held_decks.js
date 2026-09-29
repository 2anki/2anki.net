exports.up = async (knex) => {
  await knex.schema.createTable('held_decks', (t) => {
    t.increments('id').primary();
    t.string('storage_key', 512).notNullable();
    t.string('anon_id', 64).notNullable();
    t.string('filename', 512).notNullable();
    t.integer('card_count').notNullable();
    t.integer('cards_held_back').notNullable();
    t.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('claimed_at', { useTz: true }).nullable();
    t.integer('claimed_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    t.index(['anon_id', 'created_at'], 'held_decks_anon_id_created_at_idx');
    t.index(['expires_at'], 'held_decks_expires_at_idx');
    t.index(['claimed_by'], 'held_decks_claimed_by_idx');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('held_decks');
};
