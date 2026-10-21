exports.up = async (knex) => {
  await knex.schema.alterTable('events', (t) => {
    t.integer('anonymous_pass_id')
      .nullable()
      .references('id')
      .inTable('anonymous_passes')
      .onDelete('SET NULL');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('events', (t) => {
    t.dropColumn('anonymous_pass_id');
  });
};
