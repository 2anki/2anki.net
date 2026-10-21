exports.config = { transaction: false };

// Partial so the index covers only anonymous-pass AI events (a tiny subset of
// the events table), and CONCURRENTLY so building it never write-locks events
// during a deploy. Keyed (anonymous_pass_id, created_at) for the pass-spend
// read: sum cost where anonymous_pass_id = ? and created_at >= windowStart.
exports.up = async (knex) => {
  await knex.schema.raw(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS events_anonymous_pass_id_idx ON events (anonymous_pass_id, created_at) WHERE anonymous_pass_id IS NOT NULL'
  );
};

exports.down = async (knex) => {
  await knex.schema.raw(
    'DROP INDEX CONCURRENTLY IF EXISTS events_anonymous_pass_id_idx'
  );
};
