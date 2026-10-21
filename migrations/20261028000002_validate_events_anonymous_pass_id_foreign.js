// VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, so the full scan of events
// runs without blocking reads or writes.
exports.up = async (knex) => {
  await knex.raw(
    'ALTER TABLE events VALIDATE CONSTRAINT events_anonymous_pass_id_foreign'
  );
};

exports.down = async () => {};
