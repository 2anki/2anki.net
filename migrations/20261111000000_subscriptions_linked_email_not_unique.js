// One account may receive more than one plan through linked_email: its own
// plan relinked after an email change, plus a plan someone else pays for it.
// The unique index turned that into a failed email change or a webhook that
// errored forever while the payer had no access (#5180). Access readers
// already read every row that names an address.
exports.up = async (knex) => {
  // Waiting behind an open transaction would queue every subscriptions read
  // behind this one; failing the boot lets the deploy restore last-good.
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.alterTable('subscriptions', (table) => {
    table.dropUnique(['linked_email']);
    table.index(['linked_email']);
  });
};

// Restoring the unique index fails once two rows share a linked address,
// which the code after this migration allows. Revert the code first, then
// clear the duplicates by hand before running down.
exports.down = async (knex) => {
  await knex.schema.alterTable('subscriptions', (table) => {
    table.dropIndex(['linked_email']);
    table.unique(['linked_email']);
  });
};
