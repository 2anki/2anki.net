exports.up = function (knex) {
  return knex.schema.alterTable('users', function (table) {
    table.jsonb('signup_attribution').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('users', function (table) {
    table.dropColumn('signup_attribution');
  });
};
