// An anonymous pass used to have expires_at stamped purchase + duration, so any
// claim delay burned the window the buyer paid for. expires_at now holds the
// 30-day claim/use deadline until the pass is first attached; activated_at
// records when the usable countdown actually started (first x-pass-token use or
// account claim), after which expires_at is reset to activation + duration.
exports.up = async (knex) => {
  await knex.schema.alterTable('anonymous_passes', (table) => {
    table.timestamp('activated_at', { useTz: true }).nullable();
  });
};

// Rolling back after any pass has activated loses data: activation overwrites
// expires_at in place (no backup of the purchase-stamped value), and dropping
// activated_at erases which rows were touched. Treat down as pre-traffic only.
exports.down = async (knex) => {
  await knex.schema.alterTable('anonymous_passes', (table) => {
    table.dropColumn('activated_at');
  });
};
