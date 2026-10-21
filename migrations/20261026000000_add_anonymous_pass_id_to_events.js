exports.up = async (knex) => {
  await knex.schema.alterTable('events', (t) => {
    t.integer('anonymous_pass_id')
      .nullable()
      .references('id')
      .inTable('anonymous_passes')
      .onDelete('SET NULL');
    t.index(
      ['anonymous_pass_id', 'created_at'],
      'events_anonymous_pass_id_created_at_idx'
    );
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('events', (t) => {
    t.dropIndex(
      ['anonymous_pass_id', 'created_at'],
      'events_anonymous_pass_id_created_at_idx'
    );
    t.dropColumn('anonymous_pass_id');
  });
};
