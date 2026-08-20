// A pass_claim_token is now issued at webhook fulfillment for anonymous Day/Week
// pass buyers, before any account exists — the emailed claim link resolves the
// account only when the buyer signs in and clicks. The column was NOT NULL
// because every prior issue path (self-serve /account claim, win-back) already
// had a logged-in user. Dropping the constraint lets a fulfillment token carry
// no user until it is confirmed; the confirm path claims the pass for whoever
// is signed in, so user_id on the token is purely the "issued to" record.
exports.up = async (knex) => {
  await knex.schema.alterTable('pass_claim_tokens', (table) => {
    table.integer('user_id').nullable().alter();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('pass_claim_tokens', (table) => {
    table.integer('user_id').notNullable().alter();
  });
};
