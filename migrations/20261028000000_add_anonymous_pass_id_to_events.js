// events is large and written on nearly every request. ADD COLUMN on a
// nullable column with no default is metadata only; the foreign key is added
// NOT VALID so it takes a brief lock and skips the full-table check, which
// 20261028000002 runs under a lock that does not block writes. lock_timeout
// fails the deploy instead of queueing traffic behind a blocked lock.
exports.up = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '3s'");
  await knex.raw(
    'ALTER TABLE events ADD COLUMN IF NOT EXISTS anonymous_pass_id integer'
  );
  await knex.raw(
    'ALTER TABLE events ADD CONSTRAINT events_anonymous_pass_id_foreign FOREIGN KEY (anonymous_pass_id) REFERENCES anonymous_passes(id) ON DELETE SET NULL NOT VALID'
  );
};

exports.down = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '3s'");
  await knex.raw('ALTER TABLE events DROP COLUMN IF EXISTS anonymous_pass_id');
};
