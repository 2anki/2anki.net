// One row per Day Pass whose price was offered as credit toward a Semester
// Pass. The unique Day Pass payment intent makes the credit single-use, the
// checkout session id keeps at most one payable upgrade session open, and
// redeemed_at is written by the webhook once that session is paid.
exports.up = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.createTable('day_pass_credits', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('day_pass_payment_intent_id').notNullable().unique();
    t.text('checkout_session_id').nullable().unique();
    t.timestamp('redeemed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(['user_id'], 'day_pass_credits_user_id_idx');
  });
};

// Dropping the table discards every redemption record, so a used credit could be offered again.
exports.down = async (knex) => {
  await knex.schema.dropTable('day_pass_credits');
};
