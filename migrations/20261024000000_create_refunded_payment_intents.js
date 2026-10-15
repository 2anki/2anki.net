// A payment intent lands here when its charge is fully refunded. Pass grants
// and anonymous-pass claim/activation check it in the same statement that
// writes access, so a refund that Stripe delivers before
// checkout.session.completed — or that races a claim — cannot leave a pass
// running.
exports.up = async (knex) => {
  await knex.schema.createTable('refunded_payment_intents', (t) => {
    t.text('payment_intent_id').primary();
    t.timestamp('refunded_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('anonymous_passes', (t) => {
    t.index(['payment_intent_id'], 'anonymous_passes_payment_intent_id_idx');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('anonymous_passes', (t) => {
    t.dropIndex(['payment_intent_id'], 'anonymous_passes_payment_intent_id_idx');
  });
  await knex.schema.dropTable('refunded_payment_intents');
};
