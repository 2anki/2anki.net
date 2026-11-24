// One row per account that claimed the free AI credits gift. The unique
// user_id is the one-claim-per-account rule; ip_hash (a keyed hash of the
// client's /64 or IPv4 address, never the address) backs the per-network
// daily cap. feedback_answered_at is set once by the one-question prompt, by an
// update that only matches while it is still null. Spend is not stored here:
// it is read from the ai_usage_recorded events stamped with the row's id. The
// ai_credits_gift switch starts off.
exports.up = async (knex) => {
  await knex.raw("SET LOCAL lock_timeout = '5s'");
  await knex.schema.createTable('ai_credit_gifts', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .nullable()
      .unique()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    t.integer('credits').notNullable();
    t.timestamp('claimed_at', { useTz: true }).notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.text('ip_hash').nullable();
    t.timestamp('feedback_answered_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(['ip_hash', 'claimed_at'], 'ai_credit_gifts_ip_hash_claimed_at_idx');
  });
  await knex('feature_flags')
    .insert({
      key: 'ai_credits_gift',
      value: false,
      description:
        'Free AI credits gift: a present in the header lets any account claim 100 AI credits for Claude cards on uploads, spent only after any plan credits, expiring 48 hours after the claim and never after 2026-12-04 22:00 UTC. Claims close 2026-12-04 20:00 UTC and stop when the gift budget is used. Off hides the present, refuses claims and stops gift credits being spent; flip from /ops.',
    })
    .onConflict('key')
    .ignore();
};

// Dropping the table forgets who claimed, so an account could claim again if
// the table came back; the gift ends on 2026-12-04, after which that is moot.
exports.down = async (knex) => {
  await knex('feature_flags').where({ key: 'ai_credits_gift' }).del();
  await knex.schema.dropTable('ai_credit_gifts');
};
